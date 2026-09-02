/**
 * Broker ground truth: pull cTrader's own deal history and fold it back onto our order record.
 *
 * WHY
 *
 * Every win/loss and pip figure this system publishes is MODELLED — `outcome-validator.ts` decides
 * what happened by scanning candles for a touch of the stop or target. It assumes a fill exactly at
 * the signal's entry, an exit exactly at the level, and no slippage, swap or commission. None of
 * those assumptions has ever been checked, because nothing recorded what the broker actually did.
 *
 * `reconcile` cannot answer it either: it reports only what is OPEN right now, so a position that
 * has already closed — precisely the one whose outcome we want — is invisible to it. Deal history
 * is the only source that reports closes, and a deal carrying `closePositionDetail` is a closing
 * deal reporting realised grossProfit, swap and commission.
 *
 * MONEY IS SCALED. `moneyDigits` is an EXPONENT: real = raw / 10^moneyDigits. The docs' own
 * example is moneyDigits=8 meaning 10053099944 becomes 100.53099944. Storing the raw integer would
 * overstate profit a hundred-million-fold, and this project has already shipped this exact class of
 * bug once (calcVolume was 100,000x out because volume is in centi-units). So: de-scale on the way
 * in, AND keep the untouched payload in `raw`, so a scaling mistake stays recoverable instead of
 * being permanently baked into the record.
 *
 * Read-only against the broker. Fetching history places, amends and closes nothing.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { ctraderExecutor } from './ctrader-executor';

/**
 * Chunk size for history requests. The tick endpoints cap at one week; match that rather than
 * discover the deal endpoint's own limit in production.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How far back to look on a cold start, with no watermark and no order to anchor to. */
const COLD_START_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Apply the moneyDigits exponent.
 *
 * Returns null rather than a wrong number when the exponent is missing or implausible. A silently
 * mis-scaled profit is far worse than an absent one: absent is visible, wrong is not.
 */
export function descale(raw: unknown, moneyDigits: unknown): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  const d = Number(moneyDigits);
  // cTrader uses small exponents (commonly 2 for currency, 8 for high precision). Anything outside
  // this band means we did not understand the payload, so refuse rather than guess.
  if (!Number.isFinite(d) || d < 0 || d > 12) return null;
  return v / Math.pow(10, d);
}

export interface SyncResult {
  ranFrom: string;
  ranTo: string;
  dealsSeen: number;
  dealsStored: number;
  closesApplied: number;
  skipped?: string;
}

/**
 * Pull deals since the watermark and record them. Idempotent: deals are keyed on the broker's own
 * dealId, so re-running rewrites the same rows rather than duplicating them.
 */
export async function syncBrokerDeals(opts: { maxWindows?: number } = {}): Promise<SyncResult> {
  const maxWindows = opts.maxWindows ?? 6;
  const now = Date.now();

  // Where to resume from, in order of preference:
  //   1. the watermark from the last successful run
  //   2. just before the earliest order we ever recorded (no deal of ours can predate it)
  //   3. a fixed lookback, for a genuinely cold start
  let fromMs: number;
  const wmRows = (await db.execute(sql`SELECT last_synced_to FROM ctrader_deal_sync WHERE id = 1`)) as any[];
  const wm = wmRows[0];
  if (wm?.last_synced_to) {
    fromMs = new Date(wm.last_synced_to).getTime();
  } else {
    const firstRows = (await db.execute(sql`
      SELECT min(created_at) AS first_order FROM ctrader_executions WHERE position_id IS NOT NULL
    `)) as any[];
    const firstOrder = firstRows[0]?.first_order;
    fromMs = firstOrder
      ? new Date(firstOrder).getTime() - 60_000   // a minute of slack around the boundary
      : now - COLD_START_LOOKBACK_MS;
  }

  if (fromMs >= now) {
    return {
      ranFrom: new Date(fromMs).toISOString(), ranTo: new Date(now).toISOString(),
      dealsSeen: 0, dealsStored: 0, closesApplied: 0, skipped: 'watermark is already current',
    };
  }

  let dealsSeen = 0, dealsStored = 0, closesApplied = 0;
  let cursor = fromMs;

  for (let w = 0; w < maxWindows && cursor < now; w++) {
    const windowEnd = Math.min(cursor + WINDOW_MS, now);
    const deals = await ctraderExecutor.listDeals(cursor, windowEnd);
    dealsSeen += deals.length;

    for (const d of deals) {
      const r = await storeDeal(d);
      if (r.stored) dealsStored++;
      if (r.appliedClose) closesApplied++;
    }

    cursor = windowEnd;
  }

  await db.execute(sql`
    INSERT INTO ctrader_deal_sync (id, last_synced_to, last_run_at, deals_seen)
    VALUES (1, ${new Date(cursor).toISOString()}, now(), ${dealsSeen})
    ON CONFLICT (id) DO UPDATE
      SET last_synced_to = EXCLUDED.last_synced_to,
          last_run_at    = now(),
          deals_seen     = ctrader_deal_sync.deals_seen + EXCLUDED.deals_seen
  `);

  return {
    ranFrom: new Date(fromMs).toISOString(),
    ranTo: new Date(cursor).toISOString(),
    dealsSeen, dealsStored, closesApplied,
  };
}

/** Upsert one deal, and if it closes a position, fold the outcome onto the order that opened it. */
async function storeDeal(d: any): Promise<{ stored: boolean; appliedClose: boolean }> {
  const cpd = d?.closePositionDetail;
  const isClose = !!cpd;

  // closePositionDetail carries its OWN moneyDigits. Use it for its own fields rather than the
  // deal's — they are documented separately and there is no guarantee they agree.
  const cpdDigits = cpd?.moneyDigits ?? d?.moneyDigits;

  const grossProfit     = isClose ? descale(cpd?.grossProfit, cpdDigits) : null;
  const swap            = isClose ? descale(cpd?.swap, cpdDigits) : null;
  const closeCommission = isClose ? descale(cpd?.commission, cpdDigits) : null;
  const balanceAfter    = isClose ? descale(cpd?.balance, cpdDigits) : null;
  const dealCommission  = descale(d?.commission, d?.moneyDigits);

  // Net is what actually hit the account: gross, minus financing, minus costs. cTrader reports
  // swap and commission as signed values already, so this is a sum, not a subtraction.
  const netProfit = isClose && grossProfit !== null
    ? grossProfit + (swap ?? 0) + (closeCommission ?? 0)
    : null;

  const executedAt = Number(d?.executionTimestamp ?? d?.createTimestamp);
  const executedIso = Number.isFinite(executedAt) && executedAt > 0
    ? new Date(executedAt).toISOString()
    : null;

  try {
    await db.execute(sql`
      INSERT INTO ctrader_deals (
        deal_id, order_id, position_id, symbol_id, trade_side, volume, filled_volume,
        execution_price, deal_status, commission, money_digits, executed_at,
        is_close, entry_price, gross_profit, swap, close_commission, closed_volume,
        balance_after, net_profit, raw
      ) VALUES (
        ${d.dealId}, ${d.orderId ?? null}, ${d.positionId ?? null}, ${d.symbolId ?? null},
        ${d.tradeSide ?? null}, ${d.volume ?? null}, ${d.filledVolume ?? null},
        ${d.executionPrice ?? null}, ${d.dealStatus ?? null}, ${dealCommission},
        ${d.moneyDigits ?? null}, ${executedIso},
        ${isClose}, ${cpd?.entryPrice ?? null}, ${grossProfit}, ${swap}, ${closeCommission},
        ${cpd?.closedVolume ?? null}, ${balanceAfter}, ${netProfit}, ${JSON.stringify(d)}
      )
      ON CONFLICT (deal_id) DO UPDATE SET
        deal_status   = EXCLUDED.deal_status,
        is_close      = EXCLUDED.is_close,
        gross_profit  = EXCLUDED.gross_profit,
        swap          = EXCLUDED.swap,
        net_profit    = EXCLUDED.net_profit,
        balance_after = EXCLUDED.balance_after,
        raw           = EXCLUDED.raw
    `);
  } catch (e: any) {
    console.error(`[deals] could not store deal ${d?.dealId}:`, e?.message ?? e);
    return { stored: false, appliedClose: false };
  }

  if (!isClose || d?.positionId == null) return { stored: true, appliedClose: false };

  // Fold the close onto the order that opened this position.
  //
  // Matched on position_id, which the broker assigned and we recorded at order time — never on
  // symbol or timing, which would collide across concurrent trades on the same pair.
  try {
    const res = (await db.execute(sql`
      UPDATE ctrader_executions
      SET closed_at          = ${executedIso},
          exit_price         = ${d.executionPrice ?? null},
          realized_pnl       = ${netProfit},
          broker_entry_price = ${cpd?.entryPrice ?? null}
      WHERE position_id = ${d.positionId}
      RETURNING id
    `)) as any[];
    return { stored: true, appliedClose: res.length > 0 };
  } catch (e: any) {
    console.error(`[deals] could not apply close for position ${d?.positionId}:`, e?.message ?? e);
    return { stored: true, appliedClose: false };
  }
}

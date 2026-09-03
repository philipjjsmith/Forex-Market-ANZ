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
import { telegramNotifier } from './telegram-notifier';

/**
 * How far back a COLD START looks — no watermark, nothing to resume from.
 *
 * Deliberately generous, and deliberately NOT anchored to our own records. The previous version
 * anchored to the earliest `ctrader_executions` row carrying a position id, on the reasoning that
 * no deal of ours could predate our own order record. That reasoning is WRONG, and it cost a real
 * trade:
 *
 *   `ctrader_executions` was created 2026-09-01. Position 285950003 was opened 2026-08-31 — the
 *   first order this system ever placed, before the table existed. The watermark therefore started
 *   AFTER a real closed trade, the sync never looked at that window, and our realised P&L was
 *   short by -0.18. It reported -0.41 against a true balance change of -0.59.
 *
 * Nothing in our database noticed. **Myfxbook did, within minutes of being connected** — the
 * balance disagreed with our sum. That is precisely what independent verification is for, and it
 * is the argument for this constant being generous rather than clever.
 *
 * The broker's history is older than our ability to record it, and it can contain deals we did not
 * cause at all (a manual trade placed in cTrader). Our own tables are not a lower bound on it.
 */
const COLD_START_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Maximum span of history one run will process.
 *
 * A 365-day cold start is far too much for a single cron tick, so a run takes a bite and advances
 * the watermark. The next tick resumes from there and it converges within a couple of hours,
 * unattended. Bounded work per run matters more than finishing in one pass — an unbounded catch-up
 * on a 5-minute cron is how you get overlapping runs.
 */
const MAX_SPAN_PER_RUN_MS = 30 * 24 * 60 * 60 * 1000;

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

/**
 * Build the position-closed alert text.
 *
 * EXPORTED so the admin format-test sends byte-identical text to what a real close sends — a test
 * that reproduces the template proves only that the copy works, and copies drift. Pure function.
 */
export function buildCloseAlertMessage(a: {
  win: boolean; exitPrice: any; entryPrice: any;
  grossProfit: number | null; swap: number | null; closeCommission: number | null;
  netProfit: number | null; balanceAfter: number | null; positionId: any;
}): string {
  const f = (v: number | null) => (v === null || v === undefined ? '—' : v.toFixed(2));
  return `${a.win ? '🟢' : '🔴'} <b>POSITION CLOSED — DEMO</b>

`
    + `Exit: ${a.exitPrice ?? '—'}
`
    + `Entry: ${a.entryPrice ?? '—'}
`
    + `Gross: ${f(a.grossProfit)}
`
    + `Swap: ${f(a.swap)}
`
    + `Commission: ${f(a.closeCommission)}
`
    + `<b>Net: ${f(a.netProfit)}</b>
`
    + `Balance: ${f(a.balanceAfter)}
`
    + `Position: <code>${a.positionId}</code>`;
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
export async function syncBrokerDeals(opts: { maxSpanMs?: number } = {}): Promise<SyncResult> {
  const maxSpan = opts.maxSpanMs ?? MAX_SPAN_PER_RUN_MS;
  const now = Date.now();

  // Resume from the watermark, or cold-start at a fixed lookback.
  //
  // Note what is NOT consulted: our own `ctrader_executions` table. See COLD_START_LOOKBACK_MS —
  // anchoring to it silently skipped a real closed trade, because the broker's history predates
  // the table.
  let fromMs: number;
  const wmRows = (await db.execute(sql`SELECT last_synced_to FROM ctrader_deal_sync WHERE id = 1`)) as any[];
  const wm = wmRows[0];
  fromMs = wm?.last_synced_to
    ? new Date(wm.last_synced_to).getTime()
    : now - COLD_START_LOOKBACK_MS;

  if (fromMs >= now) {
    return {
      ranFrom: new Date(fromMs).toISOString(), ranTo: new Date(now).toISOString(),
      dealsSeen: 0, dealsStored: 0, closesApplied: 0, skipped: 'watermark is already current',
    };
  }

  let dealsSeen = 0, dealsStored = 0, closesApplied = 0;

  // One call, one socket. listDeals chunks the range internally and handles hasMore paging.
  const cursor = Math.min(now, fromMs + maxSpan);
  const deals = await ctraderExecutor.listDeals(fromMs, cursor);
  dealsSeen += deals.length;

  for (const d of deals) {
    const r = await storeDeal(d);
    if (r.stored) dealsStored++;
    if (r.appliedClose) closesApplied++;
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

/**
 * Start of the CURRENT broker trading day, as a Date.
 *
 * The5ers resets its daily drawdown at 00:00 server time, and this broker's server day boundary is
 * 17:00 New York — established empirically tonight: cTrader D1 trendbars stamp at 21:00 UTC while
 * Twelve Data stamps 00:00 UTC, a three-hour offset that is exactly the NY close.
 *
 * Computed via `America/New_York` rather than a fixed UTC hour, because 17:00 NY is 21:00 UTC under
 * EDT and 22:00 under EST. This project already shipped that exact bug once: a hardcoded 21:00 UTC
 * week boundary was wrong ~5 months a year and mis-flagged 853 genuine bars per pair.
 */
export function brokerDayStart(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).formatToParts(now);
  const nyHour = Number(parts.find(p => p.type === 'hour')!.value) % 24;

  // Rewind to the most recent 17:00 New York.
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(0);
  // Step back an hour at a time until NY local hour is 17 and it is in the past.
  for (let i = 0; i < 48; i++) {
    const h = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hour12: false,
    }).formatToParts(d).find(p => p.type === 'hour')!.value) % 24;
    if (h === 17 && d <= now) return d;
    d.setUTCHours(d.getUTCHours() - 1);
  }
  // Unreachable in practice; fall back to 24h ago rather than returning something wrong.
  void nyHour;
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export interface DailyLossStatus {
  /** null when it could not be determined — callers must treat that as "do not trade". */
  lossPercent: number | null;
  realisedToday: number | null;
  anchorBalance: number | null;
  dayStart: string;
  reason?: string;
}

/**
 * Realised loss so far in the current broker day, as a POSITIVE percentage of the day's opening
 * balance. Profit returns 0, never a negative "loss".
 *
 * BALANCE-BASED, matching The5ers: only CLOSED trades count. Floating unrealised losses do not
 * breach a balance-based daily limit, and `ctrader_deals` holds exactly the closed set.
 *
 * The anchor is the balance after the last close BEFORE the day started — the previous day's
 * closing balance — falling back to the configured account balance when there is no prior close.
 */
export async function getDailyLossStatus(configuredBalance: number): Promise<DailyLossStatus> {
  const start = brokerDayStart();
  const iso = start.toISOString();
  try {
    const todayRows = (await db.execute(sql`
      SELECT COALESCE(SUM(net_profit), 0) AS realised
      FROM ctrader_deals WHERE is_close IS TRUE AND executed_at >= ${iso}
    `)) as any[];
    const priorRows = (await db.execute(sql`
      SELECT balance_after FROM ctrader_deals
      WHERE is_close IS TRUE AND balance_after IS NOT NULL AND executed_at < ${iso}
      ORDER BY executed_at DESC LIMIT 1
    `)) as any[];

    const realised = Number(todayRows[0]?.realised ?? 0);
    const anchor = priorRows[0]?.balance_after !== undefined && priorRows[0]?.balance_after !== null
      ? Number(priorRows[0].balance_after)
      : configuredBalance;

    if (!Number.isFinite(realised) || !Number.isFinite(anchor) || anchor <= 0) {
      return { lossPercent: null, realisedToday: null, anchorBalance: null, dayStart: iso,
               reason: 'could not compute a usable anchor balance' };
    }
    // Profit is not negative loss.
    const lossPercent = realised < 0 ? (-realised / anchor) * 100 : 0;
    return { lossPercent, realisedToday: realised, anchorBalance: anchor, dayStart: iso };
  } catch (e: any) {
    return { lossPercent: null, realisedToday: null, anchorBalance: null, dayStart: iso,
             reason: e?.message ?? String(e) };
  }
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
        -- Only the FIRST time. Without this guard a re-sync — an overlapping window, a reset
        -- watermark, a manual button press — would re-apply the same close and re-fire the
        -- Telegram alert, so the operator would get a "position closed" push for a trade that
        -- closed hours ago. Makes the whole path idempotent, not just the deal insert.
        AND closed_at IS NULL
      RETURNING id
    `)) as any[];
    const applied = res.length > 0;

    // Tell the operator on their phone how the trade actually ENDED — the number that matters,
    // and one that only exists here. The candle model reports pips against an assumed exit; this
    // is money out of the account, after swap and commission it does not carry at all.
    //
    // Only for orders WE placed (applied === true, i.e. the position matched a row we opened), so
    // a trade placed by hand in cTrader does not generate a bot alert.
    if (applied) {
      try {
        const row = res[0] as any;
        const win = (netProfit ?? 0) >= 0;
        await telegramNotifier.sendText(
          buildCloseAlertMessage({
            win, exitPrice: d.executionPrice, entryPrice: cpd?.entryPrice,
            grossProfit, swap, closeCommission, netProfit, balanceAfter,
            positionId: d.positionId,
          }),
          'paid', 'HTML'
        );
      } catch (e: any) {
        console.warn(`[deals] close alert not sent: ${e?.message ?? e}`);
      }
    }

    return { stored: true, appliedClose: applied };
  } catch (e: any) {
    console.error(`[deals] could not apply close for position ${d?.positionId}:`, e?.message ?? e);
    return { stored: true, appliedClose: false };
  }
}

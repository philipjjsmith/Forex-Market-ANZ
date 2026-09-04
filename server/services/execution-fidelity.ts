/**
 * How wrong is the modelled record, measured against the broker's own money?
 *
 * WHY THIS EXISTS
 *
 * `signal_history` records an outcome derived from 5-minute candles: a level was touched, so the
 * trade is booked at that level. `ctrader_deals` records what the account was actually credited or
 * debited. Nothing has ever compared the two per trade, and on 2026-09-04 they disagreed by
 * **3.76 R on a single trade** — a USD/CHF LONG recorded `STOP_HIT` at -9.8 pips that the broker
 * settled at **+$268.75**. The programme's entire measured edge is -0.055 R per trade, so a model
 * error of that size on one trade is not a rounding detail; it is larger than everything the
 * backtest was built to detect.
 *
 * WHY CANDLES CAN NEVER FIND THIS
 *
 * On the same day AUD/USD's stop filled at 0.71753 — BELOW the 5-minute bar's low of 0.71785,
 * because Twelve Data publishes mid and a closing LONG sells at the bid. No candle-based
 * measurement can recover that exit price. `outcome-validator.ts` duly recorded `STOP_HIT` at the
 * stop level, -8.60 pips, while the broker took **-$336.95** — a realised **-3.30 R** on a trade
 * whose entire intended risk was 1 R. Only the deal record knows.
 *
 * WHAT THIS IS NOT
 *
 * It is NOT a correction to the outcome labels and it changes no decision. `outcome-validator`'s
 * stop-first rule on an ambiguous bar is deliberate and conservative and should stay. This reports
 * the size of the disagreement so it stops being invisible.
 *
 * NO NEW SCHEMA. Every input is a column that already exists and is already populated. A migration
 * was considered and rejected: with 5 closed positions the measurement should stay recomputable,
 * because the rule for deriving it is far more likely to change than the data is.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface FidelityRow {
  symbol: string;
  side: string;
  signalId: string | null;
  positionId: string | null;
  closedAt: string | null;

  /** Distance from signal entry to signal stop, in pips. This is 1 R by definition. */
  riskPips: number | null;
  /** Quoted entry vs the broker's actual position entry. POSITIVE = ADVERSE. */
  entryDriftPips: number | null;

  modelledOutcome: string | null;
  modelledPips: number | null;
  /** What the candle model thinks the trade returned, in R. */
  modelledR: number | null;
  /** What the broker's prices say it returned, in R. Gross of commission. */
  realisedR: number | null;
  /** realisedR - modelledR. The number this file exists to produce. */
  errorR: number | null;

  realisedPnl: number | null;
  /**
   * An INDEPENDENT path to R that shares no input with `realisedR`: it uses only the cash P&L,
   * the balance and the configured risk percentage, never a price. Agreement between the two is
   * evidence the price arithmetic is right; disagreement beyond commission (~0.73 pips per round
   * turn, measured 2026-09-02) means something in the pipeline is wrong. Net of costs, so it
   * should sit slightly BELOW `realisedR` on a winner and slightly below it on a loser too.
   */
  impliedR: number | null;
}

export interface FidelityReport {
  generatedAt: string;
  rows: FidelityRow[];
  summary: {
    trades: number;
    /** Rows where BOTH a modelled and a realised R exist. Smoke tests have no signal, so no R. */
    comparable: number;
    /** Mean |errorR|. How far the modelled record sits from the money, on average. */
    meanAbsErrorR: number | null;
    maxAbsErrorR: number | null;
    /** Trades where the model and the broker disagree about whether it WON. */
    signDisagreements: number;
    meanRealisedR: number | null;
    meanModelledR: number | null;
    /** Rows where realisedR and impliedR differ by more than 0.25 R — a pipeline smell. */
    crossCheckFailures: number;
    note: string;
  };
}

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pipFactor = (symbol: string) => (symbol?.includes('JPY') ? 100 : 10000);

export async function buildFidelityReport(limit = 100): Promise<FidelityReport> {
  // The closing deal carries balance_after and net_profit, so balance BEFORE the close is
  // recoverable as (balance_after - net_profit) — which is what the position was risked against.
  const rows = (await db.execute(sql`
    SELECT e.symbol, e.side, e.signal_id, e.position_id, e.closed_at,
           e.signal_entry, e.signal_stop, e.broker_entry_price, e.exit_price,
           e.realized_pnl, e.position_size_percent,
           s.outcome                                       AS modelled_outcome,
           COALESCE(s.corrected_outcome, s.outcome)        AS effective_outcome,
           COALESCE(s.corrected_profit_loss_pips, s.profit_loss_pips) AS modelled_pips,
           d.balance_after, d.net_profit
    FROM ctrader_executions e
    LEFT JOIN signal_history s ON s.signal_id = e.signal_id
    LEFT JOIN LATERAL (
      SELECT balance_after, net_profit FROM ctrader_deals
      WHERE position_id = e.position_id AND is_close IS TRUE
      ORDER BY executed_at DESC LIMIT 1
    ) d ON TRUE
    WHERE e.position_id IS NOT NULL
      AND e.exit_price IS NOT NULL
      AND e.broker_entry_price IS NOT NULL
    ORDER BY e.closed_at DESC NULLS LAST
    LIMIT ${limit}
  `)) as any[];

  const out: FidelityRow[] = [];

  for (const r of rows) {
    const f          = pipFactor(r.symbol);
    const long       = r.side === 'LONG';
    const sigEntry   = num(r.signal_entry);
    const sigStop    = num(r.signal_stop);
    const brokerIn   = num(r.broker_entry_price);
    const exit       = num(r.exit_price);
    const modPips    = num(r.modelled_pips);

    // 1 R, defined by the SIGNAL's own geometry — the same denominator the backtest uses, so
    // modelled and realised are expressed on one scale and are directly subtractable.
    const risk = sigEntry !== null && sigStop !== null ? Math.abs(sigEntry - sigStop) : null;
    const riskPips = risk !== null ? Number((risk * f).toFixed(2)) : null;

    const realisedR = risk && risk > 0 && brokerIn !== null && exit !== null
      ? Number((((long ? exit - brokerIn : brokerIn - exit)) / risk).toFixed(3))
      : null;

    const modelledR = risk && risk > 0 && modPips !== null && riskPips
      ? Number((modPips / riskPips).toFixed(3))
      : null;

    const entryDriftPips = sigEntry !== null && brokerIn !== null
      ? Number(((long ? brokerIn - sigEntry : sigEntry - brokerIn) * f).toFixed(2))
      : null;

    // Independent of every price above.
    const net        = num(r.net_profit) ?? num(r.realized_pnl);
    const balAfter   = num(r.balance_after);
    const pct        = num(r.position_size_percent);
    const balBefore  = balAfter !== null && net !== null ? balAfter - net : null;
    const riskUsd    = balBefore !== null && pct ? balBefore * (pct / 100) : null;
    const impliedR   = riskUsd && riskUsd > 0 && net !== null
      ? Number((net / riskUsd).toFixed(3))
      : null;

    out.push({
      symbol: r.symbol, side: r.side,
      signalId: r.signal_id ?? null, positionId: r.position_id ?? null,
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      riskPips, entryDriftPips,
      modelledOutcome: r.effective_outcome ?? r.modelled_outcome ?? null,
      modelledPips: modPips, modelledR, realisedR,
      errorR: realisedR !== null && modelledR !== null
        ? Number((realisedR - modelledR).toFixed(3)) : null,
      realisedPnl: net, impliedR,
    });
  }

  const withBoth = out.filter(r => r.errorR !== null);
  const absErrs  = withBoth.map(r => Math.abs(r.errorR as number));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const signDisagreements = withBoth.filter(
    r => Math.sign(r.realisedR as number) !== Math.sign(r.modelledR as number)
  ).length;

  const crossCheckFailures = out.filter(
    r => r.realisedR !== null && r.impliedR !== null
      && Math.abs(r.realisedR - r.impliedR) > 0.25
  ).length;

  const realised = out.map(r => r.realisedR).filter((v): v is number => v !== null);
  const modelled = out.map(r => r.modelledR).filter((v): v is number => v !== null);

  return {
    generatedAt: new Date().toISOString(),
    rows: out,
    summary: {
      trades: out.length,
      comparable: withBoth.length,
      meanAbsErrorR: absErrs.length ? Number((mean(absErrs) as number).toFixed(3)) : null,
      maxAbsErrorR: absErrs.length ? Number(Math.max(...absErrs).toFixed(3)) : null,
      signDisagreements,
      meanRealisedR: realised.length ? Number((mean(realised) as number).toFixed(3)) : null,
      meanModelledR: modelled.length ? Number((mean(modelled) as number).toFixed(3)) : null,
      crossCheckFailures,
      note:
        'realisedR is GROSS (prices only); impliedR is NET (cash, balance and risk % only) and '
        + 'shares no input with it, so agreement is evidence the arithmetic is right and a gap '
        + 'beyond commission is a pipeline fault. errorR = realisedR - modelledR: POSITIVE means '
        + 'the broker did BETTER than the candle model recorded. signDisagreements counts trades '
        + 'where the two do not even agree on whether it won. This CORRECTS NOTHING and changes '
        + 'no decision — it measures how far the modelled record sits from the money. '
        + 'WHAT A CROSS-CHECK FAILURE ACTUALLY MEANS: realisedR is denominated in the INTENDED '
        + 'stop distance while impliedR divides cash by the INTENDED risk budget, so if the '
        + 'position was MIS-SIZED the two diverge by exactly the sizing error. Measured '
        + '2026-09-05: the two trades placed BEFORE the pipValuePerLot fix show ratios of 1.27 '
        + 'and 1.18 against a known oversizing factor of 1.229, while the two placed AFTER it '
        + 'agree to 1.001 and 1.012. This check therefore detects position-sizing faults '
        + 'independently of any price, which is more than it was built to do.',
    },
  };
}

/**
 * A performance statement a subscriber could actually audit.
 *
 * WHY THIS SHAPE
 *
 * Research into paid signal channels (2026) found the norm is self-reported results and posted
 * screenshots, and the single most-cited credibility test in the field is "ask for the verified
 * track record — if they refuse, they are fake". The two failure modes that make a published
 * record worthless are both silent:
 *
 *   1. CHERRY-PICKING — only the winners get posted. Defeated here by deriving the record from
 *      `signal_history_deduped`, which holds EVERY signal the engine ever generated. There is no
 *      "featured trades" path and no way to exclude one; a losing month reports as a losing month.
 *
 *   2. MODELLED RESULTS PASSED OFF AS REAL — pips measured against an assumed fill at an assumed
 *      exit, with no spread, commission or swap. Defeated by reporting the modelled figures and
 *      the BROKER'S OWN realised P&L side by side, from `ctrader_deals`. On the first real round
 *      trip, commission alone was a third of the loss — a cost the modelled figure cannot see.
 *
 * Reporting both, and labelling which is which, is the whole product. A channel that publishes
 * only the flattering number is indistinguishable from the ones that fabricate it.
 *
 * ALWAYS reads `signal_history_deduped`, never the raw table.
 *
 * THE HISTORICAL AGGREGATE IS NOT EVIDENCE — READ THIS BEFORE QUOTING ANY NUMBER
 * -----------------------------------------------------------------------------
 * Measured 2026-09-03, the near-duplicate rate by month (same symbol+direction, within 240 min,
 * entry inside half the stop distance):
 *
 *     2025-11  90%   2025-12  91%   2026-01  84%   2026-02  69%
 *     2026-03  50%   2026-05  38%   2026-06  25%   2026-09   0%
 *
 * The early months — which dominate the sample — are ~90% re-emissions of the same idea. Until
 * September the generator re-emitted on every 15-minute cron cycle; the smallest gap between two
 * same-pair signals was 15 minutes for ten straight months.
 *
 * Because duplicates cluster on LOSERS, the deduplication rule you choose decides the SIGN of the
 * result:
 *
 *     one per pair per day        73 trades   +102.7 pips
 *     240min / 0.5x risk          84 trades    +75.9 pips
 *     120min / 0.5x risk          87 trades   +176.7 pips
 *     distinct entry price       172 trades   -555.0 pips
 *     no deduplication           309 trades  -1190.2 pips
 *
 * A swing of +176 to -1190 on a measurement choice with no obviously correct answer. Selecting the
 * rule after seeing which produces a favourable number is exactly the researcher degree of freedom
 * the pre-registration exists to eliminate (§8: no measured cell may drive a choice).
 *
 * So the historical figure is reported as CONTEXT and explicitly labelled unreliable. The evidence
 * that settles the question is the pre-registered backtest — 1,095 replayed trades, -0.0552 R —
 * which is immune to this because it replays from PRICE DATA under defined entry rules rather than
 * from a duplicate-riddled signal log.
 *
 * FORWARD data is clean by construction and needs no rule at all. That is the number to watch.
 */
import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface PerformanceReport {
  generatedAt: string;
  signals: {
    total: number;
    wins: number;
    losses: number;
    expired: number;
    winRatePct: number | null;
    netPips: number | null;
    firstAt: string | null;
    lastAt: string | null;
  };
  broker: {
    tradesClosed: number;
    realisedNet: number | null;
    grossTotal: number | null;
    commissionTotal: number | null;
    swapTotal: number | null;
    lastBalance: number | null;
  };
  /**
   * The clean sample. No deduplication rule applied or needed — post-cooldown signals are
   * distinct by construction. Small, honest, and the only part of the record that is evidence.
   */
  forward: {
    since: string;
    total: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    netPips: number | null;
  };
  /** Ready-to-post Telegram message, HTML parse mode. */
  message: string;
}

/**
 * When the signal log became trustworthy.
 *
 * The 240-minute per-symbol cooldown only became EFFECTIVE in September 2026: the smallest gap
 * between two same-pair signals was 15 minutes every month from 2025-11 to 2026-08, then 321
 * minutes in 2026-09. From this date every signal is distinct by construction, so forward figures
 * need no deduplication rule and carry none of the ambiguity above.
 */
export const FORWARD_START = '2026-09-01';

const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
const fmt = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));

export async function buildPerformanceReport(): Promise<PerformanceReport> {
  // The COMPLETE signal record. No filter that could drop an inconvenient row.
  const sigRows = (await db.execute(sql`
    SELECT
      count(*)::int                                                   AS total,
      count(*) FILTER (WHERE outcome LIKE 'TP%')::int                 AS wins,
      count(*) FILTER (WHERE outcome = 'STOP_HIT')::int               AS losses,
      count(*) FILTER (WHERE outcome = 'EXPIRED')::int                AS expired,
      ROUND(SUM(profit_loss_pips)::numeric, 1)                        AS net_pips,
      MIN(created_at)                                                 AS first_at,
      MAX(created_at)                                                 AS last_at
    FROM signal_history_deduped
    WHERE outcome IS NOT NULL AND outcome <> 'PENDING'
  `)) as any[];
  const s = sigRows[0] ?? {};

  const decided = (Number(s.wins) || 0) + (Number(s.losses) || 0);
  const winRate = decided > 0 ? (Number(s.wins) / decided) * 100 : null;

  // What the broker actually paid or took. Only CLOSING deals carry realised money.
  const brkRows = (await db.execute(sql`
    SELECT
      count(*)::int                          AS trades_closed,
      SUM(net_profit)                        AS realised_net,
      SUM(gross_profit)                      AS gross_total,
      SUM(close_commission)                  AS commission_total,
      SUM(swap)                              AS swap_total
    FROM ctrader_deals
    WHERE is_close IS TRUE
  `)) as any[];
  const b = brkRows[0] ?? {};

  // Forward-only: the clean window. Read from the RAW table on purpose — after the cooldown took
  // effect there are no duplicates to remove, so applying a dedup rule here could only distort it.
  const fwdRows = (await db.execute(sql`
    SELECT
      count(*)::int                                                AS total,
      count(*) FILTER (WHERE COALESCE(corrected_outcome, outcome) LIKE 'TP%')::int   AS wins,
      count(*) FILTER (WHERE COALESCE(corrected_outcome, outcome) = 'STOP_HIT')::int AS losses,
      ROUND(SUM(COALESCE(corrected_profit_loss_pips, profit_loss_pips))::numeric, 1) AS net_pips
    FROM signal_history
    WHERE data_quality = 'production'
      AND created_at >= ${FORWARD_START}
      AND COALESCE(corrected_outcome, outcome) IS NOT NULL
      AND COALESCE(corrected_outcome, outcome) <> 'PENDING'
  `)) as any[];
  const fw = fwdRows[0] ?? {};
  const fwDecided = (Number(fw.wins) || 0) + (Number(fw.losses) || 0);

  const balRows = (await db.execute(sql`
    SELECT balance_after FROM ctrader_deals
    WHERE is_close IS TRUE AND balance_after IS NOT NULL
    ORDER BY executed_at DESC LIMIT 1
  `)) as any[];

  const report: PerformanceReport = {
    generatedAt: new Date().toISOString(),
    signals: {
      total: Number(s.total) || 0,
      wins: Number(s.wins) || 0,
      losses: Number(s.losses) || 0,
      expired: Number(s.expired) || 0,
      winRatePct: winRate,
      netPips: num(s.net_pips),
      firstAt: s.first_at ? new Date(s.first_at).toISOString() : null,
      lastAt: s.last_at ? new Date(s.last_at).toISOString() : null,
    },
    broker: {
      tradesClosed: Number(b.trades_closed) || 0,
      realisedNet: num(b.realised_net),
      grossTotal: num(b.gross_total),
      commissionTotal: num(b.commission_total),
      swapTotal: num(b.swap_total),
      lastBalance: num(balRows[0]?.balance_after),
    },
    forward: {
      since: FORWARD_START,
      total: Number(fw.total) || 0,
      wins: Number(fw.wins) || 0,
      losses: Number(fw.losses) || 0,
      winRatePct: fwDecided > 0 ? (Number(fw.wins) / fwDecided) * 100 : null,
      netPips: num(fw.net_pips),
    },
    message: '',
  };

  report.message = composeMessage(report);
  return report;
}

/**
 * Compose the post. HTML, not MarkdownV2 — every number here contains a period, and MarkdownV2
 * rejects an unescaped one with a 400. That defect silently killed every alert on 2026-09-02.
 */
function composeMessage(r: PerformanceReport): string {
  const sig = r.signals;
  const brk = r.broker;
  const period = sig.firstAt
    ? `${sig.firstAt.slice(0, 10)} to ${sig.lastAt?.slice(0, 10) ?? 'now'}`
    : 'no resolved signals yet';

  const fwd = r.forward;
  const fwdDecided = fwd.wins + fwd.losses;

  // The clean sample leads. The historical aggregate follows, labelled — because publishing a
  // rule-dependent number as if it were a result is the exact dishonesty this report exists to
  // avoid, and it would be dishonesty in whichever direction happened to flatter.
  const lines: string[] = [
    `📊 <b>ArgoFX — Verified Performance</b>`,
    ``,
    `<b>FORWARD RECORD</b> <i>(since ${fwd.since})</i>`,
    fwdDecided === 0
      ? `<i>No resolved signals yet in the clean window.</i>`
      : `Resolved: ${fwd.total}
Wins ${fwd.wins} · Losses ${fwd.losses}
`
        + `Win rate: ${fwd.winRatePct === null ? '—' : fwd.winRatePct.toFixed(1) + '%'}
`
        + `Net: ${fmt(fwd.netPips, 1)} pips <i>(modelled)</i>`,
    `<i>Every signal since the duplicate-suppression cooldown took effect. No deduplication rule `
    + `is applied because none is needed — these signals are distinct by construction.</i>`,
  ];

  if (brk.tradesClosed > 0) {
    lines.push(
      ``,
      `<b>BROKER-VERIFIED — cTrader demo</b>`,
      `Closed trades: ${brk.tradesClosed}`,
      `Gross: ${fmt(brk.grossTotal)}`,
      `Commission: ${fmt(brk.commissionTotal)}`,
      `Swap: ${fmt(brk.swapTotal)}`,
      `<b>Realised net: ${fmt(brk.realisedNet)}</b>`,
      brk.lastBalance !== null ? `Balance: ${fmt(brk.lastBalance)}` : '',
      ``,
      `<i>Realised figures come from the broker's own deal records and include`
      + ` commission and swap. Pip figures are modelled from 5-minute price data`
      + ` and carry neither.</i>`,
    );
  } else {
    lines.push(
      ``,
      `<b>BROKER-VERIFIED</b>`,
      `<i>No executed trades closed yet. Pip figures above are modelled from`
      + ` 5-minute price data and do not include spread, commission or swap.</i>`,
    );
  }

  lines.push(
    ``,
    `<b>HISTORICAL — context only, not evidence</b>`,
    `<i>${period}</i>`,
    `${sig.total} resolved · ${sig.wins}W ${sig.losses}L · `
    + `${sig.winRatePct === null ? '—' : sig.winRatePct.toFixed(1) + '%'} · `
    + `${fmt(sig.netPips, 1)} pips`,
    `⚠️ <i>Before the cooldown took effect the engine re-emitted the same idea every 15 minutes — `
    + `up to 91% of a month's rows were near-duplicates. Because duplicates cluster on losers, the `
    + `deduplication rule chosen moves this figure between roughly +177 and -1190 pips. It is `
    + `reported for completeness and should not be read as a result in either direction.</i>`,
    ``,
    `<i>Outcomes are validated against 5-minute price data, and executed trades are reconciled`
    + ` against the broker's own records.</i>`,
    ``,
    `⚠️ <b>Demo account.</b> Past performance does not indicate future results.`,
    `📡 General advice only. Not tailored to your circumstances. Forex trading`
    + ` carries significant risk of loss.`,
  );

  return lines.filter(l => l !== '').join('\n');
}

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
 * ALWAYS reads `signal_history_deduped`, never the raw table: raw rows over-count 4.31x and the
 * duplicates cluster on losers, so the raw table would UNDERSTATE the win rate. Using it would be
 * dishonest in the unusual direction, and still wrong.
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
  /** Ready-to-post Telegram message, HTML parse mode. */
  message: string;
}

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

  const lines: string[] = [
    `📊 <b>ArgoFX — Verified Performance</b>`,
    `<i>${period}</i>`,
    ``,
    `<b>EVERY SIGNAL — no exclusions</b>`,
    `Resolved: ${sig.total}`,
    `Wins ${sig.wins} · Losses ${sig.losses}${sig.expired ? ` · Expired ${sig.expired}` : ''}`,
    `Win rate: ${sig.winRatePct === null ? '—' : sig.winRatePct.toFixed(1) + '%'}`,
    `Net: ${fmt(sig.netPips, 1)} pips <i>(modelled)</i>`,
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
    `<i>Every signal generated is included — winners and losers. Outcomes are`
    + ` validated against 5-minute price data, and executed trades are reconciled`
    + ` against the broker's records.</i>`,
    ``,
    `⚠️ <b>Demo account.</b> Past performance does not indicate future results.`,
    `📡 General advice only. Not tailored to your circumstances. Forex trading`
    + ` carries significant risk of loss.`,
  );

  return lines.filter(l => l !== '').join('\n');
}

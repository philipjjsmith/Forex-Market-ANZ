/**
 * Every figure the public pages are allowed to state, in one place.
 *
 * WHY THIS FILE EXISTS. The BotFather welcome message published "documented results
 * averaging $8K–$12K per month" — a PROJECTION from EA_README.md:179 presented as
 * history, and refuted by this project's own pre-registered result. That happened
 * because numbers lived in prose where nobody could check them against a source.
 *
 * Rules for anything added here:
 *   1. Every figure carries `source` — where it is reproducible from.
 *   2. Nothing is rounded in a flattering direction.
 *   3. No projection, target or expectation is ever stated as a result.
 *   4. If it cannot be sourced, it does not go on a public page.
 *
 * COMPLIANCE. These are hypothetical and simulated performance results, so CFTC Reg
 * 4.41(b) attaches wherever they are presented and the prescribed cautionary statement
 * must appear on the same page. `PublicLayout`'s footer carries it on every public
 * route; pages that lead with results carry it inline as well.
 */

export const BACKTEST = {
  /** Pre-registered programme, all three §4 windows run. */
  expectancyR: -0.0552,
  trades: 1095,
  ci95: [-0.149, 0.04] as const,
  /** Deflated Sharpe. Zero to four places. */
  dsr: 0.0,
  /** Correlation between the confluence score and realised R. The score does not rank trades. */
  confidenceCorrelation: -0.0048,
  source: "Pre-registered backtest, 2022-08 to 2026-08, replayed from price data",
} as const;

export const COSTS = {
  /** Measured from real broker deals, not modelled. */
  commissionPipsRoundTurn: 0.73,
  breakEvenSpreadPips: 0.27,
  source: "cTrader deal history, measured 2026-09-03",
} as const;

/**
 * The independently verified demo account. Myfxbook is a third party; the numbers on
 * that page are not ours to edit, which is the entire point of citing it.
 * Snapshot values are stamped so nobody mistakes them for live.
 */
export const MYFXBOOK = {
  url: "https://www.myfxbook.com/portfolio/argosfx-demo/12180151",
  name: "ArgosFX DEMO",
  broker: "Spotware, cTrader, demo USD, 1:100",
  snapshot: {
    takenOn: "2026-09-15",
    gainPct: -6.18,
    balanceUsd: 9382.46,
    profitUsd: -617.54,
    drawdownPct: 6.19,
    depositsUsd: 10000,
  },
} as const;

export const TRADING = {
  pairs: ["EUR/USD", "GBP/USD", "USD/CHF", "USD/JPY", "AUD/USD"] as const,
  /** UTC. Generation runs only inside these windows. */
  killZones: ["07:00–10:00 London", "12:00–15:00 New York"] as const,
  expiryHours: 48,
  source: "server/services/exchangerate-api.ts and signal-generator.ts",
} as const;

/**
 * The public Telegram invite. NOT SET until Philip supplies the real link — a landing
 * page that ships a dead or guessed CTA is worse than one that ships none, so the
 * button renders only when this is a string.
 */
export const TELEGRAM_INVITE: string | null = null;

/**
 * Correlation guard.
 *
 * WHY THIS EXISTS
 *
 * ArgoFX had no correlation control of any kind. The 240-minute cooldown in signal-generator.ts
 * is PER SYMBOL and exists to stop sequential re-entry duplicates; it says nothing about holding
 * several correlated positions at once. Meanwhile every pair in the traded set has USD on one
 * side, so every signal is a USD bet wearing a different hat.
 *
 * The pre-registration flagged the consequence in §7: "simultaneous signals are one bet booked
 * several times." That is a measurement problem for the statistics AND a risk problem for the
 * account, and neither was ever addressed.
 *
 * THE SIGN IS THE WHOLE POINT
 *
 * EUR/USD and USD/CHF correlate NEGATIVELY. So LONG EUR/USD together with SHORT USD/CHF is not a
 * hedge -- it is the same "USD weakens" bet placed twice, at double the risk. A naive control
 * that just counted open positions, or that assumed same-direction means same-risk, would get
 * this exactly backwards and would happily wave through the most concentrated book available.
 *
 * NUMBERS ARE MEASURED, NOT ASSUMED
 *
 * Pearson correlation of hourly log returns, Dukascopy mid, 2022-08 -> 2026-08, on the ~24,573
 * timestamps each pairing actually shares (weekend and gap boundaries excluded).
 * Reproduce with: npx tsx scripts/measure-pair-correlation.ts
 *
 *              EURUSD  USDCHF  GBPUSD  USDJPY  AUDUSD
 *   EURUSD       1.00   -0.75    0.78   -0.50    0.66
 *   USDCHF      -0.75    1.00   -0.61    0.59   -0.54
 *   GBPUSD       0.78   -0.61    1.00   -0.45    0.68
 *   USDJPY      -0.50    0.59   -0.45    1.00   -0.40
 *   AUDUSD       0.66   -0.54    0.68   -0.40    1.00
 *
 * Note EUR/USD vs GBP/USD at +0.78 is the STRONGEST pairing in the book -- stronger than the
 * EUR/USD vs USD/CHF relationship that has been discussed all along, and it had never been
 * mentioned. Note also that the pre-registration's "about -0.9" for EUR/USD vs USD/CHF is
 * overstated: measured, it is -0.746.
 */

export const PAIR_CORRELATION: Record<string, Record<string, number>> = {
  EURUSD: { EURUSD: 1.000, USDCHF: -0.746, GBPUSD: 0.779, USDJPY: -0.500, AUDUSD: 0.665 },
  USDCHF: { EURUSD: -0.746, USDCHF: 1.000, GBPUSD: -0.614, USDJPY: 0.590, AUDUSD: -0.540 },
  GBPUSD: { EURUSD: 0.779, USDCHF: -0.614, GBPUSD: 1.000, USDJPY: -0.450, AUDUSD: 0.684 },
  USDJPY: { EURUSD: -0.500, USDCHF: 0.590, GBPUSD: -0.450, USDJPY: 1.000, AUDUSD: -0.400 },
  AUDUSD: { EURUSD: 0.665, USDCHF: -0.540, GBPUSD: 0.684, USDJPY: -0.400, AUDUSD: 1.000 },
};

/**
 * Maximum effective exposure, counting the candidate itself as 1.0.
 *
 * Chosen on first principles, NOT tuned on data -- pre-registration §8 forbids letting a measured
 * cell drive a parameter, and tuning this on the same 2022-2026 window would add yet another
 * trial to a Deflated-Sharpe count already at N >= 15.
 *
 * The principle: with maxTradesPerDay = 3 at 1% risk each, the worst case is only "3% across
 * three independent trades" if the trades are actually independent. When they are copies of one
 * bet they lose together, and the daily loss limit meets a single 3% hit. A cap of 2.0 permits a
 * second, moderately correlated position and refuses to let the book become three copies of one
 * view. It can never block the first trade, whose exposure is 1.0 by definition.
 */
export const MAX_EFFECTIVE_EXPOSURE = 2.0;

/** 'EUR/USD', 'eurusd', 'EUR_USD' -> 'EURUSD'. */
export function normalisePair(symbol: string): string {
  return symbol.replace(/[^A-Za-z]/g, '').toUpperCase();
}

export function correlationBetween(a: string, b: string): number {
  const x = normalisePair(a), y = normalisePair(b);
  if (x === y) return 1;
  return PAIR_CORRELATION[x]?.[y] ?? 0; // unknown pair -> treated as independent, and said so below
}

export interface OpenPosition {
  symbol: string;
  type: string; // 'LONG' | 'SHORT'
}

export interface CorrelationVerdict {
  allowed: boolean;
  exposure: number;
  cap: number;
  /** Per-open-position detail, largest compounding contribution first. */
  contributions: Array<{ symbol: string; type: string; r: number; contribution: number }>;
  reason: string | null;
  /** True when some open position sits on a pair absent from the measured matrix. */
  hasUnknownPairs: boolean;
}

const dir = (type: string) => (String(type).toUpperCase() === 'SHORT' ? -1 : 1);

/**
 * Effective exposure of taking `candidate` while `open` positions are live.
 *
 * exposure = 1 (the candidate) + SUM over open of  d_candidate * d_open * r(candidate, open)
 *
 * A positive contribution means the two trades COMPOUND -- they win and lose together. A negative
 * contribution means they genuinely offset, and the total correctly falls below 1.0.
 */
export function evaluateCorrelation(
  candidate: OpenPosition,
  open: OpenPosition[],
  cap: number = MAX_EFFECTIVE_EXPOSURE
): CorrelationVerdict {
  const dc = dir(candidate.type);
  let hasUnknownPairs = false;

  const contributions = open.map(o => {
    const known = PAIR_CORRELATION[normalisePair(o.symbol)] !== undefined
      && PAIR_CORRELATION[normalisePair(candidate.symbol)] !== undefined;
    if (!known) hasUnknownPairs = true;
    const r = correlationBetween(candidate.symbol, o.symbol);
    return { symbol: o.symbol, type: o.type, r, contribution: dc * dir(o.type) * r };
  }).sort((a, b) => b.contribution - a.contribution);

  const exposure = 1 + contributions.reduce((s, c) => s + c.contribution, 0);
  const allowed = exposure <= cap;

  const worst = contributions[0];
  const reason = allowed ? null
    : `Effective correlated exposure ${exposure.toFixed(2)} exceeds the ${cap.toFixed(2)} cap. `
    + `Largest compounding position: ${worst.symbol} ${worst.type} `
    + `(r = ${worst.r >= 0 ? '+' : ''}${worst.r.toFixed(2)}, contributes ${worst.contribution >= 0 ? '+' : ''}${worst.contribution.toFixed(2)}). `
    + (worst.r < 0
        ? 'Note the NEGATIVE correlation: opposite directions on these two pairs is the same bet twice, not a hedge.'
        : 'Same direction on positively correlated pairs compounds the same bet.');

  return { allowed, exposure, cap, contributions, reason, hasUnknownPairs };
}

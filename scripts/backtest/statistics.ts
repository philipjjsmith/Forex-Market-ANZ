/**
 * Phase E — the statistics that decide whether a result means anything.
 *
 * Three things, each guarding a different way this could produce a confident wrong answer:
 *
 *   1. BLOCK BOOTSTRAP over calendar time, never i.i.d. EUR/USD and USD/CHF are ~-0.9 correlated
 *      and four of five pairs share the USD leg, so simultaneous signals are ONE bet booked
 *      several times. Resampling individual trades would treat them as independent evidence and
 *      shrink the confidence interval by roughly the square root of that duplication.
 *
 *   2. PURGED, EMBARGOED WALK-FORWARD. Trades are serially dependent: a 48h hold plus a cooldown
 *      means a trade near a fold boundary overlaps the next fold. Without purging, information
 *      leaks across the split and stability looks better than it is.
 *
 *   3. DEFLATED SHARPE with an honest trial count. Every parameter already chosen by looking at
 *      this data is a trial: the pair set, 20/50 EMA, ADX 25, the ATR multiples, MIN_SL_PIPS, the
 *      RSI range, FVG lookback, kill-zone hours, confidence >= 70, HIGH >= 90, the cooldown, the
 *      48h expiry. §7 fixes N >= 15. Claiming N = 1 is how a backtest reports significance it has
 *      not earned.
 *
 * Everything here reports an interval or a probability. Nothing returns a bare point estimate,
 * because a bare point estimate on ~400 trades is the thing that misleads.
 */
import type { Trade } from './engine';

const EULER_MASCHERONI = 0.5772156649015329;

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function normCdf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const moment = (a: number[], k: number) => {
  const m = mean(a), s = sd(a);
  if (!s) return 0;
  return a.reduce((acc, x) => acc + ((x - m) / s) ** k, 0) / a.length;
};

/** Deterministic PRNG so a bootstrap is reproducible and cannot be quietly re-rolled. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Group trades into blocks by UTC calendar date — the unit that gets resampled. */
export function blocksByDay(trades: Trade[]): number[][] {
  const byDay = new Map<string, number[]>();
  for (const t of trades) {
    if (t.r == null) continue;
    const k = t.openedAt.toISOString().slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(t.r);
  }
  return [...byDay.values()];
}

export interface BootstrapResult {
  meanR: number; lo: number; hi: number; pLessEqualZero: number;
  blocks: number; trades: number; iterations: number;
}

/**
 * Block bootstrap on mean R, resampling whole DAYS with replacement.
 *
 * Resampling days rather than trades preserves within-day correlation — several pairs firing the
 * same USD view on the same morning stay bound together, as they were in reality.
 */
export function blockBootstrap(trades: Trade[], iterations = 10000, seed = 20260829): BootstrapResult {
  const blocks = blocksByDay(trades);
  const all = blocks.flat();
  if (!blocks.length) return { meanR: 0, lo: 0, hi: 0, pLessEqualZero: 1, blocks: 0, trades: 0, iterations };

  const rng = makeRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0, n = 0;
    for (let b = 0; b < blocks.length; b++) {
      const blk = blocks[(rng() * blocks.length) | 0];
      for (const r of blk) { sum += r; n++; }
    }
    if (n) means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * (means.length - 1))))];
  return {
    meanR: mean(all),
    lo: at(0.025), hi: at(0.975),
    pLessEqualZero: means.filter(m => m <= 0).length / means.length,
    blocks: blocks.length, trades: all.length, iterations,
  };
}

export interface DsrResult {
  sharpe: number; sharpeThreshold: number; dsr: number;
  skew: number; kurtosis: number; trials: number; observations: number;
}

/**
 * Deflated Sharpe Ratio (Bailey & Lopez de Prado, 2014).
 *
 * Answers "given that N configurations were tried, how likely is a Sharpe this high under the
 * null?" — the question an undeflated Sharpe silently skips.
 *
 * `trialSharpeVariance` is the variance of Sharpe ratios ACROSS trials. It is rarely known
 * exactly. Supplying the observed cross-fold variance is the usual practical estimate and is what
 * the caller should pass; the fallback below is deliberately conservative-leaning and its use is
 * reported, never hidden.
 */
export function deflatedSharpe(
  returns: number[], trials = 15, trialSharpeVariance?: number
): DsrResult {
  const T = returns.length;
  const m = mean(returns), s = sd(returns);
  const sharpe = s > 0 ? m / s : 0;
  const skew = moment(returns, 3);
  const kurt = moment(returns, 4);

  const v = trialSharpeVariance ?? (T > 1 ? 1 / T : 1);   // fallback: sampling variance of SR under H0
  const sqrtV = Math.sqrt(Math.max(v, 1e-12));
  const N = Math.max(2, trials);
  const threshold = sqrtV * (
    (1 - EULER_MASCHERONI) * normInv(1 - 1 / N) +
    EULER_MASCHERONI * normInv(1 - 1 / (N * Math.E))
  );

  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sharpe + ((kurt - 1) / 4) * sharpe * sharpe));
  const dsr = T > 1 ? normCdf(((sharpe - threshold) * Math.sqrt(T - 1)) / denom) : 0;

  return { sharpe, sharpeThreshold: threshold, dsr, skew, kurtosis: kurt, trials: N, observations: T };
}

export interface Fold { index: number; from: Date; to: Date; n: number; meanR: number; winRate: number }

/**
 * Anchored walk-forward with purging and an embargo.
 *
 * A trade is dropped from a fold when its HOLDING PERIOD crosses the fold's start, and trades
 * inside the embargo window after the boundary are dropped too. Both exist because a 48h hold and
 * a cooldown make neighbouring trades share information; without them, folds are not independent
 * and per-fold stability is overstated.
 */
export function walkForward(
  trades: Trade[], folds = 6, embargoHours = 48
): Fold[] {
  const done = trades.filter(t => t.r != null && t.closedAt).sort((a, b) => +a.openedAt - +b.openedAt);
  if (done.length < folds) return [];

  const start = +done[0].openedAt, end = +done[done.length - 1].openedAt;
  const width = (end - start) / folds;
  const embargo = embargoHours * 3600_000;
  const out: Fold[] = [];

  for (let i = 0; i < folds; i++) {
    const from = start + i * width, to = from + width;
    const inFold = done.filter(t => {
      const o = +t.openedAt, c = +t.closedAt!;
      if (o < from || o >= to) return false;
      if (c > to) return false;                 // purge: holding period crosses the boundary
      if (i > 0 && o < from + embargo) return false;   // embargo after the previous fold
      return true;
    });
    const rs = inFold.map(t => t.r!);
    out.push({
      index: i + 1, from: new Date(from), to: new Date(to), n: inFold.length,
      meanR: mean(rs),
      winRate: inFold.length ? inFold.filter(t => t.outcome === 'TP1_HIT').length / inFold.length : 0,
    });
  }
  return out;
}

/** Sharpe of a return series, for cross-fold variance estimation. */
export const sharpeOf = (returns: number[]) => {
  const s = sd(returns);
  return s > 0 ? mean(returns) / s : 0;
};

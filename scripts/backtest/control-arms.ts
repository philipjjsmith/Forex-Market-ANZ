/**
 * Phase D — control arms.
 *
 * Without a null model, "840 trades, −X pips" says nothing. It could be the ICT machinery, or it
 * could be a property of a 1.5×ATR stop against a 3.0×ATR target fired during two London/New York
 * windows. These two arms separate those.
 *
 *   RANDOM     identical kill zones, cooldown, daily cap, ATR-derived stop/target, 48h expiry and
 *              costs — but the direction is a coin flip. Isolates the stop/target geometry and
 *              the timing from any predictive content.
 *
 *   TREND-ONLY fires whenever Daily and 4H agree, ignoring FVG, order blocks, liquidity sweeps
 *              and the 130-point score entirely. Roughly 75 of ~135 points come from three trend
 *              booleans, so "this is a trend filter with decoration" is a live hypothesis and
 *              cheap to test.
 *
 * If the strategy does not beat BOTH, the ICT machinery is not contributing and the result is a
 * property of the stop/target structure and kill-zone timing.
 *
 * The random arm is seeded and the seed is recorded, so a run is reproducible and cannot be
 * quietly re-rolled until it flatters the comparison.
 */
import { Indicators } from '../../server/services/signal-generator';
import type { Ohlc } from './aggregate';
import { type Trade } from './engine';

/**
 * Deterministic PRNG (mulberry32).
 *
 * Math.random() would make the control arm unreproducible, and an unreproducible control is not a
 * control — it is a number that can be re-rolled until it loses.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ArmName = 'random' | 'trend-only';

export interface ArmSignal {
  type: 'LONG' | 'SHORT';
  /** Stop distance in price units, from the entry. */
  stopDist: number;
  /** Target distance in price units, from the entry. */
  targetDist: number;
  confidence: number;
  tier: string;
}

/** Production's own multiples, so geometry is held identical to the strategy under test. */
const ATR_STOP = 1.5;
const ATR_TARGET = 3.0;

/**
 * RANDOM arm. Direction is a coin flip; everything else matches the real system.
 *
 * Returns null when ATR is unavailable, exactly as analyze() would bail on insufficient data —
 * the arm must face the same data constraints, not an easier version of them.
 */
export function randomArm(oneHour: Ohlc[], rng: () => number): ArmSignal | null {
  const atr = Indicators.atr(oneHour as any, 14);
  if (!atr) return null;
  return {
    type: rng() < 0.5 ? 'LONG' : 'SHORT',
    stopDist: ATR_STOP * atr,
    targetDist: ATR_TARGET * atr,
    confidence: 0,
    tier: 'CONTROL',
  };
}

/**
 * TREND-ONLY arm. Fires whenever Daily and 4H agree, with no FVG, order block, sweep, RSI, ADX or
 * score involvement at all.
 *
 * Deliberately uses the SAME 20/50 EMA periods and the same array lengths as production, so the
 * only thing removed is the ICT machinery — not the trend definition, and not the seeding
 * behaviour of ema() that makes array length load-bearing.
 */
export function trendOnlyArm(
  daily: Ohlc[], fourHour: Ohlc[], oneHour: Ohlc[]
): ArmSignal | null {
  const atr = Indicators.atr(oneHour as any, 14);
  if (!atr) return null;

  const trend = (bars: Ohlc[]): 'UP' | 'DOWN' | null => {
    const closes = bars.map(b => b.close);
    const fast = Indicators.ema(closes, 20);
    const slow = Indicators.ema(closes, 50);
    if (fast == null || slow == null) return null;
    return fast > slow ? 'UP' : 'DOWN';
  };

  const d = trend(daily), h4 = trend(fourHour);
  if (!d || !h4 || d !== h4) return null;        // the entire entry condition

  return {
    type: d === 'UP' ? 'LONG' : 'SHORT',
    stopDist: ATR_STOP * atr,
    targetDist: ATR_TARGET * atr,
    confidence: 0,
    tier: 'CONTROL',
  };
}

/** Summary shared by every arm so comparisons are like-for-like. */
export function summarise(trades: Trade[]) {
  const done = trades.filter(t => t.outcome);
  const wins = done.filter(t => t.outcome === 'TP1_HIT').length;
  const rs = done.map(t => t.r ?? 0);
  const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
  const sd = rs.length > 1
    ? Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (rs.length - 1))
    : 0;
  return {
    n: done.length,
    wins,
    winRate: done.length ? wins / done.length : 0,
    netPips: done.reduce((s, t) => s + (t.netPips ?? 0), 0),
    expectancyR: mean,
    sdR: sd,
    /** Standard error of the mean R — the honest error bar on expectancy. */
    seR: rs.length ? sd / Math.sqrt(rs.length) : 0,
  };
}

/**
 * Backtest replay engine — Phases A (gates), B (fill/cost) and C (resolution).
 *
 * These three cannot be separated: the cooldown blocks a symbol while it holds a PENDING trade,
 * so knowing when to open depends on knowing when things close.
 *
 * WHAT THIS DELIBERATELY REPLICATES
 * ---------------------------------
 * `analyze()` is NOT the production decision — `generateSignals()` is, and it gates BEFORE
 * analyze() is ever reached. A backtest that walks every 1H bar samples ~4x production's
 * opportunity set, in hours it never trades, and the extra sample is BIASED rather than merely
 * larger: the timing subscore is up to 10 points lower off-hours against a hard confidence >= 70
 * cut, so the trade population becomes an artifact of a scoring quirk meeting a threshold.
 *
 * All four production gates, in production's order:
 *   1. market open          — Sun 17:00 NY to Fri 17:00 NY
 *   2. kill zone            — ONLY 07:00-09:59 and 12:00-14:59 UTC. 6 hours of 24.
 *   3. daily cap            — 3 trades/day PORTFOLIO-WIDE, evaluated once before the symbol loop
 *   4. confidence >= 70     — below this the signal is discarded and never written
 *
 * Plus the per-symbol cooldown, whose real clause is `outcome = 'PENDING' OR created_at >
 * NOW() - 240 min`: a symbol is blocked until its trade RESOLVES, not for a fixed 4 hours.
 *
 * GATE 3 IS ORDER-DEPENDENT AND THAT IS A REAL SELECTION EFFECT: whichever pair is iterated
 * first takes the last daily slot. The order is fixed to production's own array and must not be
 * sorted or changed to improve a result.
 *
 * FILL MODEL (§6, fixed before any result existed)
 * -----------------------------------------------
 * Market fill at the NEXT bar's open, plus half the spread each side. Signals are labelled "Buy
 * Limit" but both executors send MARKET orders, and the quoted entry is measurably 5-8 pips
 * stale. A limit at the current price fills only if price ticks against the signal, so booking
 * the immediate favourable move as a fill is precisely how limit-entry backtests invent edges.
 *
 * Stop and target are applied as DISTANCES from the actual fill, not as the absolute prices the
 * signal quoted. Using the quoted levels against a different fill would silently change R.
 *
 * Spread comes from the §6 CONFIGURED defaults, not from Dukascopy's observed spread. Amendment
 * 2 §A2.3: Dukascopy is a near-interbank ECN feed, The5ers is where these trades would actually
 * execute, and adopting the observed 0.30 pips on EUR/USD would flatter the result by ~0.05R
 * against a measured -0.079R expectancy — enough to manufacture the entire finding.
 *
 * RESOLUTION (§6)
 * ---------------
 * Replayed on 5-minute bars. When a single bar touches BOTH stop and target the outcome is
 * ambiguous at this granularity, and it is resolved STOP-FIRST — the conservative choice. Gaps
 * fill at the bar's open when it opens beyond the level, never at the level itself.
 */
import type { Ohlc } from './aggregate';

export type Outcome = 'TP1_HIT' | 'STOP_HIT' | 'EXPIRED';

export interface Trade {
  symbol: string;
  type: 'LONG' | 'SHORT';
  openedAt: Date;
  entry: number;          // actual fill, spread included
  stop: number;
  target: number;
  confidence: number;
  tier: string;
  closedAt?: Date;
  outcome?: Outcome;
  exitPrice?: number;
  grossPips?: number;
  netPips?: number;       // after spread and swap
  r?: number;             // netPips / initial risk in pips
  mfeR?: number;
  maeR?: number;
}

export interface EngineConfig {
  /** §6 spread per pair in pips. NOT Dukascopy's observed spread — see Amendment 2 §A2.3. */
  spreadPips: Record<string, number>;
  /** Swap cost in pips per night held. Crossing 17:00 NY charges this; Wednesday charges 3x. */
  swapPipsPerNight: Record<string, number>;
  maxTradesPerDay: number;
  cooldownMinutes: number;
  expiryHours: number;
  /**
   * Production blocks a symbol while its trade is PENDING, and only unblocks when the THROTTLED
   * validator marks it resolved — later than the true touch. The true latency was never logged,
   * so the honest treatment is to bracket it and report the spread (harness design note):
   *   'instant'          — free after the 4h cooldown alone. Optimistic bound.
   *   'until-resolved'   — free at the true touch time. Middle, and closest to intent.
   *   'until-expiry'     — free only at the 48h expiry. Pessimistic bound.
   * A materially different result across these means the record is latency-driven, not edge-driven.
   */
  cooldownMode: 'instant' | 'until-resolved' | 'until-expiry';
}

export const DEFAULT_CONFIG: EngineConfig = {
  // §6 defaults. Deliberately conservative and deliberately NOT the measured Dukascopy spread.
  spreadPips: { 'EUR/USD': 1.0, 'USD/CHF': 1.5, 'GBP/USD': 1.5, 'USD/JPY': 1.2, 'AUD/USD': 1.3 },
  // A 48h hold crosses at least one rollover. Held as an explicit assumption until The5ers'
  // real swap rates are available; sensitivity to it must be reported, never buried.
  swapPipsPerNight: { 'EUR/USD': 0.3, 'USD/CHF': 0.3, 'GBP/USD': 0.4, 'USD/JPY': 0.3, 'AUD/USD': 0.4 },
  maxTradesPerDay: 3,
  cooldownMinutes: 240,
  expiryHours: 48,
  cooldownMode: 'until-resolved',
};

export const pipSize = (symbol: string) => (symbol.includes('JPY') ? 0.01 : 0.0001);

const NY_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', weekday: 'short', hour12: false,
});
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nyHourDow(d: Date) {
  const p = NY_HOUR.formatToParts(d);
  return {
    hour: Number(p.find(x => x.type === 'hour')!.value) % 24,
    dow: DOW[p.find(x => x.type === 'weekday')!.value],
  };
}

/** Gate 1 — the forex week runs Sunday 17:00 NY to Friday 17:00 NY. */
export function isMarketOpen(d: Date): boolean {
  const { hour, dow } = nyHourDow(d);
  if (dow === 6) return false;
  if (dow === 0 && hour < 17) return false;
  if (dow === 5 && hour >= 17) return false;
  return true;
}

/** Gate 2 — production trades ONLY these six hours, in UTC. */
export function isInKillZone(d: Date): boolean {
  const h = d.getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

/** Number of 17:00-NY rollovers crossed, counting Wednesday's triple swap. */
export function swapNights(open: Date, close: Date): number {
  let nights = 0;
  const cursor = new Date(open);
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor < close) {
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    if (cursor > close) break;
    const { hour, dow } = nyHourDow(cursor);
    if (hour === 17) nights += dow === 3 ? 3 : 1;   // Wednesday rollover is charged triple
  }
  return nights;
}

/**
 * Resolve one trade against 5-minute bars.
 *
 * `bars` must be ascending and start at or after the fill. Returns null while the trade is still
 * open at the end of the supplied data — the caller decides whether that means "not yet" or
 * "unresolvable", which must never be silently treated as a loss.
 */
export function resolveTrade(
  t: Trade, bars: Ohlc[], expiry: Date
): { outcome: Outcome; at: Date; price: number; mfeR: number; maeR: number } | null {
  const isLong = t.type === 'LONG';
  const risk = Math.abs(t.entry - t.stop);
  if (risk <= 0) return null;

  let mfe = 0, mae = 0;

  for (const b of bars) {
    if (b.timestamp < t.openedAt) continue;

    const favourable = isLong ? b.high - t.entry : t.entry - b.low;
    const adverse = isLong ? t.entry - b.low : b.high - t.entry;
    mfe = Math.max(mfe, favourable / risk);
    mae = Math.max(mae, adverse / risk);

    if (b.timestamp >= expiry) {
      return { outcome: 'EXPIRED', at: b.timestamp, price: b.close, mfeR: mfe, maeR: mae };
    }

    const hitStop = isLong ? b.low <= t.stop : b.high >= t.stop;
    const hitTarget = isLong ? b.high >= t.target : b.low <= t.target;

    // Both touched inside one 5-minute bar: the true order is unknowable at this granularity,
    // so take the stop. Choosing the target here is the single easiest way to invent an edge.
    if (hitStop) {
      const gapped = isLong ? b.open <= t.stop : b.open >= t.stop;
      return {
        outcome: 'STOP_HIT', at: b.timestamp,
        price: gapped ? b.open : t.stop,        // a gap fills at the open, never at the level
        mfeR: mfe, maeR: mae,
      };
    }
    if (hitTarget) {
      const gapped = isLong ? b.open >= t.target : b.open <= t.target;
      return {
        outcome: 'TP1_HIT', at: b.timestamp,
        price: gapped ? b.open : t.target,
        mfeR: mfe, maeR: mae,
      };
    }
  }
  return null;   // still open at the end of the data
}

/**
 * Resolve one trade under the DEPLOYED payoff instead of the engine's all-or-nothing one.
 *
 * WHY THIS EXISTS
 *
 * `BACKTEST_RESULT_2026-08-30.md` disclosed that the backtest "models neither the historical nor
 * the deployed system": `ForexMarketANZ_EA.mq5` splits every signal into TWO orders sharing one
 * stop — 50% at TP1 and 50% at TP3 — while `resolveTrade` above books 100% at TP1. It also noted
 * the TP3 leg "cannot be reconstructed from this trade set at all", because `resolveTrade`
 * RETURNS the moment TP1 is touched, so `mfeR` is truncated at the resolving bar and everything
 * after it is invisible.
 *
 * This function keeps walking. It never returns early, so `mfeR` here is the true excursion to
 * expiry and both legs are resolved independently against the SAME stop.
 *
 * THE DEPLOYED PARAMETERS, read from the EA rather than assumed:
 *   USE_PARTIAL_PROFITS      = true
 *   PARTIAL_CLOSE_PERCENT_1  = 50.0   // at TP1, commented "3.0x ATR"
 *   PARTIAL_CLOSE_PERCENT_2  = 50.0   // at TP3, commented "12.0x ATR"
 *   grep for breakeven/trail in the EA returns ZERO matches — neither leg is ever moved.
 *
 * TP3 is derived as `4x the TP1 DISTANCE`, not as a fixed multiple of R. TP1 is 3.0xATR and TP3
 * is 12.0xATR, so their ratio is exactly 4 regardless of the stop. Deriving TP3 from R instead
 * would be wrong: the MIN_SL_PIPS floor widens the stop on some signals without widening the
 * target, so TP1/risk actually ranges 1.56-2.02 across the trade set rather than being a clean 2.
 *
 * The within-bar tie rule is inherited deliberately: if a bar touches both the stop and a target,
 * the stop wins. At 5-minute granularity the true order is unknowable, and choosing the target is
 * the easiest way to invent an edge.
 */
export interface SplitLeg {
  leg: 'TP1' | 'TP3';
  fraction: number;
  outcome: Outcome;
  at: Date;
  price: number;
}

export interface SplitResolution {
  legs: SplitLeg[];
  /** True maximum favourable excursion to EXPIRY, never truncated at a resolving bar. */
  mfeR: number;
  maeR: number;
}

export function resolveTradeSplit(
  t: Trade, bars: Ohlc[], expiry: Date, tp3DistanceMultiple = 4
): SplitResolution | null {
  const isLong = t.type === 'LONG';
  const risk = Math.abs(t.entry - t.stop);
  if (risk <= 0) return null;

  const tp1 = t.target;
  const tp3 = t.entry + tp3DistanceMultiple * (tp1 - t.entry);   // signed: works both directions

  let mfe = 0, mae = 0;
  let legA: SplitLeg | null = null;   // 50% at TP1
  let legB: SplitLeg | null = null;   // 50% at TP3

  for (const b of bars) {
    if (b.timestamp < t.openedAt) continue;

    const favourable = isLong ? b.high - t.entry : t.entry - b.low;
    const adverse = isLong ? t.entry - b.low : b.high - t.entry;
    mfe = Math.max(mfe, favourable / risk);
    mae = Math.max(mae, adverse / risk);

    if (b.timestamp >= expiry) {
      const close = { outcome: 'EXPIRED' as Outcome, at: b.timestamp, price: b.close };
      if (!legA) legA = { leg: 'TP1', fraction: 0.5, ...close };
      if (!legB) legB = { leg: 'TP3', fraction: 0.5, ...close };
      break;
    }

    const hitStop = isLong ? b.low <= t.stop : b.high >= t.stop;

    // The stop is shared, so it closes whichever legs are still open — including a TP3 leg that
    // had already run past TP1. There is no breakeven move in the EA, so that giveback is real.
    if (hitStop) {
      const gapped = isLong ? b.open <= t.stop : b.open >= t.stop;
      const px = gapped ? b.open : t.stop;
      const close = { outcome: 'STOP_HIT' as Outcome, at: b.timestamp, price: px };
      if (!legA) legA = { leg: 'TP1', fraction: 0.5, ...close };
      if (!legB) legB = { leg: 'TP3', fraction: 0.5, ...close };
      break;
    }

    if (!legA) {
      const hitTp1 = isLong ? b.high >= tp1 : b.low <= tp1;
      if (hitTp1) {
        const gapped = isLong ? b.open >= tp1 : b.open <= tp1;
        legA = { leg: 'TP1', fraction: 0.5, outcome: 'TP1_HIT', at: b.timestamp, price: gapped ? b.open : tp1 };
      }
    }
    if (!legB) {
      const hitTp3 = isLong ? b.high >= tp3 : b.low <= tp3;
      if (hitTp3) {
        const gapped = isLong ? b.open >= tp3 : b.open <= tp3;
        legB = { leg: 'TP3', fraction: 0.5, outcome: 'TP1_HIT', at: b.timestamp, price: gapped ? b.open : tp3 };
      }
    }
    if (legA && legB) break;
  }

  if (!legA || !legB) return null;   // still open at the end of the data — caller decides
  return { legs: [legA, legB], mfeR: mfe, maeR: mae };
}

/**
 * R for a split trade: the size-weighted sum of the legs, each costed on its own exit and its own
 * holding period. Entry cost is unchanged because total volume is unchanged — two half-size fills
 * instead of one full-size one — so only the exit half-spread is split, and the swap is charged
 * per leg by that leg's own duration. The TP3 leg is held longer and pays more swap; that is real.
 */
export function costSplit(t: Trade, res: SplitResolution, cfg: EngineConfig): {
  r: number; netPips: number; legR: number[];
} {
  const pip = pipSize(t.symbol);
  const isLong = t.type === 'LONG';
  const riskPips = Math.abs(t.entry - t.stop) / pip;
  const halfSpread = (cfg.spreadPips[t.symbol] ?? 1.5) / 2;
  const swapRate = cfg.swapPipsPerNight[t.symbol] ?? 0.3;

  let netPips = 0;
  const legR: number[] = [];
  for (const leg of res.legs) {
    const gross = (isLong ? leg.price - t.entry : t.entry - leg.price) / pip;
    const swap = swapNights(t.openedAt, leg.at) * swapRate;
    const net = gross - halfSpread - swap;
    netPips += leg.fraction * net;
    legR.push(riskPips > 0 ? net / riskPips : 0);
  }
  return { r: riskPips > 0 ? netPips / riskPips : 0, netPips, legR };
}

/** Apply spread and swap, and express the result in R. */
export function costTrade(t: Trade, cfg: EngineConfig): void {
  const pip = pipSize(t.symbol);
  const isLong = t.type === 'LONG';
  const gross = isLong ? (t.exitPrice! - t.entry) : (t.entry - t.exitPrice!);
  t.grossPips = gross / pip;

  // Half the spread is already inside the entry fill; the other half is paid on exit.
  const halfSpread = (cfg.spreadPips[t.symbol] ?? 1.5) / 2;
  const swap = swapNights(t.openedAt, t.closedAt!) * (cfg.swapPipsPerNight[t.symbol] ?? 0.3);

  t.netPips = t.grossPips - halfSpread - swap;
  const riskPips = Math.abs(t.entry - t.stop) / pip;
  t.r = riskPips > 0 ? t.netPips / riskPips : 0;
}

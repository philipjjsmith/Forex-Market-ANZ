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

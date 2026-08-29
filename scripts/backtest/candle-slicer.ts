/**
 * As-of candle slicing with partial higher-timeframe bar reconstruction.
 *
 * THE PROBLEM THIS SOLVES — verified empirically 2026-08-28
 * --------------------------------------------------------
 * Twelve Data timestamps every bar by its OPEN, and returns the CURRENT, STILL-FORMING bar.
 * Observed at 2026-08-28T19:30Z:
 *     1day  newest bar opens 2026-08-28  -> closes 08-29  (PARTIAL)
 *     1week newest bar opens 2026-08-24  -> closes 08-31  (PARTIAL)
 *     4h    newest bar opens     17:00   -> closes 21:00  (PARTIAL)
 *
 * So production, analysing at 09:00, saw a daily bar containing ONLY 00:00-09:00.
 *
 * A backtest that filters historical data with `timestamp <= asOf` receives the COMPLETED
 * daily bar — all 24 hours of it, including the 15 hours that had not happened yet. That is
 * direct look-ahead into `dailyTrend`, which is a HARD GATE in analyze() (a signal is
 * rejected outright unless Daily and 4H agree). The weekly leak is up to six days.
 *
 * Neither naive rule is correct:
 *   `open <= asOf`              -> leaks the remainder of the bar (look-ahead)
 *   `open + duration <= asOf`   -> drops the forming bar production actually had
 *
 * CORRECT RULE (implemented here)
 * -------------------------------
 *   1. Keep every bar that had fully CLOSED by asOf.
 *   2. Rebuild the one still-forming bar by aggregating 1H bars from its open up to asOf.
 *
 * Bar boundaries are derived from Twelve Data's OWN consecutive timestamps rather than an
 * assumed calendar convention, so this cannot drift if their week/day boundary differs from
 * ours (their weekly bars open Monday, not Sunday 22:00 as the forex "week" often implies).
 *
 * ACCEPTANCE TEST: reconstruction must reproduce the stored `htfTrend` string
 * ("W:x D:y 4H:z 1H:w") EXACTLY on live v3.3.0 signals. If it does not, the slicing is wrong
 * and no downstream number means anything.
 */

export interface Bar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Nominal fallback durations, used only for the final bar where no successor exists. */
const NOMINAL_MS: Record<string, number> = {
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1day': 86_400_000,
  '1week': 604_800_000,
};

/**
 * Aggregate 1H bars covering [periodStart, asOf) into a single partial bar.
 * Returns null when no 1H data falls inside the period — e.g. a weekend or market holiday,
 * where production would legitimately have had no forming bar either.
 */
export function buildPartialBar(oneHour: Bar[], periodStart: Date, asOf: Date): Bar | null {
  const from = periodStart.getTime();
  const to = asOf.getTime();

  const inside = oneHour.filter(b => {
    const t = b.timestamp.getTime();
    return t >= from && t < to;
  });
  if (inside.length === 0) return null;

  return {
    timestamp: periodStart,
    open: inside[0].open,
    high: Math.max(...inside.map(b => b.high)),
    low: Math.min(...inside.map(b => b.low)),
    close: inside[inside.length - 1].close,
    volume: inside.reduce((s, b) => s + (b.volume ?? 0), 0),
  };
}

/**
 * Return the higher-timeframe series exactly as it would have appeared at `asOf`:
 * all fully-closed bars, plus a reconstructed partial bar for the period in progress.
 *
 * @param bars      the full HTF series, ascending, timestamped by bar OPEN
 * @param oneHour   1H bars used to rebuild the forming bar (ascending)
 * @param asOf      the moment being replayed
 * @param interval  '4h' | '1day' | '1week' — used only for the last-bar fallback duration
 */
/**
 * Infer how far a bar's OPEN precedes its LABEL, in ms.
 *
 * Twelve Data labels a forex DAILY bar by the date it ENDS, not the moment it opens: at
 * 2026-08-29T22:01Z the series already carries a bar labelled 2026-08-30T00:00, and that bar is
 * the still-forming one (forex days roll at the ~21:00 UTC New York close).
 *
 * Treating the label as the open is doubly wrong. The real forming bar looks like it "has not
 * started" and is dropped, and the genuinely CLOSED bar before it is then mistaken for the
 * forming one and rebuilt as a partial — corrupting a completed bar. Measured on live
 * provenance: daily closed-bar hashes matched 0/4 before this, 4/4 after.
 *
 * The skew is not assumed. It is recovered by aggregating the 1H series over each candidate
 * window and keeping the offset that best reproduces the HTF bars we KNOW are closed.
 */
export function inferOpenSkewMs(htf: Bar[], oneHour: Bar[], periodMs: number): number {
  if (htf.length < 4 || oneHour.length === 0) return 0;

  // Use closed bars only — never the final, possibly-forming one.
  const sample = htf.slice(-6, -1);
  let bestSkew = 0, bestErr = Infinity;

  for (let skew = 0; skew < periodMs; skew += 3_600_000) {
    let err = 0, scored = 0;
    for (const bar of sample) {
      const start = bar.timestamp.getTime() - skew;
      const inside = oneHour.filter(b => {
        const t = b.timestamp.getTime();
        return t >= start && t < start + periodMs;
      });
      if (inside.length === 0) continue;
      const hi = Math.max(...inside.map(b => b.high));
      const lo = Math.min(...inside.map(b => b.low));
      err += Math.abs(hi - bar.high) + Math.abs(lo - bar.low)
           + Math.abs(inside[0].open - bar.open) + Math.abs(inside[inside.length - 1].close - bar.close);
      scored++;
    }
    if (scored >= 2 && err / scored < bestErr) { bestErr = err / scored; bestSkew = skew; }
  }
  return bestSkew;
}

export function sliceAsOf(bars: Bar[], oneHour: Bar[], asOf: Date, interval: string): Bar[] {
  const t = asOf.getTime();
  const nominal = NOMINAL_MS[interval] ?? 0;
  const out: Bar[] = [];

  // The label is NOT the open time — see inferOpenSkewMs. Recover the offset from the data
  // before deciding which bar was still forming at `asOf`.
  const skew = nominal ? inferOpenSkewMs(bars, oneHour, nominal) : 0;

  for (let i = 0; i < bars.length; i++) {
    const openMs = bars[i].timestamp.getTime() - skew;
    if (openMs > t) break;   // bar had not started yet

    // A bar's close is the NEXT bar's open. Convention-free, and immune to gaps and holidays.
    // Only the final bar in the series needs the nominal fallback.
    const closeMs = i + 1 < bars.length ? bars[i + 1].timestamp.getTime() - skew : openMs + nominal;

    if (closeMs <= t) {
      out.push(bars[i]);                       // fully closed by asOf
    } else {
      // This is the forming bar. Rebuild it from 1H so it contains ONLY data up to asOf —
      // never the future price the stored bar would carry.
      const partial = buildPartialBar(oneHour, new Date(openMs), asOf);
      if (partial) partial.timestamp = bars[i].timestamp;   // keep TD's label so hashes line up
      if (partial) out.push(partial);
      break;                                    // nothing after the forming bar exists yet
    }
  }

  return out;
}

/**
 * Slice 1H bars as-of. The 1H series is the base timeframe, so there is nothing finer to
 * rebuild a partial bar from.
 *
 * NOTE ON PRODUCTION FIDELITY: live `analyze()` reads the last 1H close as `currentPrice`
 * (signal-generator.ts:651) and that bar is the FORMING one — production genuinely analysed
 * an incomplete hour. To reproduce that, pass `includeForming: true`, which rebuilds the
 * forming hour from 5-minute data when supplied.
 */
export function sliceOneHourAsOf(
  oneHour: Bar[],
  asOf: Date,
  opts?: { includeForming?: boolean; fiveMin?: Bar[] }
): Bar[] {
  const t = asOf.getTime();
  const closed = oneHour.filter(b => b.timestamp.getTime() + NOMINAL_MS['1h'] <= t);

  if (!opts?.includeForming) return closed;

  const formingOpen = oneHour.find(b => {
    const o = b.timestamp.getTime();
    return o <= t && o + NOMINAL_MS['1h'] > t;
  });
  if (!formingOpen) return closed;

  // Rebuild from 5-min if available; otherwise fall back to the stored bar, which for
  // HISTORICAL data is complete and therefore carries look-ahead — so only do this when
  // 5-min data genuinely is not available, and say so.
  if (opts.fiveMin?.length) {
    const partial = buildPartialBar(opts.fiveMin, formingOpen.timestamp, asOf);
    return partial ? [...closed, partial] : closed;
  }
  return closed;
}

/**
 * Take exactly the last N bars.
 *
 * This is NOT cosmetic. `Indicators.ema` seeds from the SMA of the FIRST `period` elements
 * then iterates the whole array, so the value depends on HOW MANY bars are passed. Weekly
 * EMA(50) over 52 candles retains 92% seed weight — measured worth TEN confidence points,
 * which crosses the MEDIUM/HIGH tier boundary. `adx()` and `macd()` share this dependence.
 *
 * Production passes exactly 52 / 200 / 360 / 1440 (signal-generator.ts:1291-1297). A backtest
 * passing "everything up to asOf" computes different indicators from the same market data.
 */
export function lastN<T>(bars: T[], n: number): T[] {
  return bars.length <= n ? bars : bars.slice(bars.length - n);
}

/** The exact array sizes production requests. Do not deviate. */
export const PRODUCTION_SIZES = {
  weekly: 52,      // the EMA(50)-from-52 defect lives here — baseline must keep it
  daily: 200,
  fourHour: 360,
  oneHour: 1440,
} as const;

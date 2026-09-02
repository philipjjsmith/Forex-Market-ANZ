/**
 * Do the prices we ANALYSE match the prices we TRADE?
 *
 * WHY THIS EXISTS
 *
 * Signals are computed on Twelve Data candles and executed at cTrader prices. Nothing has ever
 * compared the two, so any disagreement between them has been silently absorbed into "slippage".
 * The two real trades on 2026-09-02 filled 0.4 and 1.1 pips adverse to their signal entry, and
 * with one price source there is no way to tell how much of that was spread and how much was our
 * candles simply disagreeing with the broker's.
 *
 * On stops of 9.5 and 12.9 pips, one pip is roughly 8-10% of R. That is not a rounding error on a
 * system whose measured edge is negative.
 *
 * WHAT THIS IS NOT
 *
 * It is NOT a replacement for Twelve Data. Pre-registration Amendment 2 requires PRODUCTION to
 * stay on Twelve Data so the `signal_provenance` reproduction evidence stays uncontaminated —
 * swapping the feed would invalidate the chain that makes signals verifiable. This is a parallel
 * measurement that changes no decision and touches no signal.
 *
 * Read-only on both sides: it places nothing and decides nothing. It is NOT literally
 * side-effect-free — `listTrendbars` authenticates, and an expired access token causes
 * `getAccessToken()` to persist a rotated refresh token to `ctrader_auth`. That single row is the
 * only mutation, it is serialised, and it would have happened on the next order anyway. Saying
 * "stores nothing" would have been false, which is the kind of claim this project has learned to
 * stop making.
 */
import { twelveDataAPI } from './twelve-data';
import { ctraderExecutor, CTraderExecutor } from './ctrader-executor';
import { sessionAnalyzer } from './session-analyzer';

/** The pairs production analyses. */
const SYMBOLS = ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD'];

/**
 * Timeframes to compare, mapped to cTrader period ids.
 *
 * 1h is the one that matters most: it is the entry timeframe, where RSI/ATR/ADX are computed and
 * where a disagreement would actually change a decision. The higher timeframes are included
 * because a divergence there would move the hard trend gates.
 */
const P = CTraderExecutor.TRENDBAR_PERIOD;
const FRAMES: { td: string; ct: number; label: string }[] = [
  { td: '1h',   ct: P.H1, label: '1h'   },
  { td: '4h',   ct: P.H4, label: '4h'   },
  { td: '1day', ct: P.D1, label: '1day' },
];

export interface FrameComparison {
  symbol: string;
  frame: string;
  matchedBars: number;
  /** Median ABSOLUTE close difference. Magnitude of disagreement. */
  medianClosePips: number | null;
  maxClosePips: number | null;
  /**
   * SIGNED mean (TwelveData - cTrader). This is the field that separates the two explanations,
   * and reporting only the absolute value would conflate them:
   *   a consistent ONE-SIDED offset  => a spread/side difference (cTrader trendbars are BID,
   *                                     Twelve Data forex is effectively MID — established by
   *                                     this project's own Dukascopy comparison)
   *   a SYMMETRIC scatter around 0   => genuine feed disagreement
   * Without it, half a spread reads identically to a broken feed.
   */
  meanSignedPips: number | null;
  worstBar: { timestamp: string; twelveData: number; ctrader: number; pips: number } | null;
  twelveDataBars: number;
  ctraderBars: number;
  /** Populated ONLY when nothing matched — the bar boundaries each side actually used. */
  boundarySample?: { twelveData: string[]; ctrader: string[] };
  error?: string;
}

const pipFactor = (symbol: string) => (symbol.includes('JPY') ? 100 : 10000);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Compare one symbol/timeframe. Bars are matched on EXACT timestamp — never by index.
 *
 * Index alignment is the obvious shortcut and it is wrong: the two feeds do not agree on which
 * bars exist. Twelve Data historically emitted synthetic bars for hours when the market was shut
 * (28.5% of 1H bars, fixed in v3.4.0 by filtering), and the two sources can differ on the newest
 * bar because of publication lag — measured at a median 1.4 minutes for Twelve Data. Comparing
 * position N to position N would silently compare different hours and report the difference as a
 * price discrepancy.
 */
async function compareFrame(symbol: string, frame: { td: string; ct: number; label: string }, bars: number): Promise<FrameComparison> {
  const base: FrameComparison = {
    symbol, frame: frame.label, matchedBars: 0,
    medianClosePips: null, maxClosePips: null, meanSignedPips: null, worstBar: null,
    twelveDataBars: 0, ctraderBars: 0,
  };

  try {
    const td = await twelveDataAPI.fetchHistoricalCandles(symbol, frame.td, bars);
    if (!Array.isArray(td) || td.length === 0) return { ...base, error: 'Twelve Data returned no candles' };
    base.twelveDataBars = td.length;

    // Ask cTrader for the same window the Twelve Data set covers, widened a little at each end so
    // boundary bars are present on both sides rather than clipped.
    const times = td.map((c: any) => new Date(c.timestamp).getTime()).filter(Number.isFinite);
    const fromMs = Math.min(...times) - 6 * 60 * 60 * 1000;
    const toMs = Math.max(...times) + 6 * 60 * 60 * 1000;

    const ct = await ctraderExecutor.listTrendbars(symbol, frame.ct, fromMs, toMs);
    base.ctraderBars = ct.length;
    if (!ct.length) return { ...base, error: 'cTrader returned no trendbars' };

    const ctByTime = new Map<number, any>();
    for (const b of ct) ctByTime.set(new Date(b.timestamp).getTime(), b);

    const f = pipFactor(symbol);
    const diffs: number[] = [];        // absolute, for magnitude
    const signed: number[] = [];       // TwelveData - cTrader, for direction
    let worst: FrameComparison['worstBar'] = null;

    for (const c of td as any[]) {
      const t = new Date(c.timestamp).getTime();
      const match = ctByTime.get(t);
      if (!match) continue;

      const delta = (Number(c.close) - Number(match.close)) * f;
      // NaN guard. A missing field anywhere upstream yields NaN, which survives median() and
      // JSON-serialises to null — landing on the exact same output as "no divergence found".
      // Silence that looks like agreement is the failure mode this whole file exists to avoid.
      if (!Number.isFinite(delta)) continue;

      signed.push(delta);
      const pips = Math.abs(delta);
      diffs.push(pips);
      if (!worst || pips > worst.pips) {
        worst = {
          timestamp: new Date(c.timestamp).toISOString(),
          twelveData: Number(c.close), ctrader: Number(match.close),
          pips: Number(pips.toFixed(2)),
        };
      }
    }

    // ZERO MATCHES IS A FAILURE, NOT A CLEAN RESULT.
    //
    // Without this branch the function returns matchedBars 0 with null pip figures and no error,
    // and the summary then reports errors: 0 — which reads identically to "checked, feeds agree".
    // Total timestamp misalignment is the MOST LIKELY failure of this design, not the least:
    // cTrader trendbars are broker-server aligned while Twelve Data daily bars are labelled by the
    // date they END (a quirk this project already documented). D1 in particular may never line up.
    // Returning the actual boundaries each side used turns a silent null into a diagnosis.
    if (diffs.length === 0) {
      return {
        ...base,
        error: `0 of ${td.length} bars matched — the two feeds do not share bar boundaries on this timeframe. `
             + `This is a measurement failure, NOT evidence the feeds agree.`,
        boundarySample: {
          twelveData: (td as any[]).slice(-4).map((c: any) => new Date(c.timestamp).toISOString()),
          ctrader: ct.slice(-4).map((b: any) => b.timestamp),
        },
      };
    }

    const meanSigned = signed.reduce((a, b) => a + b, 0) / signed.length;

    return {
      ...base,
      matchedBars: diffs.length,
      medianClosePips: Number((median(diffs) ?? 0).toFixed(2)),
      maxClosePips: Number(Math.max(...diffs).toFixed(2)),
      meanSignedPips: Number(meanSigned.toFixed(3)),
      worstBar: worst,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

/**
 * Compare every pair and timeframe.
 *
 * Sequential on purpose. cTrader allows 5 historical requests/second per connection and Twelve
 * Data's free tier allows 8 per MINUTE — the Twelve Data side is the binding constraint, and
 * hammering it would starve live signal generation, which shares the key.
 */
let inFlight = false;

export async function runPriceCrosscheck(bars = 60, opts: { force?: boolean } = {}): Promise<{
  ranAt: string;
  bars: number;
  comparisons: FrameComparison[];
  summary: {
    worstMedianPips: number | null; worstMaxPips: number | null;
    errors: number; framesWithNoMatches: number; framesCompared: number;
    interpretation: string;
  };
}> {
  // KILL-ZONE GUARD. The doc comment used to claim this ran outside kill zones while nothing
  // enforced it. 15 Twelve Data calls behind an 8-second global limiter is ~2 minutes of queue
  // sitting in front of live signal generation, which shares the key. Claiming a safety property
  // without implementing it is worse than not claiming it.
  if (!opts.force && sessionAnalyzer.isInKillZone()) {
    throw new Error(
      `REFUSED: inside a kill zone (${sessionAnalyzer.getKillZoneName()}). This run would queue ~2 `
      + `minutes of Twelve Data calls ahead of live signal generation, which shares the key. `
      + `Run it outside 07:00-09:59 and 12:00-14:59 UTC, or pass force.`);
  }

  // Single-flight. The client disables its button, but two tabs defeat that and each run spends
  // 15 calls of a shared 800/day budget.
  if (inFlight) throw new Error('REFUSED: a cross-check is already running.');
  inFlight = true;
  try {

  const comparisons: FrameComparison[] = [];
  for (const symbol of SYMBOLS) {
    for (const frame of FRAMES) {
      comparisons.push(await compareFrame(symbol, frame, bars));
    }
  }

  const medians = comparisons.map(c => c.medianClosePips).filter((v): v is number => v !== null);
  const maxes = comparisons.map(c => c.maxClosePips).filter((v): v is number => v !== null);

  return {
    ranAt: new Date().toISOString(),
    bars,
    comparisons,
    summary: {
      worstMedianPips: medians.length ? Number(Math.max(...medians).toFixed(2)) : null,
      worstMaxPips: maxes.length ? Number(Math.max(...maxes).toFixed(2)) : null,
      errors: comparisons.filter(c => c.error).length,
      framesWithNoMatches: comparisons.filter(c => c.matchedBars === 0).length,
      framesCompared: comparisons.filter(c => c.matchedBars > 0).length,
      // Stated rather than left to the reader, because the natural misreading is expensive:
      // a consistent one-sided meanSignedPips is a BID-vs-MID artefact, not a broken feed.
      interpretation:
        'meanSignedPips = TwelveData - cTrader. A consistent one-sided offset across pairs is a '
      + 'side/spread artefact (cTrader trendbars are BID, Twelve Data is effectively MID) and is '
      + 'EXPECTED. Symmetric scatter around zero is genuine feed disagreement. '
      + 'framesWithNoMatches > 0 means those frames were NOT measured at all.',
    },
  };
  } finally {
    inFlight = false;
  }
}

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
 * Read-only on both sides. Places nothing, stores nothing, decides nothing.
 */
import { twelveDataAPI } from './twelve-data';
import { ctraderExecutor } from './ctrader-executor';

/** The pairs production analyses. */
const SYMBOLS = ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD'];

/**
 * Timeframes to compare, mapped to cTrader period ids.
 *
 * 1h is the one that matters most: it is the entry timeframe, where RSI/ATR/ADX are computed and
 * where a disagreement would actually change a decision. The higher timeframes are included
 * because a divergence there would move the hard trend gates.
 */
const FRAMES: { td: string; ct: number; label: string }[] = [
  { td: '1h',  ct: 9,  label: '1h'  },
  { td: '4h',  ct: 10, label: '4h'  },
  { td: '1day', ct: 12, label: '1day' },
];

export interface FrameComparison {
  symbol: string;
  frame: string;
  matchedBars: number;
  medianClosePips: number | null;
  maxClosePips: number | null;
  worstBar: { timestamp: string; twelveData: number; ctrader: number; pips: number } | null;
  twelveDataBars: number;
  ctraderBars: number;
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
    medianClosePips: null, maxClosePips: null, worstBar: null,
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
    const diffs: number[] = [];
    let worst: FrameComparison['worstBar'] = null;

    for (const c of td as any[]) {
      const t = new Date(c.timestamp).getTime();
      const match = ctByTime.get(t);
      if (!match) continue;
      const pips = Math.abs(Number(c.close) - Number(match.close)) * f;
      diffs.push(pips);
      if (!worst || pips > worst.pips) {
        worst = { timestamp: c.timestamp, twelveData: Number(c.close), ctrader: Number(match.close), pips: Number(pips.toFixed(2)) };
      }
    }

    return {
      ...base,
      matchedBars: diffs.length,
      medianClosePips: diffs.length ? Number((median(diffs) ?? 0).toFixed(2)) : null,
      maxClosePips: diffs.length ? Number(Math.max(...diffs).toFixed(2)) : null,
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
export async function runPriceCrosscheck(bars = 60): Promise<{
  ranAt: string;
  bars: number;
  comparisons: FrameComparison[];
  summary: { worstMedianPips: number | null; worstMaxPips: number | null; errors: number };
}> {
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
    },
  };
}

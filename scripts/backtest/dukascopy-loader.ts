/**
 * Dukascopy history loader for the 4-year backtest.
 *
 * Decision (pre-registration Amendment 2, 2026-08-29): the backtest uses Dukascopy; PRODUCTION
 * stays on Twelve Data so the `signal_provenance` reproduction evidence stays uncontaminated.
 * Twelve Data's 800-call/day free tier cannot reach a 4-year, 5-pair, 5-minute replay — it was
 * fully exhausted backfilling two pairs over four months.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT
 * ----------------------------------------
 * 1. **Mid, not bid.** Measured against cached Twelve Data, TD forex is effectively MID:
 *    mid tracks it to ~0.45 pips median with −0.2 pips bias, while raw bid carries −0.49 to
 *    −0.80 pips of systematic offset. Backtesting the strategy on bid while production computed
 *    on mid would inject roughly half a spread of drift into every indicator. So mid is
 *    synthesised from bid+ask here, once, at load time.
 *
 * 2. **The spread is kept, not discarded.** Dukascopy's own ask−bid is retained per bar so the
 *    fill model can use a spread DISTRIBUTION rather than a constant. A 48h hold crosses at
 *    least one rollover, where the measured spread spikes to 11.5 pips (EUR/USD) and 30.1
 *    (USD/CHF) against medians of 0.30 and 0.80.
 *
 * > Recording the observed spread is NOT permission to model costs with it. Amendment 2 §A2.3:
 * > Dukascopy is a near-interbank ECN feed and The5ers is where these trades would actually
 * > execute. §6's conservative assumptions stand until real The5ers spreads are obtained.
 *
 * Unlike Twelve Data, Dukascopy omits weekends correctly — TD returns a continuous 24/7 series
 * in which 28.5% of bars fall in market-closed hours and none are flat (§A2.4).
 *
 * Cached to disk, so a re-run costs nothing.
 *
 * USAGE:
 *   npx tsx scripts/backtest/dukascopy-loader.ts                       (primary window, all pairs)
 *   npx tsx scripts/backtest/dukascopy-loader.ts --from=2022-08-01 --to=2026-08-01 --tf=m5
 */
import fs from 'fs';
import path from 'path';
import { getHistoricalRates } from 'dukascopy-node';
import { isMarketOpen } from './engine';

const CACHE_DIR = path.resolve('.backtest-cache');

export interface DukaBar {
  timestamp: number;
  open: number; high: number; low: number; close: number;
  volume: number;
  /** ask − close-of-bid at this bar, in price units. Feeds the fill model's spread distribution. */
  spread: number;
}

/** Production's pair set, chosen 2026-08-28 — counts as a trial under §7. */
export const PAIRS: Record<string, string> = {
  'EUR/USD': 'eurusd', 'USD/CHF': 'usdchf', 'USD/JPY': 'usdjpy',
  'GBP/USD': 'gbpusd', 'AUD/USD': 'audusd',
};

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Fetch one side, in CHUNKS.
 *
 * A single call spanning four years silently loses whole days. Verified against the source:
 * usdchf 2022-10-04 (285 bars) and audusd 2025-11-10/11 (288 bars each) are all served fine by
 * Dukascopy when requested directly, yet were absent from a 4-year single-call download. Across
 * five pairs that was ~126,000 market-open minutes — roughly 87 trading days — missing from the
 * backtest, with holes up to 70 hours.
 *
 * Chunking bounds the blast radius of any one failed sub-request, and the caller verifies
 * coverage afterwards rather than trusting the result.
 */
const CHUNK_DAYS = 90;

async function fetchSide(instrument: string, from: Date, to: Date, tf: string, priceType: 'bid' | 'ask') {
  const out: any[] = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const end = new Date(Math.min(+cursor + CHUNK_DAYS * 86400_000, +to));
    let attempt = 0;
    for (;;) {
      try {
        const rows: any = await getHistoricalRates({
          instrument: instrument as any,
          dates: { from: cursor, to: end },
          timeframe: tf as any,
          priceType: priceType as any,
          format: 'json' as any,
        });
        out.push(...(rows as any[]));
        break;
      } catch (e: any) {
        // A silently-swallowed chunk failure is exactly how the days went missing. Retry, and
        // if it still fails, say so loudly rather than returning a quietly short series.
        if (++attempt >= 3) {
          console.warn(`      ! ${instrument} ${priceType} ${cursor.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)} FAILED after 3 tries: ${e?.message?.slice(0, 60)}`);
          break;
        }
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    cursor = end;
  }
  // De-duplicate on timestamp: chunk boundaries overlap by one bar.
  const seen = new Map<number, any>();
  for (const b of out) seen.set(b.timestamp, b);
  return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Load one pair as MID bars with per-bar spread. Cached on disk.
 *
 * Bars present on only one side are dropped: without both sides there is no mid and no spread,
 * and silently substituting one side is exactly the half-spread drift this file exists to avoid.
 */
export async function loadDukascopy(
  symbol: string, from: Date, to: Date, tf = 'm5'
): Promise<DukaBar[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const slug = `duka-${symbol.replace('/', '')}-${tf}-${fmt(from)}-${fmt(to)}.json`;
  const file = path.join(CACHE_DIR, slug);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

  const instrument = PAIRS[symbol];
  if (!instrument) throw new Error(`Unknown pair ${symbol}`);

  const [bid, ask] = await Promise.all([
    fetchSide(instrument, from, to, tf, 'bid'),
    fetchSide(instrument, from, to, tf, 'ask'),
  ]);

  const askMap = new Map<number, any>(ask.map(r => [r.timestamp, r]));
  const out: DukaBar[] = [];
  let unmatched = 0;
  for (const b of bid) {
    const a = askMap.get(b.timestamp);
    if (!a) { unmatched++; continue; }
    out.push({
      timestamp: b.timestamp,
      open: (b.open + a.open) / 2,
      high: (b.high + a.high) / 2,
      low: (b.low + a.low) / 2,
      close: (b.close + a.close) / 2,
      volume: b.volume ?? 0,
      spread: a.close - b.close,
    });
  }

  // Verify coverage before trusting the file. A silent short series is the failure mode that
  // cost ~87 trading days last time, and it is invisible unless explicitly checked.
  let missingOpenMin = 0, worst = 0;
  for (let i = 1; i < out.length; i++) {
    const gap = (out[i].timestamp - out[i - 1].timestamp) / 60_000;
    if (gap <= 5) continue;
    let closed = 0;
    for (let t = out[i - 1].timestamp; t < out[i].timestamp; t += 300_000) {
      if (!isMarketOpen(new Date(t))) closed += 5;
    }
    const openGap = gap - closed;
    if (openGap > 30) { missingOpenMin += openGap; worst = Math.max(worst, openGap); }
  }
  if (missingOpenMin > 0) {
    console.log(`      ! ${symbol}: ${Math.round(missingOpenMin)} market-open minutes still missing (worst hole ${Math.round(worst)} min)`);
  }

  fs.writeFileSync(file, JSON.stringify(out));
  if (unmatched) console.log(`      (${unmatched} bid bars had no matching ask and were dropped)`);
  return out;
}

if (process.argv[1] && process.argv[1].includes('dukascopy-loader')) {
  (async () => {
    // §4 primary decision window. The secondary 2022-08 -> 2024-08 window is VETO-ONLY.
    const from = new Date(arg('from', '2022-08-01'));
    const to = new Date(arg('to', '2026-08-01'));
    const tf = arg('tf', 'm5');
    const only = arg('pairs', '');
    const pairs = only ? only.split(',') : Object.keys(PAIRS);

    console.log(`Dukascopy ${tf}  ${fmt(from)} -> ${fmt(to)}  (${pairs.length} pairs)\n`);
    const t0 = Date.now();
    for (const sym of pairs) {
      const t = Date.now();
      try {
        const bars = await loadDukascopy(sym, from, to, tf);
        const pip = sym.includes('JPY') ? 0.01 : 0.0001;
        const sp = bars.map(b => b.spread / pip).sort((a, b) => a - b);
        const med = sp.length ? sp[Math.floor(sp.length / 2)] : NaN;
        const p95 = sp.length ? sp[Math.floor(sp.length * 0.95)] : NaN;
        console.log(
          `  ${sym.padEnd(8)} ${String(bars.length).padStart(7)} mid bars in ${((Date.now() - t) / 1000).toFixed(1)}s` +
          `   spread med ${med.toFixed(2)} p95 ${p95.toFixed(2)} max ${sp.length ? sp[sp.length - 1].toFixed(2) : '-'} pips`
        );
      } catch (e: any) {
        console.log(`  ${sym.padEnd(8)} FAILED: ${e?.message?.slice(0, 70)}`);
      }
    }
    console.log(`\ntotal ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
    process.exit(0);
  })();
}

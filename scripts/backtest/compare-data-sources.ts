/**
 * Twelve Data vs Dukascopy — quantify the divergence BEFORE trusting either for a backtest.
 *
 * Decision recorded 2026-08-29: the 4-year backtest will use Dukascopy (no API key, no rate
 * limit, m5 back to the 1990s), while PRODUCTION stays on Twelve Data so the provenance
 * reproduction evidence keeps accumulating uncontaminated.
 *
 * That split creates a validity gap: an edge measured on Dukascopy prices may not transfer to a
 * system that trades on Twelve Data prices. This script turns that gap into a NUMBER instead of
 * an assumption, per the pre-registration's rule that cost and data assumptions are settled
 * before results exist.
 *
 * The critical thing it detects is a SYSTEMATIC bias. Dukascopy serves bid and ask separately;
 * Twelve Data forex is effectively mid. If we compared TD-mid against Dukascopy-bid we would see
 * a constant offset of roughly half the spread and could easily mistake it for an edge — or for
 * noise. So this compares TD against Dukascopy bid, ask, AND synthesised mid.
 *
 * Uses the ALREADY-CACHED Twelve Data bars in .backtest-cache, so it costs zero API quota.
 *
 * USAGE:
 *   npx tsx scripts/backtest/compare-data-sources.ts
 *   npx tsx scripts/backtest/compare-data-sources.ts --days=7      (quick smoke test)
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { getHistoricalRates } from 'dukascopy-node';

const DAYS = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] ?? 0);

interface Bar { timestamp: number; open: number; high: number; low: number; close: number }

const PAIRS: { td: string; duka: string; file: string }[] = [
  { td: 'EUR/USD', duka: 'eurusd', file: 'EURUSD-5min-2026-04-15-2026-09-01.json' },
  { td: 'USD/CHF', duka: 'usdchf', file: 'USDCHF-5min-2026-04-15-2026-09-01.json' },
];

const pipOf = (s: string) => (s.includes('JPY') ? 0.01 : 0.0001);
const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)] : NaN);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

function loadTD(file: string): Bar[] {
  const raw = JSON.parse(fs.readFileSync(path.join('.backtest-cache', file), 'utf8'));
  return raw.map((b: any) => ({
    timestamp: new Date(b.timestamp).getTime(),
    open: b.open, high: b.high, low: b.low, close: b.close,
  }));
}

async function loadDuka(instrument: string, from: Date, to: Date, priceType: 'bid' | 'ask'): Promise<Bar[]> {
  const rows: any = await getHistoricalRates({
    instrument: instrument as any,
    dates: { from, to },
    timeframe: 'm5' as any,
    priceType: priceType as any,
    format: 'json' as any,
  });
  return (rows as any[]).map(r => ({
    timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close,
  }));
}

/** Compare two aligned series and report per-component error in pips. */
function report(label: string, td: Map<number, Bar>, other: Bar[], pip: number) {
  const diffs: Record<string, number[]> = { open: [], high: [], low: [], close: [] };
  const signed: number[] = [];
  let matched = 0;

  for (const b of other) {
    const t = td.get(b.timestamp);
    if (!t) continue;
    matched++;
    for (const k of ['open', 'high', 'low', 'close'] as const) {
      diffs[k].push(Math.abs((b as any)[k] - (t as any)[k]) / pip);
    }
    signed.push((b.close - t.close) / pip);
  }

  if (!matched) { console.log(`    ${label.padEnd(6)} no overlapping timestamps`); return null; }

  const c = diffs.close;
  console.log(
    `    ${label.padEnd(6)} n=${String(matched).padStart(6)}  ` +
    `close |Δ| med ${q(c, 0.5).toFixed(2)} p95 ${q(c, 0.95).toFixed(2)} max ${q(c, 1).toFixed(2)} pips  |  ` +
    `SIGNED mean ${mean(signed) >= 0 ? '+' : ''}${mean(signed).toFixed(2)} pips`
  );
  console.log(
    `           high |Δ| med ${q(diffs.high, 0.5).toFixed(2)}  low |Δ| med ${q(diffs.low, 0.5).toFixed(2)}  ` +
    `open |Δ| med ${q(diffs.open, 0.5).toFixed(2)}`
  );
  return { matched, medClose: q(c, 0.5), signedMean: mean(signed) };
}

(async () => {
  for (const p of PAIRS) {
    const tdBars = loadTD(p.file);
    let from = new Date(tdBars[0].timestamp);
    const to = new Date(tdBars[tdBars.length - 1].timestamp);
    if (DAYS) from = new Date(to.getTime() - DAYS * 86400_000);

    const tdIn = tdBars.filter(b => b.timestamp >= +from && b.timestamp <= +to);
    const tdMap = new Map(tdIn.map(b => [b.timestamp, b]));

    console.log(`\n${p.td}  ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}`);
    console.log(`  Twelve Data (cached): ${tdIn.length} m5 bars`);

    const [bid, ask] = await Promise.all([
      loadDuka(p.duka, from, to, 'bid'),
      loadDuka(p.duka, from, to, 'ask'),
    ]);
    console.log(`  Dukascopy: ${bid.length} bid / ${ask.length} ask bars`);

    // Synthesised mid — the like-for-like comparison against TD.
    const askMap = new Map(ask.map(b => [b.timestamp, b]));
    const mid: Bar[] = [];
    for (const b of bid) {
      const a = askMap.get(b.timestamp);
      if (!a) continue;
      mid.push({
        timestamp: b.timestamp,
        open: (b.open + a.open) / 2, high: (b.high + a.high) / 2,
        low: (b.low + a.low) / 2, close: (b.close + a.close) / 2,
      });
    }

    const pip = pipOf(p.td);
    console.log(`  vs Twelve Data (error in pips):`);
    report('bid', tdMap, bid, pip);
    report('ask', tdMap, ask, pip);
    report('mid', tdMap, mid, pip);

    // Observed spread — feeds the §6 cost model, which currently uses guessed defaults.
    const spreads: number[] = [];
    for (const b of bid) {
      const a = askMap.get(b.timestamp);
      if (a) spreads.push((a.close - b.close) / pip);
    }
    if (spreads.length) {
      console.log(`  OBSERVED SPREAD (Dukascopy ask-bid, close): med ${q(spreads, 0.5).toFixed(2)}  ` +
        `p95 ${q(spreads, 0.95).toFixed(2)}  max ${q(spreads, 1).toFixed(2)} pips`);
      console.log(`     (pre-registration §6 currently assumes 1.0 EUR/USD, 1.5 USD/CHF)`);
    }
  }
  console.log('');
})();

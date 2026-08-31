/**
 * Measure the real return correlation between the traded pairs.
 *
 * This exists because the correlation control must not be guesswork. The sign is the whole
 * point: EUR/USD and USD/CHF run strongly NEGATIVE, which means a LONG on one and a SHORT on
 * the other is the SAME bet placed twice, not a hedge. A control that only counted open
 * positions would get that backwards.
 *
 * Reads the Dukascopy m5 cache already on disk. No network, no API key.
 *
 * USAGE: npx tsx scripts/measure-pair-correlation.ts
 */
import fs from 'fs';
import path from 'path';

const DIR = path.resolve('.backtest-cache');
const PAIRS = ['EURUSD', 'USDCHF', 'GBPUSD', 'USDJPY', 'AUDUSD'];
const BUCKET_MS = 60 * 60_000; // aggregate m5 -> 1H, the timeframe signals are generated on

/** Close price per hour bucket, keyed by bucket start. */
function hourlyCloses(sym: string): Map<number, number> {
  const f = path.join(DIR, `duka-${sym}-m5-2022-08-01-2026-08-01.json`);
  const bars = JSON.parse(fs.readFileSync(f, 'utf8')) as Array<{ timestamp: number; close: number }>;
  const out = new Map<number, number>();
  for (const b of bars) out.set(Math.floor(b.timestamp / BUCKET_MS) * BUCKET_MS, b.close);
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}

const closes = new Map(PAIRS.map(p => [p, hourlyCloses(p)]));

/** Log returns on the timestamps BOTH pairs share, so the series are truly aligned. */
function alignedReturns(p: string, q: string): [number[], number[]] {
  const cp = closes.get(p)!, cq = closes.get(q)!;
  const ts = [...cp.keys()].filter(t => cq.has(t)).sort((x, y) => x - y);
  const ra: number[] = [], rb: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] !== BUCKET_MS) continue;      // skip weekend/gap boundaries
    ra.push(Math.log(cp.get(ts[i])! / cp.get(ts[i - 1])!));
    rb.push(Math.log(cq.get(ts[i])! / cq.get(ts[i - 1])!));
  }
  return [ra, rb];
}

console.log('Hourly log-return correlation, 2022-08 -> 2026-08 (Dukascopy mid)\n');
process.stdout.write('          ' + PAIRS.map(p => p.padStart(8)).join('') + '\n');

const matrix: Record<string, Record<string, number>> = {};
for (const p of PAIRS) {
  matrix[p] = {};
  let row = p.padEnd(10);
  for (const q of PAIRS) {
    if (p === q) { matrix[p][q] = 1; row += '    1.00'; continue; }
    const [a, b] = alignedReturns(p, q);
    const r = pearson(a, b);
    matrix[p][q] = r;
    row += r.toFixed(2).padStart(8);
  }
  console.log(row);
}

const [sampleA] = alignedReturns('EURUSD', 'USDCHF');
console.log(`\naligned hourly observations per pairing: ~${sampleA.length.toLocaleString()}`);

console.log('\n--- pairings at |r| >= 0.60, and what they mean for RISK ---');
const seen = new Set<string>();
for (const p of PAIRS) {
  for (const q of PAIRS) {
    if (p === q) continue;
    const key = [p, q].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = matrix[p][q];
    if (Math.abs(r) < 0.6) continue;
    const compounds = r > 0 ? 'SAME direction' : 'OPPOSITE directions';
    console.log(
      `${p} / ${q}  r = ${r.toFixed(3).padStart(6)}   ` +
      `-> risk COMPOUNDS when the two trades are in ${compounds}`
    );
  }
}
console.log(
  '\nRead that carefully: with a negative r, LONG one + SHORT the other is the SAME bet twice.'
);

/**
 * Union the chunked and single-call Dukascopy downloads.
 *
 * Neither download is complete on its own, and they are incomplete in DIFFERENT ways:
 *
 *   - the original single 4-year call silently dropped whole days (usdchf 2022-10-04,
 *     audusd 2025-11-10/11 — all verified present at the source when requested directly)
 *   - the 90-day chunked re-download recovered those, but came back with fewer bars overall on
 *     some pairs, because Dukascopy serves DIFFERENT bar sets for bid and ask on the same window
 *     (measured: bid 5760 vs ask 6300 for usdchf March 2023) and the loader's coverage is capped
 *     by whichever side is weaker
 *
 * Both files come from the same source and every bar in each is genuine, so the union is strictly
 * more complete than either. Bars are keyed on timestamp; where both files have one, the chunked
 * value wins, since its narrower request window is the more reliable read.
 *
 * USAGE: npx tsx scripts/backtest/merge-duka.ts
 */
import fs from 'fs';
import path from 'path';
import { isMarketOpen } from './engine';

const DIR = path.resolve('.backtest-cache');
const OLD = path.join(DIR, 'pre-chunkfix');

const openGapMinutes = (bars: any[]) => {
  let missing = 0, worst = 0;
  for (let i = 1; i < bars.length; i++) {
    const gap = (bars[i].timestamp - bars[i - 1].timestamp) / 60_000;
    if (gap <= 5) continue;
    let closed = 0;
    for (let t = bars[i - 1].timestamp; t < bars[i].timestamp; t += 300_000) {
      if (!isMarketOpen(new Date(t))) closed += 5;
    }
    const open = gap - closed;
    if (open > 30) { missing += open; worst = Math.max(worst, open); }
  }
  return { missing: Math.round(missing), worst: Math.round(worst) };
};

let files = fs.existsSync(OLD) ? fs.readdirSync(OLD).filter(f => f.startsWith('duka-')) : [];
if (!files.length) { console.log('no pre-chunkfix files to merge'); process.exit(0); }

for (const f of files) {
  const newPath = path.join(DIR, f), oldPath = path.join(OLD, f);
  if (!fs.existsSync(newPath)) { console.log(`  ${f}: chunked file not present yet — skipped`); continue; }

  const oldBars = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newBars = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  const merged = new Map<number, any>();
  for (const b of oldBars) merged.set(b.timestamp, b);
  for (const b of newBars) merged.set(b.timestamp, b);   // chunked wins on conflict

  /**
   * Drop structurally impossible bars.
   *
   * Mid is synthesised as (bid+ask)/2 per field. When Dukascopy's bid and ask bars do not
   * correspond to the same ticks, that average can place the open or close OUTSIDE the averaged
   * high/low, or make ask < bid (a negative spread, which cannot exist in a real quote). Measured
   * on the merged set: 86 impossible bars and 29 negative spreads out of ~1.5M, clustered on
   * 2024-10-10 — 0.006%.
   *
   * They are dropped rather than clamped. An impossible bar can produce a nonsense fill or a
   * resolution against a price that never traded, and inventing a plausible value to replace it
   * is precisely the fabrication this project spent the day proving Twelve Data guilty of.
   */
  const all = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
  const out = all.filter(b =>
    b.high >= b.low && b.open <= b.high && b.open >= b.low &&
    b.close <= b.high && b.close >= b.low &&
    Number.isFinite(b.spread) && b.spread >= 0
  );
  const dropped = all.length - out.length;
  if (dropped) console.log(`  ${f.slice(5, 11).padEnd(7)} dropped ${dropped} structurally impossible bar(s)`);

  const go = openGapMinutes(oldBars), gn = openGapMinutes(newBars), gm = openGapMinutes(out);
  console.log(
    `  ${f.slice(5, 11).padEnd(7)} old=${String(oldBars.length).padStart(6)} (gaps ${String(go.missing).padStart(5)}m)` +
    `  chunked=${String(newBars.length).padStart(6)} (gaps ${String(gn.missing).padStart(5)}m)` +
    `  -> MERGED=${String(out.length).padStart(6)} (gaps ${String(gm.missing).padStart(5)}m, worst ${gm.worst}m)`
  );
  fs.writeFileSync(newPath, JSON.stringify(out));
}
console.log('\nmerged files written in place; the backtest will pick them up unchanged.');

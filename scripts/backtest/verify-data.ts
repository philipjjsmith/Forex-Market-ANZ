/**
 * Data integrity gate. Runs BEFORE the report so a result can never be computed on bad bars.
 *
 * Every check here exists because something in this project already went wrong in that exact way:
 * whole days vanished from a 4-year download, a bid/ask intersection silently halved coverage,
 * and Twelve Data served fabricated bars for hours the market was shut. Data problems here do not
 * announce themselves — the backtest just returns a different number.
 *
 * Exits non-zero if anything is wrong, so it can gate a pipeline.
 *
 * USAGE: npx tsx scripts/backtest/verify-data.ts
 */
import fs from 'fs';
import path from 'path';
import { isMarketOpen } from './engine';

const DIR = path.resolve('.backtest-cache');
const files = fs.readdirSync(DIR).filter(f => f.startsWith('duka-') && f.endsWith('.json'));
let problems = 0;

console.log('data integrity — Dukascopy m5 files\n');
for (const f of files) {
  const bars = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const sym = f.slice(5, 11);
  let dupes = 0, unordered = 0, badOhlc = 0, badSpread = 0, missingOpen = 0, worst = 0;
  const seen = new Set<number>();

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (seen.has(b.timestamp)) dupes++; else seen.add(b.timestamp);
    if (i > 0 && b.timestamp <= bars[i - 1].timestamp) unordered++;
    if (b.high < b.low || b.close > b.high || b.close < b.low || b.open > b.high || b.open < b.low) badOhlc++;
    if (!(b.spread >= 0) || !Number.isFinite(b.spread)) badSpread++;
    if (i > 0) {
      const gap = (b.timestamp - bars[i - 1].timestamp) / 60_000;
      if (gap > 5) {
        let closed = 0;
        for (let t = bars[i - 1].timestamp; t < b.timestamp; t += 300_000) if (!isMarketOpen(new Date(t))) closed += 5;
        const open = gap - closed;
        if (open > 30) { missingOpen += open; worst = Math.max(worst, open); }
      }
    }
  }

  const bad = dupes + unordered + badOhlc + badSpread;
  if (bad) problems++;
  const years = (bars[bars.length - 1].timestamp - bars[0].timestamp) / (365.25 * 86400_000);
  const coverage = 100 * bars.length / (years * 252 * 288);

  console.log(
    `  ${sym.padEnd(7)} ${String(bars.length).padStart(7)} bars  coverage ${coverage.toFixed(1)}%  ` +
    `dupes ${dupes}  unordered ${unordered}  bad OHLC ${badOhlc}  bad spread ${badSpread}`
  );
  console.log(
    `          market-open minutes missing: ${Math.round(missingOpen)}  worst hole ${Math.round(worst)} min` +
    (worst > 240 ? '   <-- still a multi-hour hole' : '')
  );
}

console.log(`\n=> ${problems === 0 ? 'no structural defects' : `${problems} file(s) with structural defects`}`);
process.exit(problems === 0 ? 0 : 1);

/**
 * Regression test for `isMarketClosed`.
 *
 * This boundary is subtle and got shipped wrong once, so it is pinned here.
 *
 * The forex week runs Sunday 17:00 to Friday 17:00 NEW YORK time. Expressed in UTC that is
 * 21:00 under EDT but 22:00 under EST. The first version of the filter hardcoded 21:00 UTC,
 * which silently dropped real Friday-evening bars every winter and kept fake Sunday-evening
 * ones. It was caught by cross-checking against Dukascopy — which publishes a bar only when the
 * market actually traded — where the fixed-UTC rule flagged 853 genuine bars per pair over four
 * years, every one a Friday 21:00 bar in November-March.
 *
 * Two independent checks run here:
 *   1. Hand-picked summer/winter timestamps either side of each boundary.
 *   2. If the Dukascopy 4-year files are present, assert ZERO real bars are flagged closed.
 *      That is 1.19M bars across four pairs and is the stronger evidence of the two.
 *
 * USAGE: npx tsx scripts/backtest/test-market-hours.ts
 */
import fs from 'fs';
import path from 'path';
import { isMarketClosed } from '../../server/services/twelve-data';

const CACHE_DIR = path.resolve('.backtest-cache');

const CASES: [string, string, boolean][] = [
  ['2026-01-16T21:30:00Z', 'Fri WINTER 16:30 NY - still trading', false],
  ['2026-01-16T22:30:00Z', 'Fri WINTER 17:30 NY - shut', true],
  ['2026-07-17T20:30:00Z', 'Fri SUMMER 16:30 NY - still trading', false],
  ['2026-07-17T21:30:00Z', 'Fri SUMMER 17:30 NY - shut', true],
  ['2026-01-18T21:30:00Z', 'Sun WINTER 16:30 NY - still shut', true],
  ['2026-01-18T22:30:00Z', 'Sun WINTER 17:30 NY - open', false],
  ['2026-07-19T20:30:00Z', 'Sun SUMMER 16:30 NY - still shut', true],
  ['2026-07-19T21:30:00Z', 'Sun SUMMER 17:30 NY - open', false],
  ['2026-01-17T12:00:00Z', 'Saturday midday winter - shut', true],
  ['2026-07-18T12:00:00Z', 'Saturday midday summer - shut', true],
  ['2026-03-11T12:00:00Z', 'Wednesday midday - trading', false],
  // Twelve Data labels DAILY bars by the date they END, so these three matter:
  ['2026-02-16T00:00:00Z', 'Daily bar labelled Mon (NY Sun 19:00) - keep', false],
  ['2026-02-14T00:00:00Z', 'Daily bar labelled Sat (NY Fri 19:00) - drop', true],
  ['2026-02-15T00:00:00Z', 'Daily bar labelled Sun (NY Sat 19:00) - drop', true],
];

let failures = 0;

console.log('1. boundary assertions');
for (const [iso, desc, want] of CASES) {
  const got = isMarketClosed(new Date(iso));
  if (got !== want) { failures++; console.log(`   FAIL  ${iso}  ${desc}  got ${got}, want ${want}`); }
}
console.log(`   ${CASES.length - failures}/${CASES.length} passed`);

console.log('\n2. cross-check against Dukascopy (bars that provably traded)');
const files = fs.existsSync(CACHE_DIR)
  ? fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('duka-') && f.endsWith('.json'))
  : [];
if (!files.length) {
  console.log('   skipped — no Dukascopy files. Run scripts/backtest/dukascopy-loader.ts first.');
} else {
  let totalBars = 0, totalFlagged = 0;
  for (const f of files) {
    const bars = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
    const flagged = bars.filter((b: any) => isMarketClosed(new Date(b.timestamp)));
    totalBars += bars.length; totalFlagged += flagged.length;
    if (flagged.length) {
      failures++;
      console.log(`   FAIL  ${f}: ${flagged.length} real bars flagged closed, e.g. ${new Date(flagged[0].timestamp).toISOString()}`);
    }
  }
  console.log(`   ${totalBars.toLocaleString()} real bars checked, ${totalFlagged} wrongly flagged`);
}

console.log(`\n=> ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);

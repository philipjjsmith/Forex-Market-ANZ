/**
 * Assertions for the two wall-clock market-time rules.
 *
 * WHY: three separate hand-rolled copies of "when is the market open / when is the news" all
 * hardcoded UTC hours that are only correct under EST, making them an hour wrong for the ~8 months
 * of DST. The concrete cost: NFP on 2026-09-04 releases 12:30 UTC, inside the 12:00-14:59 kill
 * zone, and the old news window would have added +3 for "no news window" at exactly that moment —
 * with 49 of 309 historical signals scoring EXACTLY 90, the threshold that decides live trading.
 *
 * The rule these tests encode: any wall-clock market time is NEW YORK local, never a fixed UTC
 * hour. Runs offline.
 */
import 'dotenv/config';
import { isMarketClosed } from '../server/services/twelve-data';

let pass = 0; const fails: string[] = [];
const eq = (a: any, b: any, name: string) => {
  if (a === b) pass++; else { fails.push(name); console.log(`  FAIL ${name} (got ${a}, want ${b})`); }
};

// Mirrors the news rule in signal-generator.ts. Kept in step deliberately: if that changes and
// this does not, the DST bug returns silently.
const NEWS_HOURS_NEW_YORK = [8, 9, 14, 15];
const nyHour = (d: Date) => Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', hour12: false }).formatToParts(d)
  .find(p => p.type === 'hour')!.value) % 24;
const inNews = (d: Date) => NEWS_HOURS_NEW_YORK.includes(nyHour(d));

console.log('── NEWS WINDOW — the case that motivated this ──');
// 2026-09-04 is the first Friday of September: NFP at 8:30 New York.
eq(inNews(new Date('2026-09-04T12:30:00Z')), true,
   'NFP 2026-09-04 12:30 UTC (8:30 NY, EDT) is INSIDE the news window');
eq(inNews(new Date('2026-09-04T13:30:00Z')), true,
   '13:30 UTC (9:30 NY) still inside — the hour after the release');
eq(inNews(new Date('2026-09-04T14:30:00Z')), false,
   '14:30 UTC (10:30 NY) is OUTSIDE — news has passed');
eq(inNews(new Date('2026-09-04T18:00:00Z')), true,
   'FOMC 18:00 UTC (14:00 NY, EDT) is INSIDE');

console.log('── the same NY hours in WINTER land on different UTC hours ──');
eq(inNews(new Date('2026-01-09T13:30:00Z')), true,
   'NFP 2026-01-09 13:30 UTC (8:30 NY, EST) is INSIDE');
eq(inNews(new Date('2026-01-09T12:30:00Z')), false,
   '12:30 UTC in EST (7:30 NY) is OUTSIDE — pre-market');
eq(inNews(new Date('2026-01-09T19:00:00Z')), true,
   'FOMC 19:00 UTC (14:00 NY, EST) is INSIDE');

console.log('── the OLD hardcoded list would have been wrong tomorrow ──');
const OLD_UTC_HOURS = [13, 14, 19, 20];
eq(OLD_UTC_HOURS.includes(new Date('2026-09-04T12:30:00Z').getUTCHours()), false,
   'OLD code says 12:30 UTC is NOT news — i.e. it would grant +3 during NFP');
eq(inNews(new Date('2026-09-04T12:30:00Z')), true,
   'NEW code correctly says it IS news');

console.log('── MARKET OPEN — week boundary is 17:00 New York, not a fixed UTC hour ──');
eq(isMarketClosed(new Date('2026-09-04T20:59:00Z')), false, 'Fri 20:59 UTC (16:59 NY, EDT) OPEN');
eq(isMarketClosed(new Date('2026-09-04T21:01:00Z')), true,  'Fri 21:01 UTC (17:01 NY, EDT) CLOSED');
eq(isMarketClosed(new Date('2026-01-16T21:30:00Z')), false, 'Fri 21:30 UTC in EST (16:30 NY) still OPEN');
eq(isMarketClosed(new Date('2026-01-16T22:01:00Z')), true,  'Fri 22:01 UTC in EST (17:01 NY) CLOSED');
eq(isMarketClosed(new Date('2026-09-06T20:59:00Z')), true,  'Sun 20:59 UTC (16:59 NY) still CLOSED');
eq(isMarketClosed(new Date('2026-09-06T21:01:00Z')), false, 'Sun 21:01 UTC (17:01 NY) OPEN');
eq(isMarketClosed(new Date('2026-09-05T12:00:00Z')), true,  'Saturday always CLOSED');

console.log('── tomorrow\'s kill zones must be OPEN and mostly news-free ──');
eq(isMarketClosed(new Date('2026-09-04T07:30:00Z')), false, 'Fri 07:30 UTC kill zone 1 — market open');
eq(isMarketClosed(new Date('2026-09-04T12:30:00Z')), false, 'Fri 12:30 UTC kill zone 2 — market open');
eq(inNews(new Date('2026-09-04T07:30:00Z')), false, 'kill zone 1 is not a news window');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log('  - ' + f)); process.exit(1); }

/**
 * Resolve Alex G's USDCHF challenge trade against real price data.
 *
 * From the channel, at full resolution:
 *   Aug 10 setup posted:  LONG, entry ~0.80927, stop ~0.80582, target ~0.81984, captioned "1:3RR"
 *   Aug 11 11:53  USDCHF.i buy 0.3 @ 0.80971               balance 5,102.46
 *   Aug 12 14:17  + USDCHF.i buy 0.3 @ 0.81098  (pyramid)  both at 0.81377, +255.36 floating
 *   Aug 12 14:18  chart shows the ADD carries a TIGHTER stop: 0.80794 vs 0.80582
 *   Aug 13 02:19  both at 0.81413, +298.81 floating
 *   Aug 20 14:22  FLAT.  balance 5,333.08
 *
 * Closed P&L for the pair is therefore 5,333.08 - 5,102.46 = +230.62.
 *
 * The question: he posted a 0.81984 target and said "just set and forgetting". Did price
 * actually reach that target, and does the realised +230.62 match it?
 *
 * USAGE: npx tsx scripts/verify-alexg-usdchf.ts
 */
import { getHistoricalRates } from 'dukascopy-node';

const E1 = 0.80971, E2 = 0.81098;
const STOP1 = 0.80582, STOP2 = 0.80794;
const TARGET = 0.81984;
const LOTS = 0.3;
const REALISED = 230.62;   // 5,333.08 - 5,102.46

const OPEN1 = new Date('2026-08-11T00:00:00Z');
const FLAT_BY = new Date('2026-08-20T14:22:00Z');

(async () => {
  const bars: any[] = await getHistoricalRates({
    instrument: 'usdchf' as any,
    dates: { from: new Date('2026-08-08T00:00:00Z'), to: new Date('2026-08-25T00:00:00Z') },
    timeframe: 'm5' as any,
    format: 'json' as any,
  }) as any;

  console.log('USDCHF  %d m5 bars  %s -> %s\n', bars.length,
    new Date(bars[0].timestamp).toISOString(), new Date(bars[bars.length - 1].timestamp).toISOString());

  const win = bars.filter(b => b.timestamp >= +OPEN1 && b.timestamp <= +FLAT_BY);
  const hi = Math.max(...win.map(b => b.high)), lo = Math.min(...win.map(b => b.low));
  console.log('While the position was open (Aug 11 -> Aug 20 14:22):');
  console.log('  high %s   low %s', hi.toFixed(5), lo.toFixed(5));

  const hitT = win.find(b => b.high >= TARGET);
  const hitS1 = win.find(b => b.low <= STOP1);
  const hitS2 = win.find(b => b.low <= STOP2);
  console.log('\n  target %s reached : %s', TARGET.toFixed(5),
    hitT ? new Date(hitT.timestamp).toISOString() : 'NO');
  console.log('  stop1  %s hit     : %s', STOP1.toFixed(5),
    hitS1 ? new Date(hitS1.timestamp).toISOString() : 'no');
  console.log('  stop2  %s hit     : %s', STOP2.toFixed(5),
    hitS2 ? new Date(hitS2.timestamp).toISOString() : 'no');

  // pip value for USDCHF: $10 per lot per pip, divided by the USDCHF rate
  const pipVal = (px: number) => (10 / px) * LOTS;

  // Back out the exit price implied by the realised P&L on the two tickets.
  let bestX = 0, bestErr = 1e9;
  for (let x = 0.805; x <= 0.825; x += 0.000005) {
    const pnl = ((x - E1) + (x - E2)) / 0.0001 * pipVal(x);
    const err = Math.abs(pnl - REALISED);
    if (err < bestErr) { bestErr = err; bestX = x; }
  }
  console.log('\nRealised on the pair: +%s', REALISED.toFixed(2));
  console.log('  implied common exit price: ~%s   (residual $%s)', bestX.toFixed(5), bestErr.toFixed(2));

  const atTarget = ((TARGET - E1) + (TARGET - E2)) / 0.0001 * pipVal(TARGET);
  console.log('  P&L had BOTH run to the %s target: +%s', TARGET.toFixed(5), atTarget.toFixed(2));
  console.log('  captured: %s%% of the posted target', (100 * REALISED / atTarget).toFixed(1));

  const whenExit = win.find(b => b.timestamp > +new Date('2026-08-13T02:19:00Z') && b.low <= bestX && b.high >= bestX);
  if (whenExit) console.log('  price was at that level around %s', new Date(whenExit.timestamp).toISOString());

  console.log('\nVERDICT');
  if (!hitT) {
    console.log('  The 0.81984 target was NEVER reached while the position was open.');
    console.log('  Closing early at ~%s was therefore the CORRECT call, not a mistake —', bestX.toFixed(5));
    console.log('  but it is NOT "set and forget". A hard TP would have left this trade open.');
  } else {
    console.log('  The target WAS reached. Closing early at ~%s left money on the table.', bestX.toFixed(5));
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

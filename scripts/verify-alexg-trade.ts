/**
 * Verify Alex G's first challenge trade against real Dukascopy price data.
 *
 * From the channel's own closed-position screen (2026-07-29 15:37 post):
 *   GBPCHF.i sell 0.31   1.08800 -> 1.09064   -99.80   closed 2026.07.29 20:24:38
 *   account opened 2026.07.20 15:52:44 at 5,000.00; balance after 4,892.78
 *
 * Stop distance 26.4 pips. He states the setup was "the 1:2", so the target sits 52.8 pips
 * below entry at 1.08272.
 *
 * The question worth answering is NOT "did he lose" — we know he did. It is:
 * **after the stop was hit, did price go on to reach the target anyway?**
 * That measures the cost of the stop placement rather than the cost of the idea.
 *
 * USAGE: npx tsx scripts/verify-alexg-trade.ts
 */
import { getHistoricalRates } from 'dukascopy-node';

const ENTRY = 1.08800;
const STOP = 1.09060;   // red box upper edge on his Jul 29 chart; fill was 1.09064
const PIP = 0.0001;
const stopPips = (STOP - ENTRY) / PIP;
const TARGET = ENTRY - 2 * (STOP - ENTRY); // 1:2, his words

const OPEN_AT = new Date('2026-07-28T00:00:00Z');
const STOPPED_AT = new Date('2026-07-29T20:24:38Z');

(async () => {
  console.log('GBPCHF  SELL 0.31 @ %s', ENTRY.toFixed(5));
  console.log('  stop   %s  (%s pips)', STOP.toFixed(5), stopPips.toFixed(1));
  console.log('  target %s  (1:2 = %s pips)\n', TARGET.toFixed(5), (2 * stopPips).toFixed(1));

  const bars: any[] = await getHistoricalRates({
    instrument: 'gbpchf' as any,
    dates: { from: new Date('2026-07-25T00:00:00Z'), to: new Date('2026-08-08T00:00:00Z') },
    timeframe: 'm5' as any,
    format: 'json' as any,
  }) as any;

  console.log('downloaded %d m5 bars, %s -> %s\n',
    bars.length,
    new Date(bars[0].timestamp).toISOString(),
    new Date(bars[bars.length - 1].timestamp).toISOString());

  // 1. Did price actually trade at his entry around the stated open date?
  const nearOpen = bars.filter(b => Math.abs(b.timestamp - +OPEN_AT) < 36 * 3600e3);
  const lo = Math.min(...nearOpen.map(b => b.low)), hi = Math.max(...nearOpen.map(b => b.high));
  console.log('1. entry sanity — range within 36h of %s: %s .. %s',
    OPEN_AT.toISOString().slice(0, 10), lo.toFixed(5), hi.toFixed(5));
  console.log('   entry %s inside that range: %s\n',
    ENTRY.toFixed(5), (ENTRY >= lo && ENTRY <= hi) ? 'YES' : 'NO');

  // 2. When was the stop first touched?
  const firstStop = bars.find(b => b.timestamp >= +OPEN_AT && b.high >= STOP);
  console.log('2. stop first touched: %s  (he recorded 2026-07-29 20:24:38)',
    firstStop ? new Date(firstStop.timestamp).toISOString() : 'never');

  // 3. THE REAL QUESTION — did price reach the 1:2 target AFTER the stop?
  const after = bars.filter(b => b.timestamp > +STOPPED_AT);
  const hitTarget = after.find(b => b.low <= TARGET);
  const lowAfter = Math.min(...after.map(b => b.low));

  console.log('\n3. AFTER the stop was hit:');
  console.log('   lowest price reached: %s', lowAfter.toFixed(5));
  console.log('   1:2 target %s reached: %s', TARGET.toFixed(5), hitTarget ? 'YES' : 'no');
  if (hitTarget) {
    const hrs = (hitTarget.timestamp - +STOPPED_AT) / 3600e3;
    console.log('   reached at %s  = %s hours after being stopped out',
      new Date(hitTarget.timestamp).toISOString(), hrs.toFixed(1));
    console.log('\n   >>> The IDEA was right and the STOP was too tight.');
    console.log('   >>> He paid -2.0%% on a trade that would have made +4.0%%.');
  } else {
    console.log('\n   >>> The stop-out was correct: the target never came.');
  }

  // 4. How much wider would the stop have needed to be?
  const runUp = bars.filter(b => b.timestamp >= +OPEN_AT && b.timestamp <= +STOPPED_AT + 6 * 3600e3);
  const peak = Math.max(...runUp.map(b => b.high));
  console.log('\n4. peak against the position: %s = %s pips beyond entry',
    peak.toFixed(5), ((peak - ENTRY) / PIP).toFixed(1));
  console.log('   his stop sat at %s pips. Survivable stop would need %s pips.',
    stopPips.toFixed(1), ((peak - ENTRY) / PIP + 1).toFixed(1));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

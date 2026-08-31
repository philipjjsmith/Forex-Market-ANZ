/**
 * Trade 2 of the Alex G challenge run: bound it, since he never posted a screenshot of it.
 *
 * What IS known, hard:
 *   balance 4,892.78 immediately after trade 1 closed   2026-07-29 20:24
 *   balance 5,102.46 with ONLY the USDCHF ticket open   2026-08-11 11:44
 *   => a closed trade worth exactly +209.68 happened in that window, and nothing else did.
 *
 * What the channel says in that window (all GBPCHF):
 *   Aug 4  "still waiting for the break and retest of this minor AOI PATIENCE !!!!!"
 *   Aug 5  "PATIENCE !!!!"
 *   Aug 6  "waited all week for this to break this minor AOI and then on the retest
 *           I waited for my engulfing"   <- this reads as the entry
 *
 * So the hypothesis is: GBPCHF, entered ~Aug 6 on an engulfing at the retest, closed by Aug 11.
 * This script checks whether the price action can actually support a +209.68 result at his
 * known sizing, and in which direction.
 *
 * USAGE: npx tsx scripts/verify-alexg-trade2.ts
 */
import { getHistoricalRates } from 'dukascopy-node';

const PNL = 209.68;
const BAL_BEFORE = 4892.78;

(async () => {
  const bars: any[] = await getHistoricalRates({
    instrument: 'gbpchf' as any,
    dates: { from: new Date('2026-08-03T00:00:00Z'), to: new Date('2026-08-12T00:00:00Z') },
    timeframe: 'm5' as any,
    format: 'json' as any,
  }) as any;

  const win = bars.filter(b => b.timestamp >= +new Date('2026-08-06T00:00:00Z')
                            && b.timestamp <= +new Date('2026-08-11T12:00:00Z'));
  const hi = Math.max(...win.map(b => b.high)), lo = Math.min(...win.map(b => b.low));
  console.log('GBPCHF, Aug 6 -> Aug 11 12:00 (the only window trade 2 can occupy)');
  console.log('  bars %d   high %s   low %s   full range %s pips\n',
    win.length, hi.toFixed(5), lo.toFixed(5), ((hi - lo) / 0.0001).toFixed(1));

  // At his known sizing (0.31 lots, ~$12.4/pip/lot on a CHF quote) what move does +209.68 imply?
  for (const lots of [0.31, 0.3, 0.4, 0.5, 0.62]) {
    const perPip = lots * 12.4;
    console.log('  at %s lots ($%s/pip): +%s needs %s pips',
      lots.toFixed(2), perPip.toFixed(2), PNL.toFixed(2), (PNL / perPip).toFixed(1));
  }

  console.log('\n  risk at 2%% of %s = $%s', BAL_BEFORE.toFixed(2), (0.02 * BAL_BEFORE).toFixed(2));
  console.log('  so +%s = %sR', PNL.toFixed(2), (PNL / (0.02 * BAL_BEFORE)).toFixed(2));

  // Largest clean directional runs inside the window, both ways.
  let bestUp = { pips: 0, from: 0, to: 0 }, bestDown = { pips: 0, from: 0, to: 0 };
  for (let i = 0; i < win.length; i++) {
    for (let j = i + 1; j < win.length; j++) {
      const up = (win[j].high - win[i].low) / 0.0001;
      const dn = (win[i].high - win[j].low) / 0.0001;
      if (up > bestUp.pips) bestUp = { pips: up, from: win[i].timestamp, to: win[j].timestamp };
      if (dn > bestDown.pips) bestDown = { pips: dn, from: win[i].timestamp, to: win[j].timestamp };
    }
  }
  const f = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  console.log('\n  largest UP   run: %s pips  %s -> %s', bestUp.pips.toFixed(1), f(bestUp.from), f(bestUp.to));
  console.log('  largest DOWN run: %s pips  %s -> %s', bestDown.pips.toFixed(1), f(bestDown.from), f(bestDown.to));

  console.log('\nCONCLUSION');
  console.log('  The +209.68 is certain (it is a balance difference). The symbol, direction,');
  console.log('  entry and exit are NOT recoverable — he posted no screenshot of this trade.');
  console.log('  Recorded as an unverified fill, never as a verified trade.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

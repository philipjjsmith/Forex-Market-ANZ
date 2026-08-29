/**
 * Does the synthetic-weekend-bar defect actually change live trading decisions?
 *
 * Twelve Data returns a continuous 24/7 forex series. Verified 2026-08-29 against the live
 * production fetches: 28.5% of 1H bars, 28.6% of 4H bars and 29.0% of DAILY bars fall in hours
 * when forex is closed, and none of them are flat — Saturday 2026-08-22 carries 288 five-minute
 * bars spanning 11.5 pips, opening exactly at Friday's close. They are not traded prices.
 *
 * That matters because `dailyTrend` and `fourHourTrend` are HARD GATES in analyze(), and 1H ATR
 * sets the stop at 1.5x. Weekly (52 bars) is unaffected.
 *
 * This script does NOT argue about it. It replays real kill-zone moments through the real
 * analyze() twice — once on the series as production receives it, once with market-closed bars
 * removed — and counts how often the decision changes.
 *
 * The comparison holds ARRAY LENGTH constant at production's 52/200/360/1440. That is
 * deliberate: `ema()` seeds from the SMA of the first `period` elements and iterates the whole
 * array, so changing the count changes the indicator independently of the weekend question, and
 * would confound the very thing being measured.
 *
 * USAGE: npx tsx scripts/backtest/measure-weekend-impact.ts [--days=90]
 */
import 'dotenv/config';
import { MACrossoverStrategy } from '../../server/services/signal-generator';
import { twelveDataAPI } from '../../server/services/twelve-data';
import { sliceAsOf, sliceOneHourAsOf, lastN, PRODUCTION_SIZES, type Bar } from './candle-slicer';

const DAYS = Number(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] ?? 90);
const SYMBOLS = ['EUR/USD', 'USD/CHF'];

/** Forex week: opens Sun ~21:00 UTC, closes Fri ~21:00 UTC. */
const marketClosed = (d: Date) => {
  const dow = d.getUTCDay(), h = d.getUTCHours();
  return dow === 6 || (dow === 0 && h < 21) || (dow === 5 && h >= 21);
};
const clean = (b: Bar[]) => b.filter(x => !marketClosed(new Date(x.timestamp)));
const inKillZone = (d: Date) => { const h = d.getUTCHours(); return (h >= 7 && h < 10) || (h >= 12 && h < 15); };

(async () => {
  const strat = new MACrossoverStrategy();
  let n = 0, dailyFlip = 0, fourHFlip = 0, oneHFlip = 0, firedDiff = 0, confDiff = 0;
  const confDeltas: number[] = [];
  const examples: string[] = [];

  for (const sym of SYMBOLS) {
    const [wk, dy, h4, h1] = await Promise.all([
      twelveDataAPI.fetchHistoricalCandles(sym, '1week', 300),
      twelveDataAPI.fetchHistoricalCandles(sym, '1day', 800),
      twelveDataAPI.fetchHistoricalCandles(sym, '4h', 2000),
      twelveDataAPI.fetchHistoricalCandles(sym, '1h', 5000),
    ]) as unknown as Bar[][];

    // Weekly is provably clean (0/52), so it is passed through identically on both arms —
    // any difference below is attributable to daily / 4H / 1H alone.
    const cl = { wk, dy: clean(dy), h4: clean(h4), h1: clean(h1) };

    const end = new Date(h1[h1.length - 1].timestamp);
    const start = new Date(+end - DAYS * 86400_000);

    for (const bar of h1) {
      const t = new Date(bar.timestamp);
      if (+t < +start || +t > +end) continue;
      const dow = t.getUTCDay();
      if (dow === 0 || dow === 6) continue;
      if (!inKillZone(t)) continue;

      const asIs: any = await strat.analyze(
        lastN(sliceAsOf(wk, h1, t, '1week'), PRODUCTION_SIZES.weekly),
        lastN(sliceAsOf(dy, h1, t, '1day'), PRODUCTION_SIZES.daily),
        lastN(sliceAsOf(h4, h1, t, '4h'), PRODUCTION_SIZES.fourHour),
        lastN(sliceOneHourAsOf(h1, t, { includeForming: false }), PRODUCTION_SIZES.oneHour),
        sym, { asOf: t, approvedParams: null });

      const fixed: any = await strat.analyze(
        lastN(sliceAsOf(cl.wk, cl.h1, t, '1week'), PRODUCTION_SIZES.weekly),
        lastN(sliceAsOf(cl.dy, cl.h1, t, '1day'), PRODUCTION_SIZES.daily),
        lastN(sliceAsOf(cl.h4, cl.h1, t, '4h'), PRODUCTION_SIZES.fourHour),
        lastN(sliceOneHourAsOf(cl.h1, t, { includeForming: false }), PRODUCTION_SIZES.oneHour),
        sym, { asOf: t, approvedParams: null });

      n++;
      const a = asIs?.indicators?.htfTrend as string | undefined;
      const f = fixed?.indicators?.htfTrend as string | undefined;
      if (a && f && a !== f) {
        const pa = a.split(' '), pf = f.split(' ');
        if (pa[1] !== pf[1]) dailyFlip++;
        if (pa[2] !== pf[2]) fourHFlip++;
        if (pa[3] !== pf[3]) oneHFlip++;
      }
      if (!!asIs !== !!fixed) {
        firedDiff++;
        if (examples.length < 8) {
          examples.push(`  ${t.toISOString().slice(0, 16)} ${sym}  as-is ${asIs ? `FIRED conf=${asIs.confidence}` : 'no signal'}  ->  fixed ${fixed ? `FIRED conf=${fixed.confidence}` : 'no signal'}`);
        }
      } else if (asIs && fixed && asIs.confidence !== fixed.confidence) {
        confDiff++;
        confDeltas.push(fixed.confidence - asIs.confidence);
      }
    }
  }

  const pct = (x: number) => (n ? (100 * x / n).toFixed(1) + '%' : 'n/a');
  const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

  console.log(`\n${'='.repeat(66)}`);
  console.log(`WEEKEND-BAR IMPACT — ${n} real kill-zone moments, last ${DAYS} days, ${SYMBOLS.join(' + ')}`);
  console.log('='.repeat(66));
  console.log(`\nHTF trend direction changed (array length held constant):`);
  console.log(`  dailyTrend  flipped : ${dailyFlip}  ${pct(dailyFlip)}   <- HARD GATE`);
  console.log(`  fourHTrend  flipped : ${fourHFlip}  ${pct(fourHFlip)}   <- HARD GATE`);
  console.log(`  oneHTrend   flipped : ${oneHFlip}  ${pct(oneHFlip)}`);
  console.log(`\nDecision changed:`);
  console.log(`  fired vs did-not-fire differs : ${firedDiff}  ${pct(firedDiff)}`);
  console.log(`  same decision, confidence differs : ${confDiff}  (median ${med(confDeltas) >= 0 ? '+' : ''}${med(confDeltas)} pts)`);
  if (examples.length) { console.log(`\nexamples where the signal itself changed:`); examples.forEach(e => console.log(e)); }
  console.log('');
  process.exit(0);
})();

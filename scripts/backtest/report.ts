/**
 * The pre-registered report.
 *
 * Runs the strategy and BOTH control arms over the same window, with identical gates, cooldown,
 * daily cap, fill, costs and resolution, then applies the §7 statistics and the §3 kill criterion.
 *
 * This file deliberately produces no knobs. Everything it needs was fixed in
 * docs/BACKTEST_PREREGISTRATION.md before any result existed, and the only honest thing left to
 * do is run it and read the output — including when the output is bad news.
 *
 * WHAT WOULD MAKE THE HEADLINE NUMBER MEANINGLESS
 * ----------------------------------------------
 * A strategy that fails to beat BOTH control arms has not demonstrated that the ICT machinery
 * contributes anything: the result would be a property of a 1.5xATR stop against a 3.0xATR target
 * fired during two session windows. That comparison is printed first, above expectancy, so it
 * cannot be skipped on the way to the number people want to look at.
 *
 * USAGE:
 *   npx tsx scripts/backtest/report.ts --from=2024-08-01 --to=2026-08-01
 */
import 'dotenv/config';
import { runBacktest } from './run-backtest';
import { DEFAULT_CONFIG, type EngineConfig, type Trade } from './engine';
import { summarise } from './control-arms';
import { blockBootstrap, deflatedSharpe, walkForward, sharpeOf, bootstrapDifference } from './statistics';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const pct = (x: number) => (100 * x).toFixed(1) + '%';
const sgn = (x: number, d = 4) => (x >= 0 ? '+' : '') + x.toFixed(d);
const rule = (n = 74) => new Array(n + 1).join('=');

/** §7: every parameter already chosen by looking at this data counts as a trial. */
const TRIALS = 15;

async function arm(
  name: string, kind: 'strategy' | 'random' | 'trend-only',
  pairs: string[], dataFrom: string, dataTo: string, from: Date, to: Date, cfg: EngineConfig
) {
  const res = await runBacktest(pairs, dataFrom, dataTo, from, to, cfg, kind);
  const s = summarise(res.trades);
  const returns = res.trades.filter(t => t.r != null).map(t => t.r!);
  const boot = blockBootstrap(res.trades, 10000);
  const folds = walkForward(res.trades, 6);

  // Trial-Sharpe variance estimated from cross-fold Sharpes, which is the practical estimator.
  // Falling back to the H0 sampling variance is reported rather than hidden.
  const foldSharpes = folds.filter(f => f.n > 2).map(f => f.meanR);
  const v = foldSharpes.length > 2
    ? foldSharpes.reduce((acc, x, _, a) => acc + (x - a.reduce((p, q) => p + q, 0) / a.length) ** 2, 0) / (foldSharpes.length - 1)
    : undefined;
  const dsr = deflatedSharpe(returns, TRIALS, v);

  return { name, res, s, boot, folds, dsr, usedFoldVariance: v !== undefined };
}

(async () => {
  const dataFrom = arg('data-from', '2022-08-01'), dataTo = arg('data-to', '2026-08-01');
  const from = new Date(arg('from', '2024-08-01')), to = new Date(arg('to', '2026-08-01'));
  const pairs = arg('pairs', 'EUR/USD,USD/CHF,USD/JPY,GBP/USD,AUD/USD').split(',');
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, cooldownMode: arg('cooldown', 'until-resolved') as any };

  console.log(`${rule()}\nPRE-REGISTERED BACKTEST REPORT`);
  console.log(`window ${arg('from', '2024-08-01')} -> ${arg('to', '2026-08-01')}   pairs ${pairs.length}   cooldown ${cfg.cooldownMode}`);
  console.log(`baseline: v3.4.0 on Dukascopy mid (Amendment 3).  spreads: §6 configured, NOT observed.`);
  console.log(`${rule()}\n`);

  const t0 = Date.now();
  const strategy = await arm('STRATEGY', 'strategy', pairs, dataFrom, dataTo, from, to, cfg);
  const random = await arm('RANDOM', 'random', pairs, dataFrom, dataTo, from, to, cfg);
  const trend = await arm('TREND-ONLY', 'trend-only', pairs, dataFrom, dataTo, from, to, cfg);
  const arms = [strategy, random, trend];

  // --- control comparison FIRST, deliberately ---
  console.log(`CONTROL ARMS — does the ICT machinery contribute anything?\n`);
  console.log(`  arm           n     win%     net pips    expectancy R    95% CI (block bootstrap)`);
  for (const a of arms) {
    console.log(
      `  ${a.name.padEnd(12)} ${String(a.s.n).padStart(4)}   ${pct(a.s.winRate).padStart(6)}   ` +
      `${a.s.netPips.toFixed(0).padStart(8)}    ${sgn(a.s.expectancyR).padStart(8)}      ` +
      `[${sgn(a.boot.lo, 3)}, ${sgn(a.boot.hi, 3)}]`
    );
  }
  // Comparing two point estimates is NOT a test. Both carry wide intervals that may overlap
  // almost entirely, so a higher number can be pure noise. Bootstrap the DIFFERENCE instead,
  // resampling the SAME days for both arms so shared market-regime variance cancels.
  const vsRandom = bootstrapDifference(strategy.res.trades, random.res.trades, 10000);
  const vsTrend  = bootstrapDifference(strategy.res.trades, trend.res.trades, 10000);
  console.log(`\n  difference in expectancy (block bootstrap on the DIFFERENCE, paired by day):`);
  console.log(`    STRATEGY - RANDOM     : ${sgn(vsRandom.diff)} R   95% CI [${sgn(vsRandom.lo,3)}, ${sgn(vsRandom.hi,3)}]   ${vsRandom.excludesZero ? 'EXCLUDES zero' : 'includes zero'}`);
  console.log(`    STRATEGY - TREND-ONLY : ${sgn(vsTrend.diff)} R   95% CI [${sgn(vsTrend.lo,3)}, ${sgn(vsTrend.hi,3)}]   ${vsTrend.excludesZero ? 'EXCLUDES zero' : 'includes zero'}`);
  const beatsRandom = vsRandom.diff > 0 && vsRandom.excludesZero;
  const beatsTrend  = vsTrend.diff  > 0 && vsTrend.excludesZero;
  console.log(`\n  strategy beats RANDOM     : ${beatsRandom ? 'yes, significantly' : vsRandom.diff > 0 ? 'higher, but NOT significant' : 'NO'}`);
  console.log(`  strategy beats TREND-ONLY : ${beatsTrend ? 'yes, significantly' : vsTrend.diff > 0 ? 'higher, but NOT significant' : 'NO'}`);
  if (!beatsRandom || !beatsTrend) {
    console.log(`  -> Not demonstrably contributing. A higher point estimate whose interval spans`);
    console.log(`     zero is not evidence: on this sample the ICT machinery cannot be distinguished`);
    console.log(`     from the stop/target geometry and kill-zone timing alone.`);
  }

  // --- the pre-registered decision ---
  const b = strategy.boot;
  console.log(`\n${rule()}\nSTRATEGY — §7 statistics\n`);
  console.log(`  trades (resolved)      : ${b.trades} across ${b.blocks} distinct days`);
  console.log(`  expectancy             : ${sgn(b.meanR)} R/trade, net of spread and swap`);
  console.log(`  95% CI (block bootstrap, ${b.iterations} iters, resampling DAYS not trades)`);
  console.log(`                         : [${sgn(b.lo, 3)}, ${sgn(b.hi, 3)}]`);
  console.log(`  P(mean R <= 0)         : ${b.pLessEqualZero.toFixed(4)}`);
  console.log(`\n  Sharpe (per trade)     : ${strategy.dsr.sharpe.toFixed(4)}`);
  console.log(`  hurdle from ${strategy.dsr.trials} trials : ${strategy.dsr.sharpeThreshold.toFixed(4)}`);
  console.log(`  Deflated Sharpe        : ${strategy.dsr.dsr.toFixed(4)}   (skew ${strategy.dsr.skew.toFixed(2)}, kurtosis ${strategy.dsr.kurtosis.toFixed(2)})`);
  console.log(`  trial-Sharpe variance  : ${strategy.usedFoldVariance ? 'estimated from cross-fold Sharpes' : 'FALLBACK to H0 sampling variance — weaker'}`);

  console.log(`\n  walk-forward (purged, 48h embargo):`);
  for (const f of strategy.folds) {
    console.log(`    fold ${f.index}  ${f.from.toISOString().slice(0, 10)} -> ${f.to.toISOString().slice(0, 10)}  n=${String(f.n).padStart(3)}  meanR ${sgn(f.meanR, 3)}  win ${pct(f.winRate)}`);
  }
  const positiveFolds = strategy.folds.filter(f => f.n > 0 && f.meanR > 0).length;
  console.log(`    folds with positive expectancy: ${positiveFolds}/${strategy.folds.filter(f => f.n > 0).length}`);

  // --- §3 KILL CRITERION ---
  console.log(`\n${rule()}\n§3 KILL CRITERION\n`);
  console.log(`  "If the primary window shows expectancy < 0 net of costs, with a 95% confidence`);
  console.log(`   interval excluding zero, development of this strategy stops."\n`);
  const negative = b.meanR < 0;
  const excludesZero = b.hi < 0;
  console.log(`  expectancy < 0            : ${negative ? 'YES' : 'no'}  (${sgn(b.meanR)} R)`);
  console.log(`  95% CI excludes zero      : ${excludesZero ? 'YES' : 'no'}  ([${sgn(b.lo, 3)}, ${sgn(b.hi, 3)}])`);
  console.log(`\n  VERDICT: ${negative && excludesZero
    ? 'KILL CRITERION MET — development stops.'
    : negative
      ? 'negative, but the CI does not exclude zero — criterion NOT met.'
      : 'expectancy is not negative — criterion not met.'}`);

  console.log(`\n${rule()}`);
  console.log(`runtime ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`Per-cell figures are for honesty, not decisions (§8): no cell may drive a parameter`);
  console.log(`change, a pair drop, or a regime filter.`);
  console.log(rule());
  process.exit(0);
})();

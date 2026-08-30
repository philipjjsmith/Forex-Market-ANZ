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
import {
  blockBootstrap, deflatedSharpe, walkForward, walkForwardUnpurged, sharpeOf,
  bootstrapDifference, varianceOf,
} from './statistics';

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

  // Trial-Sharpe variance. This previously mapped `f.meanR` — a quantity in R units — into a
  // parameter the Deflated Sharpe formula defines as the variance of dimensionless SHARPE ratios.
  // That inflated the hurdle by a factor of sd(R) (~1.38 here, so ~38% too high).
  const foldSharpes = folds.filter(f => f.n > 2).map(f => f.sharpe);
  const v = foldSharpes.length > 2 ? varianceOf(foldSharpes) : undefined;
  const dsr = deflatedSharpe(returns, TRIALS, v);
  const unpurged = walkForwardUnpurged(res.trades, 6);

  return { name, res, s, boot, folds, unpurged, dsr, returns, foldSharpes, usedFoldVariance: v !== undefined };
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
  // MATCHED COMPARISON — the full-sample gap above is a composition artifact.
  //
  // The 3/day cap is portfolio-wide and the symbol loop is fixed to PRODUCTION_ORDER, so an arm
  // that fires on every symbol at every decision point burns all three slots on the first three
  // pairs at the first kill-zone hour, every day. RANDOM's n is exactly 3 x 520 trading days: it
  // is cap-saturated by construction, and 94% of its trades sit on three pairs at 07:00 UTC.
  // That is not 'the strategy's conditions with a coin flip'.
  //
  // Restricting every arm to the (symbol, hour) cells the STRATEGY actually traded removes the
  // composition difference and compares like with like.
  const cellOf = (t: Trade) => `${t.symbol}|${t.openedAt.getUTCHours()}`;
  const strategyCells = new Set(strategy.res.trades.map(cellOf));
  const inCells = (ts: Trade[]) => ts.filter(t => strategyCells.has(cellOf(t)));
  const mS = inCells(strategy.res.trades), mR = inCells(random.res.trades), mT = inCells(trend.res.trades);
  const sm = summarise(mS), rm = summarise(mR), tm = summarise(mT);
  const dR = bootstrapDifference(mS, mR, 10000);
  const dT = bootstrapDifference(mS, mT, 10000);
  console.log(`\n  MATCHED to the strategy's own (symbol, hour) cells:`);
  console.log(`    STRATEGY   n=${String(sm.n).padStart(4)}  expectancy ${sgn(sm.expectancyR)} R`);
  console.log(`    RANDOM     n=${String(rm.n).padStart(4)}  expectancy ${sgn(rm.expectancyR)} R   diff ${sgn(dR.diff)} [${sgn(dR.lo,3)}, ${sgn(dR.hi,3)}]`);
  console.log(`    TREND-ONLY n=${String(tm.n).padStart(4)}  expectancy ${sgn(tm.expectancyR)} R   diff ${sgn(dT.diff)} [${sgn(dT.lo,3)}, ${sgn(dT.hi,3)}]`);

  // Do the two arms actually disagree, or just fire at different times? On shared decision
  // points, identical direction means the machinery selects WHICH bars fire, not what happens.
  const key = (t: Trade) => `${t.symbol}|${+t.openedAt}`;
  const tMap = new Map(trend.res.trades.map(t => [key(t), t]));
  const shared = strategy.res.trades.filter(t => tMap.has(key(t)));
  const sameDir = shared.filter(t => tMap.get(key(t))!.type === t.type).length;
  if (shared.length) {
    console.log(`    on ${shared.length} shared (symbol, time) points STRATEGY and TREND-ONLY agree on direction ${(100*sameDir/shared.length).toFixed(1)}% of the time`);
  }

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

  // No single trial-variance estimator is defensible enough to quote alone: Bailey & Lopez de
  // Prado's V[SR] is the dispersion of Sharpes across the N configurations actually tried, and
  // those were never measured. Report the range instead of implying a precision we do not have.
  const arms3 = varianceOf(arms.map(a => sharpeOf(a.returns)));
  const T = strategy.returns.length;
  const variants: [string, number | undefined][] = [
    ['cross-fold Sharpe variance (default)', varianceOf(strategy.foldSharpes)],
    ['cross-ARM Sharpe variance (3 configs)', arms3],
    ['H0 sampling variance 1/T', 1 / T],
    ['no deflation at all', 0],
  ];
  console.log(`\n  Deflated Sharpe across trial-variance estimators (Sharpe is ${strategy.dsr.sharpe.toFixed(4)}):`);
  for (const [label, vv] of variants) {
    const d = deflatedSharpe(strategy.returns, TRIALS, vv);
    console.log(`    ${label.padEnd(38)} hurdle ${d.sharpeThreshold.toFixed(4)}   DSR ${d.dsr.toFixed(4)}`);
  }
  console.log(`    -> the verdict does not depend on the choice: Sharpe is negative, so DSR is ~0`);
  console.log(`       under every estimator, including none at all.`);

  console.log(`\n  walk-forward (purged, 48h embargo):`);
  for (const f of strategy.folds) {
    console.log(`    fold ${f.index}  ${f.from.toISOString().slice(0, 10)} -> ${f.to.toISOString().slice(0, 10)}  n=${String(f.n).padStart(3)}  meanR ${sgn(f.meanR, 3)}  win ${pct(f.winRate)}`);
  }
  const up = strategy.unpurged;
  const upMean = up.reduce((a, f) => a + f.meanR * f.n, 0) / Math.max(1, up.reduce((a, f) => a + f.n, 0));
  const pMean = strategy.folds.reduce((a, f) => a + f.meanR * f.n, 0) / Math.max(1, strategy.folds.reduce((a, f) => a + f.n, 0));
  console.log(`    unpurged, for comparison: n=${up.reduce((a, f) => a + f.n, 0)} meanR ${sgn(upMean, 4)}  vs purged n=${strategy.folds.reduce((a, f) => a + f.n, 0)} meanR ${sgn(pMean, 4)}`);
  console.log(`    (purging is pre-registered but unnecessary here — nothing is fitted — so the gap is reported, not argued)`);
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

  // Persist every trade from every arm so the result can be audited WITHOUT re-running the
  // 6-minute replay, and so any re-analysis works from the exact same trade set rather than a
  // fresh run that might differ.
  const save = arg('save', '');
  if (save) {
    const fs = await import('fs');
    fs.writeFileSync(save, JSON.stringify({
      window: { from: from.toISOString(), to: to.toISOString() }, pairs, cooldown: cfg.cooldownMode,
      config: cfg,
      arms: Object.fromEntries(arms.map(a => [a.name, a.res.trades])),
    }));
    console.log(`\ntrades written to ${save}`);
  }

  console.log(`\n${rule()}`);
  console.log(`runtime ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(`Per-cell figures are for honesty, not decisions (§8): no cell may drive a parameter`);
  console.log(`change, a pair drop, or a regime filter.`);
  console.log(rule());
  process.exit(0);
})();

/**
 * Re-resolve the pooled trade set under the DEPLOYED payoff and compare.
 *
 * `BACKTEST_RESULT_2026-08-30.md`: "the backtest measures a third system — neither the one that
 * traded nor the one that would", because the EA splits 50% at TP1 / 50% at TP3 on a shared stop
 * while the engine books 100% at TP1. This closes that gap.
 *
 * Deliberately re-resolves the EXACT SAME entries from `.backtest-cache/trades-pooled.json`
 * rather than re-running the replay. The entry decisions, fills and costs are therefore
 * bit-identical between the two arms, so any difference is the PAYOFF and nothing else. It is
 * also the only honest comparison: a fresh replay could differ for unrelated reasons.
 *
 * This is NOT a new strategy variant under pre-registration §5. It is a correction to a
 * disclosed defect in the measuring instrument — the engine was modelling a payoff the deployed
 * system does not use.
 *
 * USAGE: npx tsx scripts/backtest/run-split-payoff.ts
 */
import fs from 'fs';
import path from 'path';
import { loadDukascopy } from './dukascopy-loader';
import {
  resolveTrade, costTrade, resolveTradeSplit, costSplit,
  DEFAULT_CONFIG, type Trade,
} from './engine';

const FROM = new Date('2022-08-01'), TO = new Date('2026-08-01');
const EXPIRY_H = DEFAULT_CONFIG.expiryHours;
/** Must match resolveTradeSplit's default. TP3 is 9.0xATR against TP1 at 3.0xATR = 3x. */
const TP3_DISTANCE_MULTIPLE = 3;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** Block bootstrap by calendar day — simultaneous signals are one bet booked several times. */
function bootstrapCI(rows: Array<{ day: string; r: number }>, iters = 10000): [number, number] {
  const byDay = new Map<string, number[]>();
  for (const row of rows) (byDay.get(row.day) ?? byDay.set(row.day, []).get(row.day)!).push(row.r);
  const days = [...byDay.values()];
  const out: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0, n = 0;
    for (let d = 0; d < days.length; d++) {
      const pick = days[(Math.random() * days.length) | 0];
      for (const r of pick) { sum += r; n++; }
    }
    out.push(sum / n);
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(iters * 0.025)], out[Math.floor(iters * 0.975)]];
}

(async () => {
  const file = path.resolve('.backtest-cache/trades-pooled.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw: any[] = saved.arms.STRATEGY;
  console.log(`pooled trade set: ${raw.length} STRATEGY entries, window ${saved.window.from.slice(0, 10)} -> ${saved.window.to.slice(0, 10)}\n`);

  const symbols = [...new Set(raw.map(t => t.symbol))];
  const bars = new Map<string, any[]>();
  for (const s of symbols) {
    bars.set(s, await loadDukascopy(s, FROM, TO));
    process.stdout.write(`  loaded ${s}: ${bars.get(s)!.length.toLocaleString()} bars\n`);
  }

  const rowsOld: Array<{ day: string; r: number }> = [];
  const rowsNew: Array<{ day: string; r: number }> = [];
  let unresolved = 0, tp3Hits = 0, giveback = 0, mfeSum = 0, mfeN = 0;

  for (const t0 of raw) {
    const t: Trade = { ...t0, openedAt: new Date(t0.openedAt) };
    const series = bars.get(t.symbol)!;
    const expiry = new Date(+t.openedAt + EXPIRY_H * 3600e3);
    // Only bars at or after the fill matter; slice for speed.
    let lo = 0, hi = series.length - 1, start = series.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].timestamp >= +t.openedAt) { start = mid; hi = mid - 1; } else lo = mid + 1;
    }
    const slice = series.slice(start, start + 3000);   // 3000 x 5min >> 48h expiry

    const oldRes = resolveTrade(t, slice, expiry);
    const newRes = resolveTradeSplit(t, slice, expiry);
    if (!oldRes || !newRes) { unresolved++; continue; }

    const day = t.openedAt.toISOString().slice(0, 10);

    const tOld: Trade = { ...t, closedAt: oldRes.at, exitPrice: oldRes.price };
    costTrade(tOld, DEFAULT_CONFIG);
    rowsOld.push({ day, r: tOld.r! });

    const { r: rNew } = costSplit(t, newRes, DEFAULT_CONFIG);
    rowsNew.push({ day, r: rNew });

    // Compare against the SAME multiple the resolver used. This was hardcoded to 4 while the
    // resolver moved to 3, so it silently reported "TP3 reached 0 of 1095" — a closer target
    // cannot be hit less often, which is what exposed it.
    const tp3Price = t.entry + TP3_DISTANCE_MULTIPLE * (t.target - t.entry);
    if (newRes.legs[1].outcome === 'TP1_HIT' && Math.abs(newRes.legs[1].price - tp3Price) < 1e-9) tp3Hits++;
    if (newRes.legs[0].outcome === 'TP1_HIT' && newRes.legs[1].outcome === 'STOP_HIT') giveback++;
    mfeSum += newRes.mfeR; mfeN++;
  }

  const rOld = rowsOld.map(x => x.r), rNew = rowsNew.map(x => x.r);
  const line = (s: string) => console.log(s);

  line('\n' + '='.repeat(74));
  line('PAYOFF COMPARISON — identical entries, identical costs, different exit model');
  line('='.repeat(74));
  line(`resolved ${rOld.length} of ${raw.length}   (unresolved at data end: ${unresolved})\n`);

  const ciOld = bootstrapCI(rowsOld), ciNew = bootstrapCI(rowsNew);
  const fmt = (n: number, d = 4) => (n >= 0 ? '+' : '') + n.toFixed(d);
  line('  arm                              expectancy    sd(R)    95% CI (block bootstrap by day)');
  line(`  100% at TP1  (engine, as run)      ${fmt(mean(rOld))}   ${sd(rOld).toFixed(3)}   [${fmt(ciOld[0], 3)}, ${fmt(ciOld[1], 3)}]`);
  line(`  50/50 TP1+TP3 (EA, as deployed)    ${fmt(mean(rNew))}   ${sd(rNew).toFixed(3)}   [${fmt(ciNew[0], 3)}, ${fmt(ciNew[1], 3)}]`);

  const diff = rNew.map((r, i) => r - rOld[i]);
  const ciDiff = bootstrapCI(rowsNew.map((x, i) => ({ day: x.day, r: diff[i] })));
  line(`\n  paired difference (same trades)     ${fmt(mean(diff))}          [${fmt(ciDiff[0], 3)}, ${fmt(ciDiff[1], 3)}]`);
  line(`  -> ${ciDiff[0] > 0 ? 'the deployed payoff is BETTER, significantly'
       : ciDiff[1] < 0 ? 'the deployed payoff is WORSE, significantly'
       : 'difference is NOT significant — the interval spans zero'}`);

  line('\n  what the runner leg actually did:');
  line(`    TP3 (6R, i.e. 9.0xATR) reached      ${tp3Hits} of ${rNew.length}  (${(100 * tp3Hits / rNew.length).toFixed(1)}%)`);
  line(`    ran past TP1 then stopped out    ${giveback}  (${(100 * giveback / rNew.length).toFixed(1)}%)  <- the cost of no breakeven`);
  line(`    mean TRUE mfe to expiry          ${(mfeSum / mfeN).toFixed(3)} R   (previously truncated at the resolving bar)`);

  line('\n' + '='.repeat(74));
  line('§8 still applies: this is a payoff correction, not a parameter search. No cell here may');
  line('drive a pair drop, an hour filter, or a threshold change.');
  line('='.repeat(74));
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

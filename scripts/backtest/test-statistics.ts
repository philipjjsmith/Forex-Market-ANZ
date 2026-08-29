/**
 * Tests for the Phase E statistics.
 *
 * These guard the places where a statistics layer silently flatters a result: a normal CDF that
 * is subtly wrong, a bootstrap whose interval is too narrow because it resampled trades instead
 * of days, and a Deflated Sharpe whose hurdle does not actually rise with the trial count.
 *
 * USAGE: npx tsx scripts/backtest/test-statistics.ts
 */
import { normCdf, normInv, blockBootstrap, deflatedSharpe, walkForward } from './statistics';
import type { Trade } from './engine';

let failures = 0;
const near = (name: string, got: number, want: number, tol: number) => {
  if (!(Math.abs(got - want) <= tol)) { failures++; console.log(`  FAIL ${name}: ${got} vs ${want}`); }
};
const ok = (name: string, cond: boolean) => { if (!cond) { failures++; console.log(`  FAIL ${name}`); } };

near('normCdf(0)', normCdf(0), 0.5, 1e-6);
near('normCdf(1.96)', normCdf(1.96), 0.975, 1e-4);
near('normCdf(-1.96)', normCdf(-1.96), 0.025, 1e-4);
near('normCdf(2.576)', normCdf(2.576), 0.995, 1e-4);
near('normInv(0.975)', normInv(0.975), 1.959964, 1e-4);
near('normInv(0.01)', normInv(0.01), -2.326348, 1e-4);
near('normInv o normCdf roundtrip', normInv(normCdf(1.3)), 1.3, 1e-3);

const mk = (day: number, r: number): Trade => ({
  symbol: 'EUR/USD', type: 'LONG',
  openedAt: new Date(Date.UTC(2025, 0, 1 + day, 8)),
  closedAt: new Date(Date.UTC(2025, 0, 1 + day, 12)),
  entry: 1, stop: 0.99, target: 1.02, confidence: 100, tier: 'HIGH',
  outcome: r > 0 ? 'TP1_HIT' : 'STOP_HIT', r,
});

// clearly positive series -> CI must exclude zero
const pos: Trade[] = []; for (let d = 0; d < 200; d++) pos.push(mk(d, d % 2 === 0 ? 2 : -1));
const bp = blockBootstrap(pos, 4000);
near('bootstrap mean', bp.meanR, 0.5, 1e-9);
ok('positive series: CI excludes zero', bp.lo > 0 && bp.hi > 0);

// zero-mean series -> CI must straddle zero (a bootstrap that never straddles is broken)
const zero: Trade[] = []; for (let d = 0; d < 200; d++) zero.push(mk(d, d % 2 === 0 ? 1 : -1));
const bz = blockBootstrap(zero, 4000);
ok('zero-mean series: CI straddles zero', bz.lo < 0 && bz.hi > 0);

const strong = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 2 : -1));
const weak = Array.from({ length: 400 }, (_, i) => (i % 2 === 0 ? 1 : -1.05));
ok('DSR ranks the stronger series higher', deflatedSharpe(strong, 15).dsr > deflatedSharpe(weak, 15).dsr);
ok('more trials raises the Sharpe hurdle', deflatedSharpe(strong, 60).sharpeThreshold > deflatedSharpe(strong, 15).sharpeThreshold);

const wf = walkForward(pos, 4);
ok('walk-forward yields 4 non-empty folds', wf.length === 4 && wf.every(f => f.n > 0));
ok('embargo drops some trades after the first fold', wf[1].n < wf[0].n);

console.log(failures === 0 ? 'statistics: ALL PASS' : `statistics: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

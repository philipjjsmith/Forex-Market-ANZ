/* scratch red-team: cost decomposition + power. Delete after use. */
import fs from 'fs';

const d = JSON.parse(fs.readFileSync('.backtest-cache/trades-primary.json', 'utf8'));
const CFG = d.config;
const pipSize = (s: string) => (s.includes('JPY') ? 0.01 : 0.0001);
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

type T = any;
const strat: T[] = d.arms.STRATEGY.filter((t: T) => t.r != null);
for (const t of strat) { t.openedAt = new Date(t.openedAt); t.closedAt = new Date(t.closedAt); }

// ---------- 0. reproduce the published number ----------
console.log('=== 0. REPRODUCTION FROM SAVED TRADES ===');
console.log(`  n=${strat.length}  expectancy ${mean(strat.map(t => t.r)).toFixed(4)} R  (published -0.0832)`);
console.log(`  net pips ${strat.map(t => t.netPips).reduce((a, b) => a + b, 0).toFixed(0)}  (published -1499)`);
console.log(`  win% ${(100 * strat.filter(t => t.outcome === 'TP1_HIT').length / strat.length).toFixed(1)}  (published 29.7)`);
console.log(`  sd(R) ${sd(strat.map(t => t.r)).toFixed(4)}   Sharpe ${(mean(strat.map(t => t.r)) / sd(strat.map(t => t.r))).toFixed(4)} (published -0.0603)`);

// ---------- 1. is the entry half-spread actually neutralised? ----------
console.log('\n=== 1. HOW MUCH SPREAD IS ACTUALLY CHARGED? ===');
let exactRisk = 0, exactTgt = 0, other = 0;
for (const t of strat) {
  const pip = pipSize(t.symbol);
  const riskPips = Math.abs(t.entry - t.stop) / pip;
  const tgtPips = Math.abs(t.target - t.entry) / pip;
  if (t.outcome === 'STOP_HIT' && Math.abs(-t.grossPips - riskPips) < 1e-6) exactRisk++;
  else if (t.outcome === 'TP1_HIT' && Math.abs(t.grossPips - tgtPips) < 1e-6) exactTgt++;
  else other++;
}
console.log(`  STOP_HIT with |gross| EXACTLY = risk : ${exactRisk}`);
console.log(`  TP1_HIT  with  gross  EXACTLY = tgt  : ${exactTgt}`);
console.log(`  everything else (gaps / EXPIRED)     : ${other}`);
console.log('  -> where gross is exactly the re-anchored distance, the ENTRY half-spread cancels:');
console.log('     stop and target were both shifted by the same half-spread as the fill.');
console.log('     Effective round-trip spread charged = HALF the configured value, not one full spread.');

// ---------- 2. cost decomposition, current model ----------
console.log('\n=== 2. COST DECOMPOSITION UNDER THE SHIPPED MODEL ===');
let spreadR = 0, swapR = 0;
const perPair: Record<string, { n: number; spreadR: number; swapR: number; r: number; riskPips: number }> = {};
for (const t of strat) {
  const pip = pipSize(t.symbol);
  const riskPips = Math.abs(t.entry - t.stop) / pip;
  const half = (CFG.spreadPips[t.symbol] ?? 1.5) / 2;
  const swapPips = t.grossPips - t.netPips - half;      // residual is the swap actually charged
  spreadR += half / riskPips;
  swapR += swapPips / riskPips;
  const p = (perPair[t.symbol] ??= { n: 0, spreadR: 0, swapR: 0, r: 0, riskPips: 0 });
  p.n++; p.spreadR += half / riskPips; p.swapR += swapPips / riskPips; p.r += t.r; p.riskPips += riskPips;
}
const n = strat.length;
console.log(`  mean spread cost : ${(spreadR / n).toFixed(4)} R/trade`);
console.log(`  mean swap cost   : ${(swapR / n).toFixed(4)} R/trade`);
console.log(`  TOTAL cost       : ${((spreadR + swapR) / n).toFixed(4)} R/trade`);
console.log(`  expectancy NET   : ${mean(strat.map(t => t.r)).toFixed(4)} R`);
console.log(`  expectancy GROSS : ${(mean(strat.map(t => t.r)) + (spreadR + swapR) / n).toFixed(4)} R  <-- zero-cost bound`);

console.log('\n  per pair:');
console.log('    pair       n   meanRisk(pips)  spreadR   swapR   totalCost   meanR');
for (const [k, p] of Object.entries(perPair).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${k}  ${String(p.n).padStart(4)}   ${(p.riskPips / p.n).toFixed(1).padStart(9)}    ${(p.spreadR / p.n).toFixed(4)}  ${(p.swapR / p.n).toFixed(4)}   ${((p.spreadR + p.swapR) / p.n).toFixed(4)}   ${(p.r / p.n).toFixed(4)}`);
}

// ---------- 3. re-cost under alternative assumptions ----------
console.log('\n=== 3. RE-COST UNDER ALTERNATIVE SPREAD / SWAP ASSUMPTIONS ===');
console.log('    (holds each trade PATH fixed; only the accounting changes.');
console.log('     A different spread also shifts the fill by <1 pip, which can flip a');
console.log('     handful of marginal touches -- checked separately by full re-run.)');

function recost(spread: Record<string, number>, swapMult: number) {
  const rs = strat.map((t: T) => {
    const pip = pipSize(t.symbol);
    const riskPips = Math.abs(t.entry - t.stop) / pip;
    const halfOld = (CFG.spreadPips[t.symbol] ?? 1.5) / 2;
    const swapPips = t.grossPips - t.netPips - halfOld;
    const halfNew = (spread[t.symbol] ?? 1.5) / 2;
    return (t.grossPips - halfNew - swapPips * swapMult) / riskPips;
  });
  return { meanR: mean(rs), rs };
}

const S = CFG.spreadPips;
// measured Dukascopy: EUR/USD 0.30, USD/CHF 0.80 (Amendment 2 A2.3). Others NOT measured.
const measuredPartial = { ...S, 'EUR/USD': 0.30, 'USD/CHF': 0.80 };
// extrapolate the measured ratio to the unmeasured pairs (EURUSD 0.30x, USDCHF 0.53x -> ~0.42x)
const measuredAll = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, (v as number) * 0.42]));
const zero = Object.fromEntries(Object.keys(S).map(k => [k, 0]));

const scenarios: [string, Record<string, number>, number][] = [
  ['shipped (S6 configured, swap on)', S, 1],
  ['shipped spreads, ZERO swap', S, 0],
  ['measured Duka EUR/USD+USD/CHF only, swap on', measuredPartial, 1],
  ['measured Duka EUR/USD+USD/CHF only, ZERO swap', measuredPartial, 0],
  ['measured ratio extrapolated to all 5, swap on', measuredAll, 1],
  ['measured ratio extrapolated to all 5, ZERO swap', measuredAll, 0],
  ['ZERO spread, ZERO swap (upper bound)', zero, 0],
];
console.log('\n    scenario                                          expectancy R    delta vs shipped');
for (const [label, sp, sm] of scenarios) {
  const r = recost(sp, sm);
  console.log(`    ${label.padEnd(48)} ${(r.meanR >= 0 ? '+' : '') + r.meanR.toFixed(4)}        ${((r.meanR - mean(strat.map(t => t.r))) >= 0 ? '+' : '') + (r.meanR - mean(strat.map(t => t.r))).toFixed(4)}`);
}

// ---------- 4. block bootstrap + power ----------
console.log('\n=== 4. EFFECTIVE SAMPLE SIZE AND POWER ===');
function makeRng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function blockBoot(rs: { day: string; r: number }[], iters = 10000, seed = 20260829) {
  const m = new Map<string, number[]>();
  for (const x of rs) { if (!m.has(x.day)) m.set(x.day, []); m.get(x.day)!.push(x.r); }
  const blocks = [...m.values()];
  const rng = makeRng(seed);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let s = 0, k = 0;
    for (let b = 0; b < blocks.length; b++) { const blk = blocks[(rng() * blocks.length) | 0]; for (const r of blk) { s += r; k++; } }
    means.push(s / k);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.floor(q * (means.length - 1))];
  return { lo: at(0.025), hi: at(0.975), se: sd(means), blocks: blocks.length, p0: means.filter(x => x <= 0).length / means.length };
}

const withDay = strat.map((t: T) => ({ day: t.openedAt.toISOString().slice(0, 10), r: t.r }));
const bb = blockBoot(withDay);
const rsAll = strat.map((t: T) => t.r);
const seIid = sd(rsAll) / Math.sqrt(n);
console.log(`  n trades                 : ${n}`);
console.log(`  distinct days (blocks)   : ${bb.blocks}`);
console.log(`  sd(R)                    : ${sd(rsAll).toFixed(4)}`);
console.log(`  SE iid                   : ${seIid.toFixed(5)}`);
console.log(`  SE block bootstrap       : ${bb.se.toFixed(5)}`);
console.log(`  design effect (SEb/SEi)^2: ${((bb.se / seIid) ** 2).toFixed(3)}`);
console.log(`  EFFECTIVE sample size    : ${(n * (seIid / bb.se) ** 2).toFixed(0)} trades`);
console.log(`  95% CI                   : [${bb.lo.toFixed(3)}, ${bb.hi.toFixed(3)}]  (published [-0.204, +0.037])`);
console.log(`  P(mean R <= 0)           : ${bb.p0.toFixed(4)}  (published 0.9098)`);

const z80 = 1.959964 + 0.8416212;
console.log(`\n  MDE at 80% power, two-sided 5% : ${(z80 * bb.se).toFixed(4)} R   (= 2.80 x SE)`);
console.log(`  MDE one-sided 5%, 80% power    : ${((1.644854 + 0.8416212) * bb.se).toFixed(4)} R`);
const trueEdge = 0.05;
const pwr = (edge: number, se: number) => 1 - (0.5 * (1 + erf(((1.959964 * se - edge) / se) / Math.SQRT2)));
function erf(x: number) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
console.log(`\n  If TRUE edge were +0.05 R, power to detect it = ${(100 * pwr(trueEdge, bb.se)).toFixed(1)}%`);
console.log(`  If TRUE edge were +0.10 R, power              = ${(100 * pwr(0.10, bb.se)).toFixed(1)}%`);
console.log(`  If TRUE edge were +0.15 R, power              = ${(100 * pwr(0.15, bb.se)).toFixed(1)}%`);
const needDays = (edge: number) => Math.ceil(bb.blocks * (z80 * bb.se / edge) ** 2);
console.log(`\n  days needed for 80% power at +0.05 R : ${needDays(0.05)} (have ${bb.blocks})  ~= ${(needDays(0.05) / bb.blocks * n / 1).toFixed(0)} trades`);
console.log(`  days needed for 80% power at +0.10 R : ${needDays(0.10)} (have ${bb.blocks})  ~= ${(needDays(0.10) / bb.blocks * n).toFixed(0)} trades`);

// ---------- 5. can we REJECT a useful positive edge? ----------
console.log('\n=== 5. WHAT DOES THE CI ACTUALLY EXCLUDE? ===');
console.log(`  CI upper bound is +${bb.hi.toFixed(3)} R.`);
console.log(`  So the data are consistent with a true edge as large as +${bb.hi.toFixed(3)} R/trade,`);
console.log(`  which at ${(n / 24).toFixed(0)} trades/month is +${(bb.hi * n / 24).toFixed(2)} R/month. That is a TRADEABLE edge.`);
console.log(`  "No demonstrable edge" is therefore compatible with "a good edge that this test cannot see".`);

// ---------- 6. distribution of R, and what drives it ----------
console.log('\n=== 6. OUTCOME MIX ===');
for (const oc of ['TP1_HIT', 'STOP_HIT', 'EXPIRED']) {
  const g = strat.filter((t: T) => t.outcome === oc);
  if (!g.length) continue;
  const hrs = g.map((t: T) => (+t.closedAt - +t.openedAt) / 3600000);
  console.log(`  ${oc.padEnd(9)} n=${String(g.length).padStart(3)} (${(100 * g.length / n).toFixed(1)}%)  meanR ${mean(g.map((t: T) => t.r)).toFixed(3)}  meanHold ${mean(hrs).toFixed(1)}h`);
}
const risk = strat.map((t: T) => Math.abs(t.entry - t.stop) / pipSize(t.symbol));
risk.sort((a, b) => a - b);
console.log(`  risk pips: median ${risk[risk.length >> 1].toFixed(1)}  p10 ${risk[Math.floor(0.1 * risk.length)].toFixed(1)}  p90 ${risk[Math.floor(0.9 * risk.length)].toFixed(1)}`);
const rr = strat.map((t: T) => Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop));
console.log(`  realised R:R (target/stop distance): mean ${mean(rr).toFixed(3)}  min ${Math.min(...rr).toFixed(3)}  max ${Math.max(...rr).toFixed(3)}`);

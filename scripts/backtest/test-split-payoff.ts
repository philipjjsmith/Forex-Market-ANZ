/**
 * Assertions for resolveTradeSplit / costSplit — the DEPLOYED 50%-at-TP1 / 50%-at-TP3 payoff.
 *
 * The failure modes this guards against, all of which would quietly flatter the result:
 *   - resolving the TP3 leg at TP1 (i.e. not actually walking past the first target)
 *   - forgetting that the stop is SHARED, so a TP3 leg that ran past TP1 can still come back
 *     and lose a full R — there is no breakeven in the EA
 *   - truncating mfeR at the resolving bar, which is the exact defect that made the TP3 leg
 *     unreconstructable in the first place
 *   - deriving TP3 from R instead of from the TP1 DISTANCE
 *
 * USAGE: npx tsx scripts/backtest/test-split-payoff.ts   (exits non-zero on failure)
 */
import { resolveTradeSplit, costSplit, DEFAULT_CONFIG, type Trade } from './engine';
import type { Ohlc } from './aggregate';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
};
const near = (name: string, a: number, b: number, tol = 1e-6) =>
  check(name, Math.abs(a - b) <= tol, `got ${a}, want ${b}`);

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const bar = (i: number, o: number, h: number, l: number, c: number): Ohlc =>
  ({ timestamp: new Date(T0 + i * 300_000), open: o, high: h, low: l, close: c } as any);

/** LONG: entry 1.10000, stop 1.09800 (20 pips = 1R), TP1 1.10400 (2R), so TP3 = 1.11200 (6R). */
const long = (): Trade => ({
  symbol: 'EUR/USD', type: 'LONG', openedAt: new Date(T0),
  entry: 1.10000, stop: 1.09800, target: 1.10400, confidence: 100, tier: 'HIGH',
});
const EXPIRY = new Date(T0 + 48 * 3600e3);

console.log('\n1. TP3 is derived from the TP1 DISTANCE (x4), not from R');
{
  // Deliberately break TP1==2R: widen the stop only, as MIN_SL_PIPS does.
  const t = long(); t.stop = 1.09700;           // now 30 pips risk, TP1 is only 1.33R
  const bars = [bar(0, 1.10000, 1.11300, 1.09999, 1.11250)];  // reaches 1.11200
  const r = resolveTradeSplit(t, bars, EXPIRY)!;
  near('TP3 leg fills at 1.11200 (= entry + 3 x 400 pips-of-distance)', r.legs[1].price, 1.11200);
  check('TP3 was NOT taken as 6 x the widened R', r.legs[1].price !== 1.10000 + 6 * 0.00300);
}

console.log('\n2. straight to TP3 — both legs win');
{
  const bars = [bar(0, 1.10000, 1.11300, 1.09999, 1.11250)];
  const r = resolveTradeSplit(long(), bars, EXPIRY)!;
  near('leg A at TP1', r.legs[0].price, 1.10400);
  near('leg B at TP3', r.legs[1].price, 1.11200);
  const { legR, r: combined } = costSplit(long(), r, DEFAULT_CONFIG);
  // EUR/USD spread 1.0 pip -> 0.5 pip on exit, over a 20-pip risk = exactly 0.025R per leg.
  // Same bar, so zero nights of swap.
  near('leg A = 2R - 0.025R', legR[0], 1.975, 1e-9);
  near('leg B = 6R - 0.025R', legR[1], 5.975, 1e-9);
  near('combined = half of each', combined, 0.5 * 1.975 + 0.5 * 5.975, 1e-9);
  check('cost WAS deducted (not a clean 2 and 6)', legR[0] < 2 && legR[1] < 6);
}

console.log('\n3. THE CRITICAL CASE: TP1 hit, then the SHARED stop takes the runner back');
{
  const bars = [
    bar(0, 1.10000, 1.10450, 1.09999, 1.10400),   // TP1 touched
    bar(1, 1.10400, 1.10410, 1.09700, 1.09750),   // reverses through the stop
  ];
  const t = long();
  const r = resolveTradeSplit(t, bars, EXPIRY)!;
  check('leg A booked the win', r.legs[0].outcome === 'TP1_HIT');
  check('leg B was STOPPED, not left open or booked at TP1',
    r.legs[1].outcome === 'STOP_HIT', r.legs[1].outcome);
  near('leg B exits at the stop', r.legs[1].price, 1.09800);
  const { r: combined } = costSplit(t, r, DEFAULT_CONFIG);
  check('combined R is ~+0.5R (half at +2R, half at -1R), NOT +2R',
    combined > 0.2 && combined < 0.6, combined.toFixed(3));
}

console.log('\n4. straight to the stop — both legs lose one R');
{
  const bars = [bar(0, 1.10000, 1.10010, 1.09700, 1.09750)];
  const t = long();
  const r = resolveTradeSplit(t, bars, EXPIRY)!;
  check('both legs stopped', r.legs.every(l => l.outcome === 'STOP_HIT'));
  const { r: combined } = costSplit(t, r, DEFAULT_CONFIG);
  check('combined R is about -1', combined < -0.9 && combined > -1.2, combined.toFixed(3));
}

console.log('\n5. mfeR is measured to EXPIRY and is NOT truncated at TP1');
{
  const bars = [
    bar(0, 1.10000, 1.10450, 1.09999, 1.10400),   // TP1
    bar(1, 1.10400, 1.11000, 1.10300, 1.10900),   // runs on to 5R, still short of TP3
    bar(2, 1.10900, 1.10950, 1.09700, 1.09750),   // then stops out
  ];
  const r = resolveTradeSplit(long(), bars, EXPIRY)!;
  near('mfe captured the post-TP1 run (1.11000 = 5R)', Math.round(r.mfeR * 100) / 100, 5);
  check('mfe is NOT clipped at the 2R of the TP1 bar', r.mfeR > 2.5, r.mfeR.toFixed(2));
}

console.log('\n6. expiry closes any leg still open, at the bar close');
{
  const bars = [
    bar(0, 1.10000, 1.10450, 1.09999, 1.10400),
    { ...bar(1, 1.10500, 1.10550, 1.10450, 1.10500), timestamp: EXPIRY } as any,
  ];
  const r = resolveTradeSplit(long(), bars, EXPIRY)!;
  check('leg A had already taken TP1', r.legs[0].outcome === 'TP1_HIT');
  check('leg B expired', r.legs[1].outcome === 'EXPIRED');
  near('leg B exits at the close', r.legs[1].price, 1.10500);
}

console.log('\n7. still open at the end of the data returns null, never a loss');
{
  const bars = [bar(0, 1.10000, 1.10050, 1.09950, 1.10000)];
  check('returns null', resolveTradeSplit(long(), bars, EXPIRY) === null);
}

console.log('\n8. SHORT is the mirror image');
{
  const t: Trade = { ...long(), type: 'SHORT', entry: 1.10000, stop: 1.10200, target: 1.09600 };
  const bars = [bar(0, 1.10000, 1.10001, 1.08700, 1.08750)];   // straight down past TP3 1.08800
  const r = resolveTradeSplit(t, bars, EXPIRY)!;
  near('leg A at TP1', r.legs[0].price, 1.09600);
  near('leg B at TP3 = 1.08800', r.legs[1].price, 1.08800);
}

console.log('\n9. within one bar, a touched stop beats a touched target');
{
  const bars = [bar(0, 1.10000, 1.10500, 1.09700, 1.09800)];   // touches TP1 AND the stop
  const r = resolveTradeSplit(long(), bars, EXPIRY)!;
  check('both legs stopped, no free win', r.legs.every(l => l.outcome === 'STOP_HIT'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

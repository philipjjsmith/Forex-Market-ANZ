/**
 * Assertions for the correlation guard.
 *
 * The failure mode this is guarding against is a SILENT SIGN ERROR: a guard that treats
 * "opposite directions on negatively correlated pairs" as a hedge would wave through the single
 * most concentrated book available and look like it was working. Every case below states the
 * expected sign explicitly.
 *
 * USAGE: npx tsx scripts/test-correlation-guard.ts   (exits non-zero on failure)
 */
import {
  evaluateCorrelation, correlationBetween, normalisePair,
  MAX_EFFECTIVE_EXPOSURE, PAIR_CORRELATION,
} from '../server/services/correlation-guard';

let pass = 0, fail = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}
function near(name: string, actual: number, expected: number, tol = 0.005) {
  check(name, Math.abs(actual - expected) <= tol, `got ${actual.toFixed(4)}, want ${expected.toFixed(4)}`);
}

console.log('\n1. matrix sanity');
for (const p of Object.keys(PAIR_CORRELATION)) {
  check(`${p} self-correlation is 1`, PAIR_CORRELATION[p][p] === 1);
}
for (const p of Object.keys(PAIR_CORRELATION)) {
  for (const q of Object.keys(PAIR_CORRELATION)) {
    check(`matrix symmetric ${p}/${q}`, PAIR_CORRELATION[p][q] === PAIR_CORRELATION[q][p]);
  }
}

console.log('\n2. symbol normalisation');
check("'EUR/USD' -> EURUSD", normalisePair('EUR/USD') === 'EURUSD');
check("'eur_usd' -> EURUSD", normalisePair('eur_usd') === 'EURUSD');
near('correlationBetween EUR/USD, USD/CHF', correlationBetween('EUR/USD', 'USD/CHF'), -0.746);

console.log('\n3. an empty book never blocks the first trade');
{
  const v = evaluateCorrelation({ symbol: 'EUR/USD', type: 'LONG' }, []);
  near('exposure with no open positions', v.exposure, 1.0);
  check('first trade is allowed', v.allowed === true);
  check('no reason given when allowed', v.reason === null);
}

console.log('\n4. THE CRITICAL CASE: negative correlation, opposite directions = SAME bet twice');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'USD/CHF', type: 'SHORT' }]
  );
  check('contribution is POSITIVE (compounding), not negative',
    v.contributions[0].contribution > 0,
    `contribution=${v.contributions[0].contribution.toFixed(3)}`);
  near('exposure', v.exposure, 1.746);
  check('still under the 2.0 cap, so allowed', v.allowed === true);
}

console.log('\n5. the mirror: negative correlation, SAME direction, genuinely offsets');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'USD/CHF', type: 'LONG' }]
  );
  check('contribution is NEGATIVE (offsetting)', v.contributions[0].contribution < 0);
  near('exposure falls below 1.0', v.exposure, 0.254);
  check('allowed', v.allowed === true);
}

console.log('\n6. positive correlation, same direction, compounds');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'GBP/USD', type: 'LONG' }]
  );
  near('exposure', v.exposure, 1.779);
  check('allowed at two positions', v.allowed === true);
}

console.log('\n7. three compounding positions are refused');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'GBP/USD', type: 'LONG' }, { symbol: 'AUD/USD', type: 'LONG' }]
  );
  near('exposure', v.exposure, 2.444);
  check('BLOCKED', v.allowed === false);
  check('reason names the largest contributor',
    !!v.reason && v.reason.includes('GBP/USD'), v.reason ?? '(none)');
}

console.log('\n8. the worst real book: long EUR/USD, short USD/CHF, long GBP/USD');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'USD/CHF', type: 'SHORT' }, { symbol: 'GBP/USD', type: 'LONG' }]
  );
  near('exposure', v.exposure, 2.525);
  check('BLOCKED', v.allowed === false);
  check('every contribution compounds', v.contributions.every(c => c.contribution > 0));
}

console.log('\n9. an offsetting position makes room again');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'GBP/USD', type: 'LONG' }, { symbol: 'GBP/USD', type: 'SHORT' }]
  );
  near('opposite positions on one pair cancel', v.exposure, 1.0);
  check('allowed', v.allowed === true);
}

console.log('\n10. an unknown pair is treated as independent AND flagged');
{
  const v = evaluateCorrelation(
    { symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'GBP/NZD', type: 'LONG' }]
  );
  near('unknown pair contributes 0', v.exposure, 1.0);
  check('flagged so it cannot pass unnoticed', v.hasUnknownPairs === true);
}

console.log('\n11. shorting the candidate mirrors the whole verdict');
{
  const a = evaluateCorrelation({ symbol: 'EUR/USD', type: 'LONG' },
    [{ symbol: 'GBP/USD', type: 'LONG' }]);
  const b = evaluateCorrelation({ symbol: 'EUR/USD', type: 'SHORT' },
    [{ symbol: 'GBP/USD', type: 'SHORT' }]);
  near('LONG/LONG and SHORT/SHORT give identical exposure', a.exposure, b.exposure);
}

console.log(`\ncap in force: ${MAX_EFFECTIVE_EXPOSURE.toFixed(2)}`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

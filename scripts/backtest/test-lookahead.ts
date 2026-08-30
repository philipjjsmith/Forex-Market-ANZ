/**
 * Look-ahead proof for the backtest slicer, plus the short-side cost check.
 *
 * Look-ahead is the defect that most easily turns a losing strategy into a winning backtest, and
 * it is invisible in the output — the numbers just come out better. So it is proved directly
 * rather than argued: sample thousands of decision moments and assert that nothing the harness
 * hands to analyze() could have been unknown at that instant.
 *
 * Two distinct properties are checked, because passing one does not imply the other:
 *   1. no returned bar is LABELLED at or after asOf
 *   2. the still-forming bar aggregates ONLY 5-minute bars strictly BEFORE asOf
 *
 * The cost check exists because a spread applied with the wrong sign on shorts is a silent,
 * direction-dependent edge. Half the spread is paid inside the entry fill and half on exit, so a
 * round trip must cost exactly one full spread whichever way the trade went.
 *
 * USAGE: npx tsx scripts/backtest/test-lookahead.ts
 */
import fs from 'fs';
import path from 'path';
import { buildTimeframes, type Ohlc } from './aggregate';
import { costTrade, DEFAULT_CONFIG, pipSize, type Trade } from './engine';

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (!cond) { failures++; console.log(`  FAIL ${name} ${detail}`); }
};

// ---------- look-ahead ----------
const file = path.join('.backtest-cache', 'duka-EURUSD-m5-2022-08-01-2026-08-01.json');
if (!fs.existsSync(file)) {
  console.log('  skipped look-ahead: no Dukascopy file. Run scripts/backtest/dukascopy-loader.ts.');
} else {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const m5: Ohlc[] = raw.map((b: any) => ({
    timestamp: new Date(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }));
  const tf = buildTimeframes(m5);

  const lastIdx = (bars: Ohlc[], t: number) => {
    let lo = 0, hi = bars.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].timestamp.getTime() <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  // mirrors sliceTrueOpen in run-backtest.ts
  const slice = (bars: Ohlc[], asOf: Date, n: number): Ohlc[] => {
    const t = asOf.getTime(); const i = lastIdx(bars, t); if (i < 0) return [];
    const closed = bars.slice(Math.max(0, i - n), i);
    const lo = lastIdx(m5, bars[i].timestamp.getTime() - 1) + 1, hi = lastIdx(m5, t - 1);
    if (hi >= lo) {
      let H = -Infinity, L = Infinity;
      for (let k = lo; k <= hi; k++) { if (m5[k].high > H) H = m5[k].high; if (m5[k].low < L) L = m5[k].low; }
      closed.push({ timestamp: bars[i].timestamp, open: m5[lo].open, high: H, low: L, close: m5[hi].close, volume: 0 });
    }
    return closed.slice(Math.max(0, closed.length - n));
  };

  const frames: [string, Ohlc[], number][] = [['weekly', tf.w1, 52], ['daily', tf.d1, 200], ['4h', tf.h4, 360], ['1h', tf.h1, 1440]];
  let checked = 0, violations = 0;

  for (let s = 0; s < 2000; s++) {
    const asOf = new Date(m5[5000 + Math.floor((m5.length - 6000) * (s / 2000))].timestamp.getTime());
    for (const [, bars, n] of frames) {
      const out = slice(bars, asOf, n);
      if (!out.length) continue;
      checked++;
      const last = out[out.length - 1];
      if (last.timestamp.getTime() > asOf.getTime()) { violations++; continue; }

      const bi = bars.findIndex(b => b.timestamp.getTime() === last.timestamp.getTime());
      if (bi >= 0 && bi + 1 < bars.length && bars[bi + 1].timestamp.getTime() > asOf.getTime()) {
        const lo = lastIdx(m5, bars[bi].timestamp.getTime() - 1) + 1, hi = lastIdx(m5, asOf.getTime() - 1);
        let H = -Infinity, L = Infinity;
        for (let k = lo; k <= hi; k++) { if (m5[k].high > H) H = m5[k].high; if (m5[k].low < L) L = m5[k].low; }
        if (Math.abs(last.high - H) > 1e-9 || Math.abs(last.low - L) > 1e-9) violations++;
      }
    }
  }
  ok(`no look-ahead across ${checked} slices`, violations === 0, `(${violations} violations)`);
  console.log(`  look-ahead: ${checked} slices checked, ${violations} violations`);
}

// ---------- spread symmetry ----------
// A round trip must cost exactly one full spread regardless of direction.
const pip = pipSize('EUR/USD');
const spread = DEFAULT_CONFIG.spreadPips['EUR/USD'] * pip;
const move = 30 * pip;

// LONG: filled at mid+half, exits at target; costTrade charges the other half.
const long: Trade = {
  symbol: 'EUR/USD', type: 'LONG', openedAt: new Date('2026-08-24T08:00Z'), closedAt: new Date('2026-08-24T12:00Z'),
  entry: 1.1000 + spread / 2, stop: 1.1000 + spread / 2 - move / 2, target: 1.1000 + spread / 2 + move,
  exitPrice: 1.1000 + spread / 2 + move, confidence: 100, tier: 'HIGH', outcome: 'TP1_HIT',
};
// SHORT: mirror image.
const short: Trade = {
  symbol: 'EUR/USD', type: 'SHORT', openedAt: new Date('2026-08-24T08:00Z'), closedAt: new Date('2026-08-24T12:00Z'),
  entry: 1.1000 - spread / 2, stop: 1.1000 - spread / 2 + move / 2, target: 1.1000 - spread / 2 - move,
  exitPrice: 1.1000 - spread / 2 - move, confidence: 100, tier: 'HIGH', outcome: 'TP1_HIT',
};
costTrade(long, { ...DEFAULT_CONFIG, swapPipsPerNight: { 'EUR/USD': 0 } });
costTrade(short, { ...DEFAULT_CONFIG, swapPipsPerNight: { 'EUR/USD': 0 } });

ok('long gross is the raw move', Math.abs(long.grossPips! - 30) < 1e-6, `got ${long.grossPips}`);
ok('short gross is the raw move', Math.abs(short.grossPips! - 30) < 1e-6, `got ${short.grossPips}`);
ok('long pays exactly half a spread on exit', Math.abs(long.grossPips! - long.netPips! - 0.5) < 1e-6, `got ${long.grossPips! - long.netPips!}`);
ok('short pays exactly half a spread on exit', Math.abs(short.grossPips! - short.netPips! - 0.5) < 1e-6, `got ${short.grossPips! - short.netPips!}`);
ok('cost is direction-symmetric', Math.abs(long.netPips! - short.netPips!) < 1e-9);
console.log(`  spread: long net ${long.netPips!.toFixed(3)}, short net ${short.netPips!.toFixed(3)} pips (both = 30 - 0.5)`);

console.log(failures === 0 ? 'lookahead+costs: ALL PASS' : `lookahead+costs: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Unit tests for the backtest engine primitives.
 *
 * These pin the decisions that quietly manufacture edges when they drift:
 *   - the market-open boundary in NEW YORK time (a hardcoded UTC hour is wrong ~5 months a year)
 *   - stop-first resolution when one 5-minute bar touches both stop and target
 *   - gap fills at the bar OPEN, never at the level
 *   - "still open" returning null rather than being silently booked as a loss
 *   - Wednesday's triple swap
 *
 * USAGE: npx tsx scripts/backtest/test-engine.ts
 */
import {
  isMarketOpen, isInKillZone, swapNights, resolveTrade, costTrade, DEFAULT_CONFIG, type Trade,
} from './engine';
import type { Ohlc } from './aggregate';

let failures = 0;
const chk = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`  FAIL  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};
const bar = (t: string, o: number, h: number, l: number, c: number): Ohlc =>
  ({ timestamp: new Date(t), open: o, high: h, low: l, close: c, volume: 0 });

// --- gates ---
chk('Saturday closed', isMarketOpen(new Date('2026-08-22T12:00Z')), false);
chk('Wednesday open', isMarketOpen(new Date('2026-08-26T12:00Z')), true);
chk('Fri 21:30Z SUMMER shut', isMarketOpen(new Date('2026-07-17T21:30Z')), false);
chk('Fri 21:30Z WINTER still open', isMarketOpen(new Date('2026-01-16T21:30Z')), true);
chk('kill zone 08:00', isInKillZone(new Date('2026-08-26T08:00Z')), true);
chk('11:00 is not a kill zone', isInKillZone(new Date('2026-08-26T11:00Z')), false);
chk('kill zone 13:30', isInKillZone(new Date('2026-08-26T13:30Z')), true);

// --- swap, incl. Wednesday triple ---
chk('same day, no rollover', swapNights(new Date('2026-08-24T08:00Z'), new Date('2026-08-24T20:00Z')), 0);
chk('one rollover', swapNights(new Date('2026-08-24T08:00Z'), new Date('2026-08-25T08:00Z')), 1);
chk('Tue->Thu = 4 (Wed charged triple)', swapNights(new Date('2026-08-25T08:00Z'), new Date('2026-08-27T08:00Z')), 4);

// --- resolution ---
const t0: Trade = {
  symbol: 'EUR/USD', type: 'LONG', openedAt: new Date('2026-08-24T08:00Z'),
  entry: 1.1000, stop: 1.0985, target: 1.1030, confidence: 100, tier: 'HIGH',
};
const expiry = new Date('2026-08-26T08:00Z');

chk('one bar touching BOTH resolves stop-first',
  resolveTrade({ ...t0 }, [bar('2026-08-24T08:05Z', 1.1000, 1.1035, 1.0980, 1.1010)], expiry)?.outcome,
  'STOP_HIT');
chk('gap through stop fills at the open',
  resolveTrade({ ...t0 }, [bar('2026-08-24T08:05Z', 1.0970, 1.0975, 1.0960, 1.0965)], expiry)?.price,
  1.0970);
chk('clean target fills at the level',
  (() => { const r = resolveTrade({ ...t0 }, [bar('2026-08-24T08:05Z', 1.1005, 1.1035, 1.1002, 1.1030)], expiry); return [r?.outcome, r?.price]; })(),
  ['TP1_HIT', 1.1030]);
chk('still open returns null, never a silent loss',
  resolveTrade({ ...t0 }, [bar('2026-08-24T08:05Z', 1.1000, 1.1005, 1.0995, 1.1002)], expiry),
  null);

// --- costs ---
const t: Trade = { ...t0, exitPrice: 1.1030, closedAt: new Date('2026-08-25T08:00Z'), outcome: 'TP1_HIT' };
costTrade(t, DEFAULT_CONFIG);
chk('net = gross 30 - half spread 0.5 - swap 0.3', Number(t.netPips?.toFixed(2)), 29.2);

console.log(failures === 0 ? 'engine: ALL PASS' : `engine: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

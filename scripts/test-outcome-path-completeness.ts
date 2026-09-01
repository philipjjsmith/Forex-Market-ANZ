/**
 * Assertions for the stored-path completeness predicate.
 *
 * WHY THIS EXISTS
 *
 * `backfill-outcome-paths.ts` now completes truncated paths BY DEFAULT. Before 2026-09-01 that
 * sat behind `--repair`, because `reachesExpiry` compared the last stored bar against the raw
 * `expires_at` — and a 48h window that spans a weekend can never contain a bar at its own expiry,
 * since the feed stops at the Friday 17:00 NY close. Every weekend span therefore read as partial
 * forever, which is why completing them had to be opt-in, and why in practice nothing ever
 * completed them.
 *
 * Measured on the live table before the change: 90 of 306 production rows called partial, every
 * one a weekend span. After: 306 of 306 complete, 0 truncated.
 *
 * The predicate decides what the backfill WRITES, and it fails in two opposite directions:
 *   - too strict → re-fetches correct data every run until the Twelve Data budget is gone
 *   - too loose  → forward signals keep paths truncated at the stop, and the counterfactual
 *                  exit test can never be answered, because the evidence ends exactly where the
 *                  counterfactual begins
 *
 * Runs offline. No database, no API calls.
 *
 *   npx tsx scripts/test-outcome-path-completeness.ts
 */
import { hasPath, reachesExpiry, lastTradeableBarOpen, TOLERANCE_MS } from './lib/outcome-path';

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, name: string) {
  if (cond) { pass++; } else { fails.push(name); console.log(`  FAIL  ${name}`); }
}
const eq = (a: any, b: any, name: string) =>
  ok(a === b, `${name}  (got ${a}, want ${b})`);

/** Build a 5-min bar series from `start`, `n` bars long. Only the timestamp is read. */
const path = (startISO: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    timestamp: new Date(Date.parse(startISO) + i * 300_000).toISOString(),
    open: 1, high: 1, low: 1, close: 1,
  }));
const D = (s: string) => new Date(s);

// ── hasPath: the jsonb-string trap ────────────────────────────────────────────────────────────
// postgres.js binds a JS string to ::jsonb as a STRING SCALAR, so a path can come back as
// '[{...}]' rather than [{...}]. A string has a .length, so a `.length === 0` guard passes it.
eq(hasPath(path('2026-08-27T13:15:00Z', 3)), true,  'hasPath: real array');
eq(hasPath([]),                              false, 'hasPath: empty array');
eq(hasPath(null),                            false, 'hasPath: null');
eq(hasPath(undefined),                       false, 'hasPath: undefined');
eq(hasPath('[{"timestamp":"x"}]'),           false, 'hasPath: jsonb STRING scalar is not a path');
eq(hasPath({ 0: 'x', length: 1 }),           false, 'hasPath: array-like object is not a path');

// ── lastTradeableBarOpen: the NY-local week boundary ──────────────────────────────────────────
// The week runs Sun 17:00 -> Fri 17:00 NEW YORK, i.e. 21:00 UTC under EDT and 22:00 under EST.
// A hardcoded UTC hour is wrong ~5 months a year.
{
  // 2026-08-29 is a Saturday; the last open bar before it is Friday 2026-08-28 20:55 UTC (EDT).
  const t = lastTradeableBarOpen(D('2026-08-29T13:34:00Z'), D('2026-08-27T13:30:00Z'));
  eq(t?.toISOString(), '2026-08-28T20:55:00.000Z', 'lastTradeableBarOpen: Sat expiry -> Fri 20:55 close (EDT)');
}
{
  // Mid-week expiry is its own floored bar — nothing to walk back past.
  const t = lastTradeableBarOpen(D('2026-09-02T08:44:00Z'), D('2026-08-31T08:40:00Z'));
  eq(t?.toISOString(), '2026-09-02T08:40:00.000Z', 'lastTradeableBarOpen: Wed expiry floors to :40');
}
{
  // A window lying entirely inside the shut market has no tradeable bar at all.
  const t = lastTradeableBarOpen(D('2026-08-29T12:00:00Z'), D('2026-08-29T06:00:00Z'));
  eq(t, null, 'lastTradeableBarOpen: fully-closed window -> null');
}

// ── reachesExpiry: the false positive that made --repair necessary ────────────────────────────
{
  // The real shape of signal-1787836747207-07ztk2gd5: created Thu 2026-08-27 13:19,
  // expiry Sat 13:19, 381 stored bars ending at the Friday close. This is CORRECT data.
  const created = D('2026-08-27T13:19:00Z');
  const expires = D('2026-08-29T13:19:00Z');
  const bars = path('2026-08-27T13:15:00Z', 381);
  eq(bars[bars.length - 1].timestamp, '2026-08-28T20:55:00.000Z', 'fixture: 381 bars land on the Friday close');
  eq(reachesExpiry(bars, expires, created), true,
     'weekend span ending at the Friday close is COMPLETE, not partial');
}
{
  // The real shape of signal-1788165894466-q2h9mbdgp: created Mon 2026-08-31 08:44, STOP_HIT
  // after 5.7h, 23 bars stored, expiry Wed 2026-09-02 08:44. The first FORWARD row to land
  // truncated, and the one the default run has to catch.
  const created = D('2026-08-31T08:44:00Z');
  const expires = D('2026-09-02T08:44:00Z');
  const bars = path('2026-08-31T08:45:00Z', 23);
  eq(bars[bars.length - 1].timestamp, '2026-08-31T10:35:00.000Z', 'fixture: 23 bars end 1.8h in');
  eq(reachesExpiry(bars, expires, created), false,
     'forward row truncated at the stop is INCOMPLETE');
}
{
  // Mid-week, running the full 48h.
  const created = D('2026-08-31T08:44:00Z');
  const expires = D('2026-09-02T08:44:00Z');
  eq(reachesExpiry(path('2026-08-31T08:40:00Z', 577), expires, created), true,
     'mid-week path reaching expiry is COMPLETE');
}
{
  // Tolerance: one bar of slack, so a feed publishing its final bar late is not chased forever.
  const created = D('2026-08-31T08:44:00Z');
  const expires = D('2026-09-02T08:44:00Z');
  const target = Date.parse('2026-09-02T08:40:00Z');
  const inside  = new Date(target - TOLERANCE_MS + 300_000);
  const outside = new Date(target - TOLERANCE_MS - 300_000);
  eq(reachesExpiry([{ timestamp: inside.toISOString() }],  expires, created), true,
     'within tolerance of the last open bar is COMPLETE');
  eq(reachesExpiry([{ timestamp: outside.toISOString() }], expires, created), false,
     'beyond tolerance is INCOMPLETE');
}
{
  // No path at all is incomplete, and a jsonb string must not be read as one.
  const created = D('2026-08-31T08:44:00Z');
  const expires = D('2026-09-02T08:44:00Z');
  eq(reachesExpiry(null, expires, created), false, 'null path is INCOMPLETE');
  eq(reachesExpiry([],   expires, created), false, 'empty path is INCOMPLETE');
  eq(reachesExpiry('[{"timestamp":"2026-09-02T08:40:00Z"}]', expires, created), false,
     'jsonb STRING scalar is INCOMPLETE even though it "ends" at expiry');
}
{
  // No tradeable bar in the window => nothing is fetchable => not worth retrying forever.
  const created = D('2026-08-29T06:00:00Z');
  const expires = D('2026-08-29T12:00:00Z');
  eq(reachesExpiry(path('2026-08-29T06:00:00Z', 2), expires, created), true,
     'fully-closed window counts as COMPLETE so it is never retried');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }

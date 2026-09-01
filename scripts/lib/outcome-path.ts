/**
 * Is a stored resolution path COMPLETE?
 *
 * Extracted from `backfill-outcome-paths.ts` on 2026-09-01 so the predicate can be tested
 * directly. That script is a top-level IIFE — importing it would run the backfill — so the
 * helpers could not otherwise be exercised without hitting the live database and the Twelve Data
 * budget. See `scripts/test-outcome-path-completeness.ts`.
 *
 * These decide what the backfill WRITES, so they are worth assertions: too strict and it re-fetches
 * correct data on every run until the API budget is gone; too loose and forward signals keep the
 * truncated paths that make the counterfactual exit test unanswerable.
 */
import { isMarketClosed } from '../../server/services/twelve-data';

/** One bar of slack, so a feed that publishes the final bar late is not chased forever. */
export const TOLERANCE_MS = 15 * 60_000;

/**
 * A usable path is a jsonb ARRAY, not a jsonb string.
 *
 * postgres.js binds a JS string to a `::jsonb` cast as a JSON *string scalar*, so
 * `${JSON.stringify(bars)}::jsonb` silently stores `"[{...}]"` rather than `[{...}]`.
 * Verified with `jsonb_typeof`: rows written that way came back as 'string' while the
 * validator's own rows are 'array'. Reading them back gives a JS string, and every consumer
 * that does `Array.isArray()` skips the row without complaining.
 *
 * Writing now uses `db.json(bars)`, and this check treats anything non-array as missing so the
 * affected rows are repaired rather than left looking done.
 */
export const hasPath = (bars: any) => Array.isArray(bars) && bars.length > 0;

/**
 * The last 5-minute bar-open at or before `end` that the market was actually OPEN for.
 *
 * A 48h window that spans a weekend can never contain a bar at its own expiry timestamp — the
 * feed stops at the Friday 17:00 NY close and resumes Sunday 17:00. Comparing a stored path
 * against the raw `expires_at` therefore reports correct data as truncated. Measured on the live
 * table: the raw comparison called 90 of 306 production rows partial; every one of them was a
 * weekend span, and under this rule all 306 are complete.
 *
 * Reuses `isMarketClosed` rather than restating the boundary, because the boundary is NY-local
 * (21:00 UTC under EDT, 22:00 under EST) and a hardcoded UTC hour was wrong ~5 months a year.
 */
export function lastTradeableBarOpen(end: Date, notBefore: Date): Date | null {
  let t = Math.floor(end.getTime() / 300_000) * 300_000;
  const floor = notBefore.getTime();
  while (t >= floor) {
    if (!isMarketClosed(new Date(t))) return new Date(t);
    t -= 300_000;
  }
  return null;
}

/**
 * Whether a stored path actually runs to the end of its window.
 *
 * Kept SEPARATE from `hasPath` on purpose, and it is the condition that matters: a path which
 * stops where the CURRENT stop fired cannot answer "what would a wider stop, a breakeven, or an
 * earlier target have done?" — the evidence ends exactly where the counterfactual begins.
 *
 * This is the normal shape of a FORWARD row. The validator writes the path when a trade
 * RESOLVES, clamped to `now`, so a signal that stops out in two hours stores two hours and the
 * remaining 46 have not happened yet. `signal-1788165894466-q2h9mbdgp` (2026-08-31, STOP_HIT
 * after 5.7h, 23 bars, expiry 2026-09-02) is the first such row.
 *
 * The test used to compare against `expires_at` directly, which made weekend-spanning windows
 * read as partial forever. That is why completing them had to be opt-in behind `--repair`, and
 * why in practice nothing completed them at all. Comparing against the last TRADEABLE bar
 * removes the false positives, so the default run can safely do the work.
 */
export function reachesExpiry(bars: any, expiresAt: Date, createdAt: Date): boolean {
  if (!hasPath(bars)) return false;
  const start = new Date(Math.floor(createdAt.getTime() / 300_000) * 300_000);
  const target = lastTradeableBarOpen(expiresAt, start);
  if (!target) return true;            // window lies entirely inside a closed market
  const last = new Date(bars[bars.length - 1].timestamp).getTime();
  return last >= target.getTime() - TOLERANCE_MS;
}

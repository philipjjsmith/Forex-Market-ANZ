/**
 * Complete the resolution path for signals whose 48h window has closed.
 *
 * WHY
 *
 * `outcome_candles` is the only record of what price did AFTER a signal fired. Until 2026-08-31
 * it was written at resolution time and stopped there — `min(resolutionTime, expiresAt)` — at
 * 15-minute granularity. That is the same truncation defect the backtest engine had: a path that
 * ends the instant the current stop fired cannot answer "what would a wider stop, a breakeven, or
 * an earlier target have done?", because the evidence stops exactly where the counterfactual
 * starts.
 *
 * The validator now writes to expiry at 5min, but it still runs when a trade RESOLVES, which can
 * be hours before expiry — so the tail is missing until the window closes. This job fills it in.
 *
 * It is the piece that makes forward out-of-sample data able to answer exit-rule questions
 * without re-running anything and without spending a pre-registration variant slot: the exit rule
 * is evaluated counterfactually against a stored path, not re-fitted.
 *
 * PROPERTIES
 *   - idempotent: re-running changes nothing once a path is complete
 *   - only touches rows whose expiry has PASSED, so it can never see the future of a live trade
 *   - never writes to `candles` (the 200 pre-signal bars a backtester needs) — only `outcome_candles`
 *   - respects the Twelve Data budget: one API call per signal, with a hard cap per run
 *
 * USAGE
 *   npx tsx scripts/backfill-outcome-paths.ts            # dry run, reports what it would do
 *   npx tsx scripts/backfill-outcome-paths.ts --apply    # writes
 *   npx tsx scripts/backfill-outcome-paths.ts --apply --limit=50
 *   npx tsx scripts/backfill-outcome-paths.ts --apply --repair   # ignore the age guard too
 *
 * Completing truncated paths is the DEFAULT as of 2026-09-01. It used to sit behind `--repair`
 * because the reaches-expiry test counted every weekend-spanning window as partial, so the
 * default could not be trusted to stop. That test is now market-hours aware.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { twelveDataAPI } from '../server/services/twelve-data';
import { hasPath, reachesExpiry } from '../server/services/outcome-path';

const arg = (k: string, d: string) =>
  process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(arg('limit', '40'), 10);   // free tier is 800 calls/day; stay well under

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });

(async () => {
  const rows: any[] = await db`
    SELECT signal_id, symbol, created_at, expires_at, outcome, outcome_candles
    FROM signal_history
    WHERE data_quality = 'production'
      AND expires_at < NOW()
    ORDER BY created_at DESC
  `;

  // Rows too old for the feed to still hold 5-minute history are REPORTED but not retried.
  //
  // Without this, a row whose tail can never be fetched would be re-attempted on every run,
  // spending one API call each time, forever. Measured June rows already return only ~13.6h of a
  // 48h window. `--repair` overrides the guard for a one-off attempt at older rows.
  const REPAIR = process.argv.includes('--repair');
  const MAX_AGE_DAYS = parseInt(arg('max-age-days', '30'), 10);
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;

  const incomplete = rows.filter(
    r => !reachesExpiry(r.outcome_candles, new Date(r.expires_at), new Date(r.created_at))
  );
  const todo = REPAIR ? incomplete : incomplete.filter(r => new Date(r.created_at).getTime() >= cutoff);
  const stale = incomplete.length - todo.length;

  const withPath = rows.filter(r => hasPath(r.outcome_candles)).length;
  console.log(`production signals past expiry : ${rows.length}`);
  console.log(`  have SOME path               : ${withPath}`);
  console.log(`  path runs to last open bar   : ${rows.length - incomplete.length}`);
  console.log(`  truncated                    : ${incomplete.length}`);
  if (stale > 0) {
    console.log(`    of which too old to retry  : ${stale}  (created > ${MAX_AGE_DAYS}d ago; --repair to force)`);
  }
  console.log(`need backfilling               : ${todo.length}`);
  console.log(`this run will attempt          : ${Math.min(todo.length, LIMIT)}  (limit ${LIMIT})`);
  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
    await db.end();
    return;
  }

  let done = 0, empty = 0, failed = 0;
  for (const r of todo.slice(0, LIMIT)) {
    const start = new Date(Math.floor(new Date(r.created_at).getTime() / 300_000) * 300_000);
    const end = new Date(r.expires_at);
    try {
      const bars = await twelveDataAPI.fetchCandlesInWindow(r.symbol, '5min', start, end);
      // Array.isArray, not `.length === 0`: a STRING also has a length, so a non-array return
      // slipped past the old guard and was then stored by db.json() as a jsonb string scalar.
      // Measured: 1 row of 307 landed that way before this check existed.
      if (!Array.isArray(bars) || bars.length === 0) {
        empty++;
        console.log(`  ~ ${r.signal_id} ${r.symbol}: no usable bars (got ${typeof bars})`);
        continue;
      }
      await db`
        UPDATE signal_history
        SET outcome_candles = ${db.json(bars as any)}, updated_at = NOW()
        WHERE signal_id = ${r.signal_id}
      `;
      done++;
      const span = (new Date(bars[bars.length - 1].timestamp).getTime()
                  - new Date(bars[0].timestamp).getTime()) / 3600e3;
      console.log(`  + ${r.signal_id} ${r.symbol}: ${bars.length} bars, ${span.toFixed(1)}h`);
    } catch (e: any) {
      failed++;
      console.log(`  ! ${r.signal_id} ${r.symbol}: ${e.message}`);
    }
  }

  console.log(`\nwritten ${done}, no-data ${empty}, failed ${failed}`);
  console.log(`remaining after this run: ${Math.max(0, todo.length - done)}`);
  await db.end();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

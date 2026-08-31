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
 *   npx tsx scripts/backfill-outcome-paths.ts --apply --repair   # re-fetch partial paths too
 */
import 'dotenv/config';
import postgres from 'postgres';
import { twelveDataAPI } from '../server/services/twelve-data';

const arg = (k: string, d: string) =>
  process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(arg('limit', '40'), 10);   // free tier is 800 calls/day; stay well under

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });

const hasPath = (bars: any[] | null) => !!bars && bars.length > 0;

/**
 * Whether a stored path actually runs to expiry.
 *
 * Kept SEPARATE from `hasPath` on purpose. Twelve Data's free tier has limited 5-minute history,
 * so for older signals it returns only what it holds — measured: recent signals come back with
 * ~375 bars (~31h, which is a full 48h window minus the weekend), while June signals return 164
 * bars (13.6h). Those can never satisfy a reaches-expiry test, so treating that test as the
 * backfill condition would retry them on every run forever and quietly burn the API budget.
 *
 * Default behaviour therefore skips anything with a path at all. `--repair` re-fetches partial
 * ones, for when more history becomes available or the tier changes.
 *
 * Note that a 48h window spanning a weekend ALWAYS reads as partial: the last bar is Friday's
 * close, hours before the Sunday expiry timestamp. That is correct data, not a gap, so `--repair`
 * would re-fetch those every time. It is deliberately opt-in for that reason.
 */
function reachesExpiry(bars: any[] | null, expiresAt: Date): boolean {
  if (!hasPath(bars)) return false;
  const last = new Date(bars![bars!.length - 1].timestamp).getTime();
  return last >= expiresAt.getTime() - 10 * 60_000;
}

(async () => {
  const rows: any[] = await db`
    SELECT signal_id, symbol, created_at, expires_at, outcome, outcome_candles
    FROM signal_history
    WHERE data_quality = 'production'
      AND expires_at < NOW()
    ORDER BY created_at DESC
  `;

  const REPAIR = process.argv.includes('--repair');
  const todo = REPAIR
    ? rows.filter(r => !reachesExpiry(r.outcome_candles, new Date(r.expires_at)))
    : rows.filter(r => !hasPath(r.outcome_candles));

  const withPath = rows.filter(r => hasPath(r.outcome_candles)).length;
  const full = rows.filter(r => reachesExpiry(r.outcome_candles, new Date(r.expires_at))).length;
  console.log(`production signals past expiry : ${rows.length}`);
  console.log(`  have SOME path               : ${withPath}`);
  console.log(`  path reaches expiry          : ${full}`);
  console.log(`need backfilling               : ${todo.length}${REPAIR ? '  (--repair: includes partial paths)' : ''}`);
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
      if (!bars || bars.length === 0) {
        empty++;
        console.log(`  ~ ${r.signal_id} ${r.symbol}: no bars returned`);
        continue;
      }
      await db`
        UPDATE signal_history
        SET outcome_candles = ${JSON.stringify(bars)}::jsonb, updated_at = NOW()
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

/**
 * Did the pipeline actually run, and did anything get lost on the way?
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-02 the generator produced FIVE signals and only THREE reached `signal_history`. The
 * two that vanished were confidence 124 — the highest readings in the entire dataset. Every
 * documented gate was traced and all should have passed, so `trackSignal` threw; its catch logged
 * to Render's console, which does not survive the free tier's spin-down.
 *
 * Nothing in the database recorded the loss, and "no signal today" reads identically whether the
 * market offered nothing or the pipeline died. This makes both answerable:
 *
 *   generation_runs        did a run start, finish, and with what error
 *   signal_provenance      per-symbol: analysed, produced, TRACKED or not, and why not
 *
 *   npx tsx scripts/check-pipeline.ts
 *   npx tsx scripts/check-pipeline.ts --days=3
 */
import 'dotenv/config';
import postgres from 'postgres';

const arg = (k: string, d: string) =>
  process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const DAYS = parseInt(arg('days', '2'), 10);

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });
const t = (d: any) => (d ? new Date(d).toISOString().slice(0, 19).replace('T', ' ') : '—');

(async () => {
  console.log(`=== GENERATION RUNS (last ${DAYS} days) ===`);
  const runs = await db`
    SELECT started_at, finished_at, ok, kill_zone_name, symbols_attempted,
           signals_generated, signals_tracked, error
    FROM generation_runs
    WHERE started_at > NOW() - (${DAYS} || ' days')::interval
    ORDER BY started_at DESC`;
  if (!runs.length) {
    console.log('  (no runs recorded — either none have happened since deploy, or the cron is not firing)');
  }
  for (const r of runs as any[]) {
    const state = r.finished_at === null ? '⚠️  DIED MID-RUN' : r.ok ? 'ok' : '❌ ERROR';
    console.log(`  ${t(r.started_at)}  ${state.padEnd(16)} ${r.kill_zone_name ?? ''}`);
    console.log(`      symbols ${r.symbols_attempted} | produced ${r.signals_generated} | tracked ${r.signals_tracked}`);
    if (r.error) console.log(`      error: ${r.error}`);
    if (r.signals_generated > r.signals_tracked) {
      console.log(`      🚨 ${r.signals_generated - r.signals_tracked} SIGNAL(S) PRODUCED BUT NOT TRACKED`);
    }
  }

  console.log(`\n=== SIGNALS LOST (produced but tracking failed) ===`);
  const lost = await db`
    SELECT analyzed_at, symbol, confidence, track_error
    FROM signal_provenance
    WHERE tracked IS FALSE AND analyzed_at > NOW() - (${DAYS} || ' days')::interval
    ORDER BY analyzed_at DESC`;
  if (!lost.length) console.log('  none ✅');
  for (const r of lost as any[])
    console.log(`  🚨 ${t(r.analyzed_at)} ${r.symbol} conf ${r.confidence}\n      ${r.track_error}`);

  console.log(`\n=== PRODUCED SIGNALS, and whether they landed ===`);
  const prod = await db`
    SELECT analyzed_at, symbol, confidence, source, signal_id, tracked
    FROM signal_provenance
    WHERE produced IS TRUE AND analyzed_at > NOW() - (${DAYS} || ' days')::interval
    ORDER BY analyzed_at DESC`;
  if (!prod.length) console.log('  (none produced in this window)');
  for (const r of prod as any[]) {
    const state = r.tracked === true ? 'TRACKED'
      : r.tracked === false ? '🚨 LOST'
      : r.signal_id ? 'tracked (pre-instrumentation)'
      : r.source === 'probe' ? 'probe — never tracked, by design'
      : '⚠️  unknown (produced before this instrumentation shipped)';
    console.log(`  ${t(r.analyzed_at)} ${String(r.symbol).padEnd(8)} conf ${String(r.confidence ?? '—').padStart(3)}  ${state}`);
  }

  console.log(`\n=== ANALYSES BY OUTCOME (last ${DAYS} days, production only) ===`);
  const gates = await db`
    SELECT CASE WHEN produced THEN 'FIRED'
                WHEN rejection_reason LIKE 'ADX_BELOW%' THEN 'ADX below 25'
                WHEN rejection_reason LIKE 'NO_ENTRY_SIGNAL%' THEN 'no entry trigger / not aligned'
                ELSE COALESCE(split_part(rejection_reason,' ',1),'(none)') END AS gate,
           count(*)::int n
    FROM signal_provenance
    WHERE source = 'production' AND analyzed_at > NOW() - (${DAYS} || ' days')::interval
    GROUP BY 1 ORDER BY n DESC`;
  for (const r of gates as any[]) console.log(`  ${String(r.n).padStart(4)}  ${r.gate}`);

  await db.end();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

/**
 * Has a USD/JPY order finally filled at the broker?
 *
 * WHY THIS EXISTS AS A COMMITTED SCRIPT
 *
 * For the week of 2026-09-07, USD/JPY produced 6 of 13 signals and filled ZERO of them, while
 * being the only pair in the set with a positive published record. The published result was
 * -0.99R; excluding the orders that could never be sent it was -3.99R over 7. Two defects, one
 * root cause, fixed in 70d9b58:
 *
 *   1. signal-generator.ts rounded every price toFixed(5) regardless of pair. JPY symbols accept
 *      3 decimals, so the broker rejected the orders outright:
 *      "INVALID_REQUEST: Order price = 153.51051 has more digits than symbol allows. Allowed 3"
 *   2. executeSignal sent the order, awaited a DATABASE INSERT, and only then attached the
 *      execution listener — so fast replies (a validation rejection being the fastest of all)
 *      arrived with nothing listening and became "Timeout waiting for payloadType 2126".
 *
 * That fix deployed into a closed weekend market and is still UNVERIFIED in production. The
 * scheduled tasks that watch for the first real JPY order run unattended, and a task that writes
 * its own query file at 06:15 needs filesystem permission to do it. A committed script needs only
 * permission to RUN — one narrow grant instead of three — and has the better property that the
 * query is reviewable in version control rather than composed fresh on each run.
 *
 * READ-ONLY. Four SELECTs. It places no orders and writes nothing.
 *
 *   npx tsx scripts/check-jpy-fill.ts
 *
 * Exit code is deliberately 0 in every non-error case, including "no opportunity yet" — a quiet
 * market is not a failure, and a scheduler that treats it as one trains people to ignore it.
 */
import 'dotenv/config';
import postgres from 'postgres';

/** 70d9b58 — the JPY rounding + listener-race fix — reached production at this instant. */
const FIX_DEPLOYED_UTC = '2026-09-13 03:08:00';

const decimals = (v: unknown): number => {
  const s = String(Number(v));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set — run this from the repo root so .env is loaded.');
    process.exit(1);
  }
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 8 });

  try {
    const jpyExec: any = await sql`
      select created_at, symbol, side, status, fill_price, lots, skip_reason, error
      from ctrader_executions
      where symbol like '%JPY%' and created_at >= ${FIX_DEPLOYED_UTC}::timestamptz
      order by created_at`;

    const allExec: any = await sql`
      select created_at, symbol, side, status, coalesce(skip_reason, error, '') note
      from ctrader_executions
      where created_at >= ${FIX_DEPLOYED_UTC}::timestamptz
      order by created_at`;

    const signals: any = await sql`
      select created_at, symbol, type, tier, confidence, entry_price, stop_loss, tp1, outcome
      from signal_history
      where created_at >= ${FIX_DEPLOYED_UTC}::timestamptz
      order by created_at`;

    const runs: any = await sql`
      select started_at, ok, in_kill_zone, kill_zone_name, signals_generated
      from generation_runs order by started_at desc limit 5`;

    console.log(`checked ${new Date().toISOString()} — fix deployed ${FIX_DEPLOYED_UTC} UTC\n`);

    console.log(`JPY execution attempts since the fix: ${jpyExec.length}`);
    for (const r of jpyExec) {
      console.log(`  ${String(r.created_at).slice(4, 21)} ${r.side} ${String(r.status).padEnd(16)}` +
        ` fill=${r.fill_price ?? '-'} lots=${r.lots ?? '-'} ${r.skip_reason ?? r.error ?? ''}`.trimEnd());
    }

    console.log(`\nAll execution attempts since the fix: ${allExec.length}`);
    for (const r of allExec) {
      console.log(`  ${String(r.created_at).slice(4, 21)} ${String(r.symbol).padEnd(8)}` +
        ` ${String(r.side).padEnd(5)} ${String(r.status).padEnd(16)} ${r.note}`.trimEnd());
    }

    // Decimal places on a JPY signal are partial proof on their own: they show the DEPLOYED
    // generator is rounding correctly even when no order was placed, e.g. a MEDIUM-tier signal
    // that never reaches the broker by design.
    const jpySignals = signals.filter((r: any) => String(r.symbol).includes('JPY'));
    console.log(`\nSignals since the fix: ${signals.length} (${jpySignals.length} JPY)`);
    let roundingProven: boolean | null = null;
    for (const r of jpySignals) {
      const d = [decimals(r.entry_price), decimals(r.stop_loss), decimals(r.tp1)];
      const good = d.every(x => x <= 3);
      roundingProven = roundingProven === false ? false : good;
      console.log(`  ${String(r.created_at).slice(4, 21)} ${r.type} ${r.tier} ${r.confidence}` +
        `  entry=${r.entry_price} stop=${r.stop_loss} tp1=${r.tp1}` +
        `  decimals=${d.join('/')} ${good ? 'OK (<=3)' : 'STILL 5DP — ROUNDING FIX DID NOT REACH PRODUCTION'}`);
    }

    console.log('\nPipeline liveness (last 5 generation runs):');
    for (const r of runs) {
      console.log(`  ${String(r.started_at).slice(4, 21)} ok=${r.ok} zone=${r.kill_zone_name ?? '-'}` +
        ` generated=${r.signals_generated}`);
    }

    // ── Verdict ────────────────────────────────────────────────────────────
    const filled = jpyExec.filter((r: any) => r.status === 'filled');
    const errored = jpyExec.filter((r: any) => r.status === 'error');
    const skipped = jpyExec.filter((r: any) => String(r.status).startsWith('skipped'));

    console.log('\n──────── VERDICT ────────');
    if (filled.length) {
      console.log(`CONFIRMED — ${filled.length} USD/JPY order(s) filled. The fix works in production.`);
      for (const r of filled) console.log(`  fill_price=${r.fill_price} lots=${r.lots} at ${r.created_at}`);
    } else if (errored.length) {
      console.log('STILL BROKEN — a JPY order was attempted and failed:');
      for (const r of errored) {
        const why = String(r.error ?? '');
        const which = /Allowed 3 digits|more digits than symbol/i.test(why) ? 'the ROUNDING fix did not take'
                    : /payloadType 2126|Timeout/i.test(why)               ? 'the LISTENER RACE fix did not take'
                    : 'an unrecognised failure — read the text below carefully';
        console.log(`  ${which}\n    ${why}`);
      }
    } else if (skipped.length) {
      console.log('NO CONFIRMATION YET — JPY signals fired but were skipped before the broker:');
      for (const r of skipped) console.log(`  ${r.status}: ${r.skip_reason ?? ''}`);
      console.log('  skipped_tier means MEDIUM tier, which never reaches the broker by design.');
    } else {
      console.log('NO OPPORTUNITY YET — no USD/JPY order has been attempted since the fix.');
      console.log('  Signals only generate in the kill zones: London 07:00-10:00 UTC, NY 12:00-15:00 UTC.');
      console.log('  This is not a failure. A HIGH-tier USD/JPY signal is required to test the fix.');
    }
    if (roundingProven === true) {
      console.log('  (Rounding fix IS confirmed live: every JPY signal since the fix is <=3 decimals.)');
    }
  } finally {
    await sql.end();
  }
};

main().catch(err => { console.error('check failed:', err?.message ?? err); process.exit(1); });

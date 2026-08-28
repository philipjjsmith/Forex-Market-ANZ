/**
 * Verify the SHIPPED outcome validator against known historical trades.
 *
 * Why this exists: `validatePendingSignals()` is a no-op when nothing is PENDING, so the
 * only way to exercise the real code path without waiting for live signals is to call the
 * resolver directly on historical rows. `private` in TypeScript is compile-time only, so the
 * method is reachable at runtime — this deliberately tests the DEPLOYED implementation, not a
 * reimplementation of it. That distinction is the whole reason the old backtester was
 * worthless: it simulated a strategy that was never deployed.
 *
 * It also cross-checks two INDEPENDENT implementations that must agree:
 *   - outcome-validator.ts  checkOutcomeFromCandles()   (live path)
 *   - scripts/backfill-corrected-outcomes.ts            (corrected_* columns)
 * If they disagree, one of them is wrong and neither should be trusted.
 *
 * Read-only: makes no writes.
 *
 * USAGE  npx tsx scripts/verify-validator.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { outcomeValidator } from '../server/services/outcome-validator';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

(async () => {
  // A spread of cases: the hand-verified false stop-out, plus whatever the backfill
  // recorded as a win, a loss, and an expiry — so every branch of the resolver is hit.
  const cases: any[] = await sql`
    (SELECT * FROM signal_history
      WHERE symbol='USD/CHF' AND type='LONG' AND created_at >= '2026-06-19' AND created_at < '2026-06-20'
      ORDER BY created_at DESC LIMIT 1)
    UNION ALL
    (SELECT * FROM signal_history
      WHERE data_quality='production' AND corrected_outcome='TP1_HIT' ORDER BY created_at DESC LIMIT 2)
    UNION ALL
    (SELECT * FROM signal_history
      WHERE data_quality='production' AND corrected_outcome='STOP_HIT' ORDER BY created_at DESC LIMIT 2)
    UNION ALL
    (SELECT * FROM signal_history
      WHERE data_quality='production' AND corrected_outcome='EXPIRED' ORDER BY created_at DESC LIMIT 1)`;

  console.log(`Exercising the SHIPPED validator on ${cases.length} historical signals\n`);

  let agree = 0, disagree = 0, nulls = 0;

  for (const row of cases) {
    const signal = {
      id: row.id, signal_id: row.signal_id, user_id: row.user_id,
      symbol: row.symbol, type: row.type,
      entry_price: Number(row.entry_price),
      stop_loss: Number(row.stop_loss),
      tp1: Number(row.tp1), tp2: Number(row.tp2), tp3: Number(row.tp3),
      tier: row.tier, trade_live: row.trade_live,
      created_at: row.created_at, expires_at: row.expires_at,
    };

    // `private` is compile-time only — this reaches the real deployed method.
    const res = await (outcomeValidator as any).checkOutcomeFromCandles(signal);

    const when = new Date(row.created_at).toISOString().slice(0, 16);
    if (!res) {
      nulls++;
      console.log(`${when} ${row.symbol} ${String(row.type).padEnd(5)} -> validator returned NULL (unresolved)`);
      continue;
    }

    const backfilled = row.corrected_outcome ?? '(not backfilled)';
    const match = res.outcome === backfilled;
    if (row.corrected_outcome) { match ? agree++ : disagree++; }

    console.log(
      `${when} ${row.symbol} ${String(row.type).padEnd(5)}` +
      ` | recorded=${String(row.outcome).padEnd(8)}` +
      ` backfill=${String(backfilled).padEnd(8)}` +
      ` validator=${String(res.outcome).padEnd(8)} ${row.corrected_outcome ? (match ? '✅ agree' : '❌ DISAGREE') : ''}` +
      ` | MFE=${res.mfeR.toFixed(2)}R MAE=${res.maeR.toFixed(2)}R` +
      ` @ ${new Date(res.outcomeTime).toISOString().slice(0, 16)}`
    );
  }

  console.log(`\n=== CROSS-CHECK: live validator vs backfill script ===`);
  console.log(`  agree: ${agree}   disagree: ${disagree}   validator returned null: ${nulls}`);
  console.log(disagree === 0
    ? '  ✅ Two independent implementations agree — the resolver is consistent.'
    : '  ❌ They disagree. One is wrong; do not trust either until resolved.');

  await sql.end({ timeout: 5 });
  process.exit(0);
})();

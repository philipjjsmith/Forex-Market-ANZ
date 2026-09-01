/**
 * Read the cTrader execution record — what the system actually did with each signal.
 *
 * Answers the question auto-execution has to be able to answer and could not before 2026-09-01:
 * "did we take that trade, and if not, why not?" Every decision is a row, skips included, so a
 * signal held by the approval gate is distinguishable from one the executor never saw.
 *
 * Reads only. Places nothing, closes nothing, touches no broker.
 *
 *   npx tsx scripts/ctrader/executions.ts
 *   npx tsx scripts/ctrader/executions.ts --limit=50
 */
import 'dotenv/config';
import postgres from 'postgres';

const arg = (k: string, d: string) =>
  process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const LIMIT = parseInt(arg('limit', '25'), 10);

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });

(async () => {
  const [{ n }] = await db`SELECT count(*)::int n FROM ctrader_executions`;
  console.log(`ctrader_executions: ${n} row(s)\n`);

  if (n === 0) {
    console.log('No execution decisions recorded yet.');
    console.log('That means signal generation has not reached the executor since the recorder');
    console.log('shipped — NOT that execution is broken. A skipped signal writes a row too, so');
    console.log('the first HIGH-tier signal after deploy will appear here whatever happens to it.');
    await db.end();
    return;
  }

  const byStatus = await db`
    SELECT status, count(*)::int n, max(created_at) latest
    FROM ctrader_executions GROUP BY status ORDER BY n DESC`;
  console.log('by status:');
  for (const r of byStatus) console.log(`  ${String(r.status).padEnd(22)} ${String(r.n).padStart(4)}   latest ${r.latest?.toISOString()}`);

  const rows = await db`
    SELECT created_at, status, skip_reason, symbol, side, tier, confidence, mode,
           account_id, account_is_live, lots, execution_type, position_id, fill_price,
           reconciled_open, error, signal_id
    FROM ctrader_executions ORDER BY created_at DESC LIMIT ${LIMIT}`;

  console.log(`\nlast ${rows.length}:`);
  for (const r of rows) {
    const when = r.created_at.toISOString().slice(0, 16).replace('T', ' ');
    const head = `${when}  ${String(r.status).padEnd(20)} ${r.symbol} ${r.side ?? ''} ${r.tier ?? ''}`;
    const detail =
      r.status?.startsWith('skipped') ? `  reason: ${r.skip_reason}`
      : r.status === 'error'          ? `  error: ${r.error}`
      : `  ${r.lots ?? '?'} lots | execType ${r.execution_type ?? '?'} `
        + `| position ${r.position_id ?? 'none'} @ ${r.fill_price ?? '?'} `
        + `| broker-confirmed open: ${r.reconciled_open === null ? 'not checked' : r.reconciled_open}`;
    console.log(head);
    console.log(detail);
    if (r.account_is_live === true) console.log('  ⚠️  THIS ROW IS A LIVE ACCOUNT');
  }

  const live = await db`SELECT count(*)::int n FROM ctrader_executions WHERE account_is_live IS TRUE`;
  console.log(`\nrows against a LIVE account: ${live[0].n}  (must stay 0 — demo only)`);
  await db.end();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

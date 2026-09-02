/**
 * Broker ground truth vs the modelled outcome — read-only, no broker connection.
 *
 * The whole point of recording deals is this comparison. `signal_history` says what the candle
 * model THINKS happened; `ctrader_deals` says what actually filled and closed, including swap and
 * commission the model does not carry at all.
 *
 *   npx tsx scripts/ctrader/deals.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });

const n = (v: any, d = 5) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));

(async () => {
  const [sync] = await db`SELECT * FROM ctrader_deal_sync WHERE id = 1`;
  console.log(sync
    ? `sync watermark: ${sync.last_synced_to?.toISOString?.() ?? sync.last_synced_to} | last run ${sync.last_run_at?.toISOString?.() ?? '—'} | deals seen ${sync.deals_seen}`
    : 'sync has never run.');

  const [{ count }] = await db`SELECT count(*)::int AS count FROM ctrader_deals`;
  console.log(`ctrader_deals: ${count} row(s)\n`);

  if (count === 0) {
    console.log('No broker deals recorded yet. Run the sync from Admin -> cTrader Connectivity');
    console.log('-> "Sync broker deals". It needs credentials, which live only in Render.');
    await db.end();
    return;
  }

  const deals = await db`
    SELECT deal_id, position_id, trade_side, filled_volume, execution_price, deal_status,
           is_close, gross_profit, swap, close_commission, net_profit, balance_after, executed_at
    FROM ctrader_deals ORDER BY executed_at DESC NULLS LAST LIMIT 20`;
  console.log('recent deals (newest first):');
  for (const d of deals) {
    const when = d.executed_at ? d.executed_at.toISOString().slice(0, 16).replace('T', ' ') : '—';
    const side = d.trade_side === 1 ? 'BUY ' : d.trade_side === 2 ? 'SELL' : '?   ';
    const kind = d.is_close ? 'CLOSE' : 'OPEN ';
    let line = `  ${when}  ${kind} ${side} pos ${d.position_id ?? '—'} @ ${n(d.execution_price)} `
             + `vol ${d.filled_volume ?? '—'} status ${d.deal_status}`;
    if (d.is_close) {
      line += `\n         gross ${n(d.gross_profit, 2)} | swap ${n(d.swap, 2)} `
            + `| commission ${n(d.close_commission, 2)} | NET ${n(d.net_profit, 2)} `
            + `| balance after ${n(d.balance_after, 2)}`;
    }
    console.log(line);
  }

  // The comparison this table exists for.
  const cmp = await db`
    SELECT symbol, side, tier, signal_id, position_id, signal_entry, broker_entry_price,
           signal_stop, signal_tp1, exit_price, realized_pnl, created_at, closed_at
    FROM ctrader_executions
    WHERE position_id IS NOT NULL ORDER BY created_at DESC LIMIT 20`;

  console.log('\nmodelled vs broker:');
  if (!cmp.length) console.log('  (no orders with a broker position id yet)');
  for (const r of cmp) {
    console.log(`  ${r.symbol} ${r.side} ${r.tier} pos ${r.position_id}`);
    console.log(`    intended entry ${n(r.signal_entry)}  ->  broker entry ${n(r.broker_entry_price)}`
      + (r.signal_entry && r.broker_entry_price
          ? `   slippage ${((Number(r.broker_entry_price) - Number(r.signal_entry)) * 10000).toFixed(1)} pips`
          : ''));
    console.log(`    stop ${n(r.signal_stop)} / target ${n(r.signal_tp1)}  ->  exit ${n(r.exit_price)}`);
    console.log(`    realised P&L ${r.realized_pnl === null ? 'still open' : n(r.realized_pnl, 2)}`
      + (r.closed_at ? `  closed ${r.closed_at.toISOString().slice(0, 16).replace('T', ' ')}` : ''));
  }

  await db.end();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

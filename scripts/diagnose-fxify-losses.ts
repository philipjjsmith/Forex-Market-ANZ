import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { URL } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const dbUrl = new URL(process.env.DATABASE_URL);
const client = postgres({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port || '5432'),
  database: dbUrl.pathname.slice(1),
  username: dbUrl.username,
  password: decodeURIComponent(dbUrl.password),
  ssl: 'require',
  connect_timeout: 10,
});

const db = drizzle(client);

async function diagnoseFxifyLosses() {
  console.log('🔍 FXIFY LOSSES DIAGNOSTIC REPORT');
  console.log('='.repeat(80));
  console.log('');

  try {
    // Query 1: Monthly breakdown
    console.log('📊 QUERY 1: Monthly Performance Breakdown');
    console.log('-'.repeat(80));
    const monthlyResults = await client`
      SELECT
        DATE_TRUNC('month', outcome_time) as month,
        COUNT(*) as signals,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
        ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
      FROM signal_history
      WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
      GROUP BY DATE_TRUNC('month', outcome_time)
      ORDER BY month DESC
      LIMIT 12
    `;

    console.log('Month          | Signals | Avg Pips | Total Pips | Win Rate');
    console.log('-'.repeat(80));
    for (const row of monthlyResults) {
      const month = row.month ? new Date(row.month).toISOString().slice(0, 7) : 'Unknown';
      console.log(
        `${month.padEnd(14)} | ${String(row.signals).padEnd(7)} | ${String(row.avg_pips).padEnd(8)} | ${String(row.total_pips).padEnd(10)} | ${row.win_rate}%`
      );
    }
    console.log('');

    // Query 2: Per-symbol breakdown
    console.log('📊 QUERY 2: Per-Symbol Performance Breakdown');
    console.log('-'.repeat(80));
    const symbolResults = await client`
      SELECT
        symbol,
        COUNT(*) as signals,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
        ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
      FROM signal_history
      WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
      GROUP BY symbol
      ORDER BY total_pips ASC
    `;

    console.log('Symbol     | Signals | Avg Pips | Total Pips | Win Rate');
    console.log('-'.repeat(80));
    for (const row of symbolResults) {
      console.log(
        `${(row.symbol || 'Unknown').padEnd(10)} | ${String(row.signals).padEnd(7)} | ${String(row.avg_pips).padEnd(8)} | ${String(row.total_pips).padEnd(10)} | ${row.win_rate}%`
      );
    }
    console.log('');

    // Query 3: Strategy version breakdown
    console.log('📊 QUERY 3: Strategy Version Performance Breakdown');
    console.log('-'.repeat(80));
    const versionResults = await client`
      SELECT
        strategy_version,
        COUNT(*) as signals,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
        ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
      FROM signal_history
      WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
      GROUP BY strategy_version
      ORDER BY total_pips ASC
    `;

    console.log('Version    | Signals | Avg Pips | Total Pips | Win Rate');
    console.log('-'.repeat(80));
    for (const row of versionResults) {
      console.log(
        `${(row.strategy_version || 'Unknown').padEnd(10)} | ${String(row.signals).padEnd(7)} | ${String(row.avg_pips).padEnd(8)} | ${String(row.total_pips).padEnd(10)} | ${row.win_rate}%`
      );
    }
    console.log('');

    // Query 4: Recent signals (last 20)
    console.log('📊 QUERY 4: Recent FXIFY Signals (Last 20)');
    console.log('-'.repeat(80));
    const recentSignals = await client`
      SELECT
        symbol,
        signal_type,
        confidence,
        outcome,
        profit_loss_pips,
        strategy_version,
        outcome_time
      FROM signal_history
      WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
      ORDER BY outcome_time DESC
      LIMIT 20
    `;

    console.log('Symbol     | Type  | Conf | Outcome   | P/L Pips | Version | Date');
    console.log('-'.repeat(80));
    for (const row of recentSignals) {
      const date = row.outcome_time ? new Date(row.outcome_time).toISOString().slice(0, 10) : 'Unknown';
      console.log(
        `${(row.symbol || 'N/A').padEnd(10)} | ${(row.signal_type || 'N/A').padEnd(5)} | ${String(row.confidence).padEnd(4)} | ${(row.outcome || 'N/A').padEnd(9)} | ${String(row.profit_loss_pips).padEnd(8)} | ${(row.strategy_version || 'N/A').padEnd(7)} | ${date}`
      );
    }
    console.log('');

    // Query 5: Overall summary
    console.log('📊 QUERY 5: Overall FXIFY Summary');
    console.log('-'.repeat(80));
    const summary = await client`
      SELECT
        COUNT(*) as total_signals,
        ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
        ROUND(MIN(profit_loss_pips)::numeric, 2) as min_pips,
        ROUND(MAX(profit_loss_pips)::numeric, 2) as max_pips,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
        ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
      FROM signal_history
      WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
    `;

    const s = summary[0];
    console.log(`Total Signals:    ${s.total_signals}`);
    console.log(`Avg Confidence:   ${s.avg_confidence}%`);
    console.log(`Win Rate:         ${s.win_rate}% (${s.wins} wins, ${s.losses} losses)`);
    console.log(`Total Pips:       ${s.total_pips}`);
    console.log(`Avg P/L per sig:  ${s.avg_pips} pips`);
    console.log(`Min loss:         ${s.min_pips} pips`);
    console.log(`Max win:          ${s.max_pips} pips`);
    console.log('');

    // Convert to dollars
    const dollarsPerPip = 10; // $10 per pip for $100K account
    const totalDollars = Number(s.total_pips) * dollarsPerPip;
    console.log(`💰 DOLLAR CONVERSION (at $${dollarsPerPip}/pip for $100K account):`);
    console.log(`Total P/L: $${totalDollars.toLocaleString()}`);
    console.log('');

    console.log('='.repeat(80));
    console.log('✅ DIAGNOSTIC COMPLETE');

  } catch (error) {
    console.error('❌ Error running diagnostic:', error);
  } finally {
    await client.end();
    process.exit(0);
  }
}

diagnoseFxifyLosses();

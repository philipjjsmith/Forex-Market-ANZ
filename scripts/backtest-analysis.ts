import postgres from 'postgres';

const DB_URL = 'postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres';

const sql = postgres(DB_URL, {
  ssl: 'require',
  connect_timeout: 30,
});

async function main() {
  try {
    console.log('='.repeat(80));
    console.log('COMPREHENSIVE BACKTEST ANALYSIS - Feb 23, 2026');
    console.log('='.repeat(80));
    console.log('');

    // QUERY 1
    console.log('=== QUERY 1: ALL-TIME OVERVIEW ===');
    const q1 = await sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0), 2) as win_rate_pct,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')), 0) as net_pips,
        MIN(created_at) as first_signal,
        MAX(created_at) as last_signal
      FROM signal_history
      WHERE data_quality = 'production'
    `;
    console.log(JSON.stringify(q1, null, 2));
    console.log('');

    // QUERY 2
    console.log('=== QUERY 2: PERFORMANCE BY TIME PERIOD ===');
    const q2 = await sql`
      SELECT
        CASE
          WHEN created_at < '2026-01-13' THEN '1. Pre-Phase1-fixes (before Jan 13)'
          WHEN created_at >= '2026-01-13' AND created_at < '2026-02-22' THEN '2. Post-Phase1-fixes (Jan 13 - Feb 22)'
          ELSE '3. Post-full-bugfix (Feb 22+)'
        END as period,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0), 2) as win_rate_pct,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')), 0) as net_pips
      FROM signal_history
      WHERE data_quality = 'production'
      GROUP BY 1
      ORDER BY 1
    `;
    console.log(JSON.stringify(q2, null, 2));
    console.log('');

    // QUERY 3
    console.log('=== QUERY 3: PER SYMBOL PERFORMANCE (ALL-TIME) ===');
    const q3 = await sql`
      SELECT
        symbol,
        type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0), 2) as win_rate_pct,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')), 0) as net_pips
      FROM signal_history
      WHERE data_quality = 'production'
      GROUP BY symbol, type
      ORDER BY symbol, type
    `;
    console.log(JSON.stringify(q3, null, 2));
    console.log('');

    // QUERY 4
    console.log('=== QUERY 4: CONFIDENCE TIER BREAKDOWN ===');
    const q4 = await sql`
      SELECT
        CASE
          WHEN confidence >= 95 THEN 'HIGH (95+)'
          WHEN confidence >= 85 THEN 'STANDARD (85-94)'
          WHEN confidence >= 70 THEN 'MEDIUM (70-84)'
          ELSE 'LOW (<70)'
        END as tier,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0), 2) as win_rate_pct,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')), 0) as net_pips
      FROM signal_history
      WHERE data_quality = 'production'
      GROUP BY 1
      ORDER BY 1 DESC
    `;
    console.log(JSON.stringify(q4, null, 2));
    console.log('');

    // QUERY 5
    console.log('=== QUERY 5: ALL INDIVIDUAL SIGNALS SINCE JAN 13 ===');
    const q5 = await sql`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        strategy_version,
        outcome,
        profit_loss_pips,
        created_at,
        outcome_time
      FROM signal_history
      WHERE data_quality = 'production'
        AND created_at >= '2026-01-13'
      ORDER BY created_at DESC
    `;
    console.log(JSON.stringify(q5, null, 2));
    console.log('');

    // QUERY 6
    console.log('=== QUERY 6: DAILY DEDUPLICATION CHECK (since Jan 13) ===');
    const q6 = await sql`
      SELECT
        DATE(created_at) as trade_date,
        COUNT(*) as signals_that_day,
        COUNT(DISTINCT symbol) as symbols,
        STRING_AGG(DISTINCT symbol, ', ') as symbol_list,
        STRING_AGG(outcome, ', ' ORDER BY created_at) as outcomes
      FROM signal_history
      WHERE data_quality = 'production'
        AND created_at >= '2026-01-13'
      GROUP BY DATE(created_at)
      ORDER BY trade_date DESC
      LIMIT 30
    `;
    console.log(JSON.stringify(q6, null, 2));
    console.log('');

    // QUERY 7
    console.log('=== QUERY 7: WIN/LOSS PIPS DETAIL - RESOLVED SIGNALS SINCE JAN 13 ===');
    const q7 = await sql`
      SELECT
        created_at,
        symbol,
        type,
        confidence,
        outcome,
        profit_loss_pips,
        entry_price,
        stop_loss,
        tp1,
        outcome_price
      FROM signal_history
      WHERE data_quality = 'production'
        AND created_at >= '2026-01-13'
        AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')
      ORDER BY created_at
    `;
    console.log(JSON.stringify(q7, null, 2));
    console.log('');

    console.log('='.repeat(80));
    console.log('ALL QUERIES COMPLETE');
    console.log('='.repeat(80));

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await sql.end();
  }
}

main();

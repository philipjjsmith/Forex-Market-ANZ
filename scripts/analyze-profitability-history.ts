import 'dotenv/config';
/**
 * PROFITABILITY HISTORY ANALYSIS
 * Find when system was profitable and what changed
 */

import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  connect_timeout: 10,
});

async function analyzeProfitabilityHistory() {
  console.log('💰 PROFITABILITY HISTORY ANALYSIS');
  console.log('='.repeat(100));
  console.log('Finding when system was profitable and what changed...');
  console.log('');

  try {
    // Query 1: Performance by month
    console.log('📊 QUERY 1: Performance by Month');
    console.log('-'.repeat(100));

    const monthlyPerf = await db`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE trade_live = true) as live_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 1) as win_rate,
        string_agg(DISTINCT strategy_version, ', ') as versions
      FROM signal_history
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `;

    console.table(monthlyPerf.map(m => ({
      month: m.month,
      total: m.total_signals,
      live: m.live_signals,
      wins: m.wins,
      losses: m.losses,
      pending: m.pending,
      win_rate: m.win_rate ? `${m.win_rate}%` : 'N/A',
      versions: m.versions
    })));
    console.log('');

    // Query 2: Performance by strategy version
    console.log('📊 QUERY 2: Performance by Strategy Version');
    console.log('-'.repeat(100));

    const versionPerf = await db`
      SELECT
        strategy_version,
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE trade_live = true) as live_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 1) as win_rate,
        MIN(created_at) as first_signal,
        MAX(created_at) as last_signal
      FROM signal_history
      WHERE strategy_version IS NOT NULL
      GROUP BY strategy_version
      ORDER BY first_signal DESC
    `;

    console.table(versionPerf.map(v => ({
      version: v.strategy_version,
      total: v.total_signals,
      live: v.live_signals,
      wins: v.wins,
      losses: v.losses,
      win_rate: v.win_rate ? `${v.win_rate}%` : 'N/A',
      first: v.first_signal ? new Date(v.first_signal).toISOString().split('T')[0] : 'N/A',
      last: v.last_signal ? new Date(v.last_signal).toISOString().split('T')[0] : 'N/A'
    })));
    console.log('');

    // Query 3: Find best performing period
    console.log('📊 QUERY 3: Best Performing Periods (Win Rate > 50%)');
    console.log('-'.repeat(100));

    const bestPeriods = await db`
      WITH weekly_stats AS (
        SELECT
          DATE_TRUNC('week', created_at) as week,
          COUNT(*) as signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          strategy_version
        FROM signal_history
        WHERE outcome != 'PENDING'
        GROUP BY DATE_TRUNC('week', created_at), strategy_version
        HAVING COUNT(*) FILTER (WHERE outcome != 'PENDING') >= 5
      )
      SELECT
        TO_CHAR(week, 'YYYY-MM-DD') as week_start,
        signals,
        wins,
        losses,
        ROUND(100.0 * wins / NULLIF(wins + losses, 0), 1) as win_rate,
        strategy_version
      FROM weekly_stats
      WHERE (wins + losses) > 0
      ORDER BY (100.0 * wins / NULLIF(wins + losses, 0)) DESC, signals DESC
      LIMIT 10
    `;

    if (bestPeriods.length > 0) {
      console.table(bestPeriods.map(p => ({
        week: p.week_start,
        signals: p.signals,
        wins: p.wins,
        losses: p.losses,
        win_rate: `${p.win_rate}%`,
        version: p.strategy_version
      })));
    } else {
      console.log('❌ No periods with 5+ completed signals found');
    }
    console.log('');

    // Query 4: Recent performance (last 30 days)
    console.log('📊 QUERY 4: Recent Performance (Last 30 Days)');
    console.log('-'.repeat(100));

    const recentPerf = await db`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 1) as win_rate
      FROM signal_history
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `;

    console.log(`Total Signals: ${recentPerf[0].total_signals}`);
    console.log(`Wins: ${recentPerf[0].wins}`);
    console.log(`Losses: ${recentPerf[0].losses}`);
    console.log(`Pending: ${recentPerf[0].pending}`);
    console.log(`Win Rate: ${recentPerf[0].win_rate || 'N/A'}%`);
    console.log('');

    // Query 5: Total signals in database
    console.log('📊 QUERY 5: Database Overview');
    console.log('-'.repeat(100));

    const overview = await db`
      SELECT
        COUNT(*) as total_all_time,
        COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        MIN(created_at) as oldest_signal,
        MAX(created_at) as newest_signal
      FROM signal_history
    `;

    console.log(`Total Signals (All Time): ${overview[0].total_all_time}`);
    console.log(`Completed: ${overview[0].completed}`);
    console.log(`Pending: ${overview[0].pending}`);
    console.log(`Oldest Signal: ${overview[0].oldest_signal ? new Date(overview[0].oldest_signal).toISOString().split('T')[0] : 'N/A'}`);
    console.log(`Newest Signal: ${overview[0].newest_signal ? new Date(overview[0].newest_signal).toISOString().split('T')[0] : 'N/A'}`);
    console.log('');

    console.log('='.repeat(100));
    console.log('✅ Analysis complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

analyzeProfitabilityHistory();

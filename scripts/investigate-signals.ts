import 'dotenv/config';
/**
 * INVESTIGATION SCRIPT - Why No Signals Since Jan 3?
 * Deep dive into signal generation status
 */

import postgres from 'postgres';

const client = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  connect_timeout: 10,
});

async function investigateSignals() {
  console.log('🔍 INVESTIGATING SIGNAL GENERATION');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Query 1: Most recent signals (any date)
    console.log('📊 QUERY 1: Most Recent Signals in Database');
    console.log('-'.repeat(100));
    const recentSignals = await client`
      SELECT
        signal_id,
        symbol,
        type,
        created_at,
        outcome,
        trade_live,
        tier
      FROM signal_history
      ORDER BY created_at DESC
      LIMIT 10
    `;

    if (recentSignals.length > 0) {
      console.log('Most recent 10 signals:');
      console.table(recentSignals.map(s => ({
        id: s.signal_id.substring(0, 8),
        symbol: s.symbol,
        type: s.type,
        tier: s.tier,
        live: s.trade_live ? '✅' : '❌',
        outcome: s.outcome,
        created: new Date(s.created_at).toISOString().slice(0, 19).replace('T', ' ')
      })));

      const mostRecent = recentSignals[0];
      const daysSinceLastSignal = (Date.now() - new Date(mostRecent.created_at).getTime()) / (1000 * 60 * 60 * 24);
      console.log(`\n⚠️  LAST SIGNAL WAS ${daysSinceLastSignal.toFixed(1)} DAYS AGO!`);
      console.log(`   Last signal date: ${new Date(mostRecent.created_at).toISOString()}`);
    } else {
      console.log('❌ NO SIGNALS FOUND IN DATABASE AT ALL!');
    }
    console.log('');

    // Query 2: Signal count by date (last 30 days)
    console.log('📊 QUERY 2: Signals Per Day (Last 30 Days)');
    console.log('-'.repeat(100));
    const signalsByDay = await client`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE trade_live = true) as live_trades
      FROM signal_history
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    if (signalsByDay.length > 0) {
      console.table(signalsByDay.map(s => ({
        date: s.date.toISOString().split('T')[0],
        total: s.total,
        live: s.live_trades
      })));
    } else {
      console.log('❌ NO SIGNALS IN LAST 30 DAYS!');
    }
    console.log('');

    // Query 3: Check specific date ranges
    console.log('📊 QUERY 3: Signal Counts by Date Range');
    console.log('-'.repeat(100));

    const ranges = await client`
      SELECT
        'Before Jan 1, 2026' as period,
        COUNT(*) as count
      FROM signal_history
      WHERE created_at < '2026-01-01'::timestamp
      UNION ALL
      SELECT
        'Jan 1-3, 2026' as period,
        COUNT(*) as count
      FROM signal_history
      WHERE created_at >= '2026-01-01'::timestamp
        AND created_at < '2026-01-03 01:44:10'::timestamp
      UNION ALL
      SELECT
        'After Jan 3, 2026 (Post 3.0x ATR)' as period,
        COUNT(*) as count
      FROM signal_history
      WHERE created_at >= '2026-01-03 01:44:10'::timestamp
      UNION ALL
      SELECT
        'Last 7 days' as period,
        COUNT(*) as count
      FROM signal_history
      WHERE created_at >= NOW() - INTERVAL '7 days'
      UNION ALL
      SELECT
        'Last 24 hours' as period,
        COUNT(*) as count
      FROM signal_history
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `;

    console.table(ranges);
    console.log('');

    // Query 4: Database current time
    console.log('📊 QUERY 4: Database vs System Time');
    console.log('-'.repeat(100));
    const times = await client`
      SELECT
        NOW() as db_time,
        CURRENT_DATE as db_date
    `;
    console.log(`   Database Time: ${times[0].db_time}`);
    console.log(`   Database Date: ${times[0].db_date}`);
    console.log(`   System Time:   ${new Date().toISOString()}`);
    console.log('');

    console.log('='.repeat(100));
    console.log('✅ Investigation complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await client.end();
    process.exit(0);
  }
}

investigateSignals();

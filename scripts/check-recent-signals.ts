import 'dotenv/config';
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  connect_timeout: 10,
});

async function checkRecentSignals() {
  console.log('🔍 CHECKING RECENT SIGNALS (After Critical Fixes Deployment)');
  console.log('='.repeat(80));

  try {
    // Check when Critical Fixes were deployed
    console.log('\n📅 Critical Fixes deployed: ~2026-01-13 (commit c620d8a)');
    console.log('   We need to see NEW signals generated AFTER this date\n');

    // Get most recent 10 signals
    const recentSignals = await db`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        outcome,
        trade_live,
        created_at
      FROM signal_history
      ORDER BY created_at DESC
      LIMIT 15
    `;

    console.log('📊 MOST RECENT 15 SIGNALS:\n');
    console.log('Date/Time             | Symbol   | Type  | Conf | Outcome    | Live');
    console.log('-'.repeat(80));

    recentSignals.forEach(s => {
      const date = new Date(s.created_at).toISOString().replace('T', ' ').slice(0, 19);
      const symbol = s.symbol.padEnd(8);
      const type = s.type.padEnd(5);
      const conf = (s.confidence + '%').padStart(4);
      const outcome = (s.outcome || 'PENDING').padEnd(10);
      const live = s.trade_live ? '✅ YES' : '❌ NO';
      console.log(`${date} | ${symbol} | ${type} | ${conf} | ${outcome} | ${live}`);
    });

    // Count signals by date
    console.log('\n📊 SIGNALS BY DATE (Last 7 Days):\n');
    const byDate = await db`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
          2
        ) as win_rate
      FROM signal_history
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    if (byDate.length > 0) {
      console.log('Date       | Signals | Wins | Losses | Win Rate');
      console.log('-'.repeat(55));
      byDate.forEach(d => {
        const date = d.date.toISOString().slice(0, 10);
        console.log(`${date} | ${String(d.total).padStart(7)} | ${String(d.wins || 0).padStart(4)} | ${String(d.losses || 0).padStart(6)} | ${d.win_rate || 'N/A'}%`);
      });
    } else {
      console.log('No signals in last 7 days');
    }

    // Check pending signals (not yet resolved)
    const pending = await db`
      SELECT COUNT(*) as count
      FROM signal_history
      WHERE outcome = 'PENDING'
    `;
    console.log(`\n⏳ Pending signals (awaiting outcome): ${pending[0]?.count || 0}`);

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📋 SUMMARY:');
    console.log('');
    console.log('   If you see signals from 2026-01-13 or later:');
    console.log('   → Critical Fixes #1 & #2 are ACTIVE');
    console.log('   → Wait for outcomes to resolve (24-48 hours per signal)');
    console.log('   → Expected: New signals should have 55-65% win rate');
    console.log('');
    console.log('   If no new signals since 2026-01-13:');
    console.log('   → Signal generator may be filtering everything (too strict)');
    console.log('   → Check Render logs for rejection messages');
    console.log('');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await db.end();
    process.exit(0);
  }
}

checkRecentSignals();

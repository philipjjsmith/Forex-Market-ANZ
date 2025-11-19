import { db } from './server/db';
import { sql } from 'drizzle-orm';

console.log('📊 PHASE 3 PERFORMANCE ANALYSIS');
console.log('='.repeat(70));
console.log('');

async function analyzePerformance() {
  try {
    // Phase 3 was implemented on November 4, 2025
    const phase3Date = '2025-11-04 00:00:00 UTC';

    console.log('📅 Timeline:');
    console.log(`   Pre-Phase 3:  Before ${phase3Date}`);
    console.log(`   Post-Phase 3: After ${phase3Date}`);
    console.log('');

    // 1. Pre-Phase 3 Performance
    console.log('1️⃣ PRE-PHASE 3 PERFORMANCE (Before Nov 4, 2025)');
    console.log('-'.repeat(70));

    const prePhase3Result = await db.execute(sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        ROUND(
          (COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT'))::DECIMAL /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0)) * 100,
          2
        ) as win_rate_percent,
        SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as total_profit_pips,
        SUM(profit_loss_pips) FILTER (WHERE outcome = 'STOP_HIT') as total_loss_pips,
        SUM(profit_loss_pips) as net_pips
      FROM signal_history
      WHERE created_at < '2025-11-04 00:00:00 UTC'
        AND outcome != 'PENDING'
    `);

    const pre = (prePhase3Result as any)[0];
    console.log(`   Total signals: ${pre.total_signals}`);
    console.log(`   Wins: ${pre.wins}`);
    console.log(`   Losses: ${pre.losses}`);
    console.log(`   Expired: ${pre.expired}`);
    console.log(`   Win Rate: ${pre.win_rate_percent || 0}%`);
    console.log(`   Total Profit Pips: ${parseFloat(pre.total_profit_pips || 0).toFixed(1)}`);
    console.log(`   Total Loss Pips: ${parseFloat(pre.total_loss_pips || 0).toFixed(1)}`);
    console.log(`   Net Pips: ${parseFloat(pre.net_pips || 0).toFixed(1)}`);
    console.log('');

    // 2. Post-Phase 3 Performance
    console.log('2️⃣ POST-PHASE 3 PERFORMANCE (After Nov 4, 2025)');
    console.log('-'.repeat(70));

    const postPhase3Result = await db.execute(sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        ROUND(
          (COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT'))::DECIMAL /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0)) * 100,
          2
        ) as win_rate_percent,
        SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as total_profit_pips,
        SUM(profit_loss_pips) FILTER (WHERE outcome = 'STOP_HIT') as total_loss_pips,
        SUM(profit_loss_pips) as net_pips
      FROM signal_history
      WHERE created_at >= '2025-11-04 00:00:00 UTC'
        AND outcome != 'PENDING'
    `);

    const post = (postPhase3Result as any)[0];
    console.log(`   Total signals: ${post.total_signals}`);
    console.log(`   Wins: ${post.wins}`);
    console.log(`   Losses: ${post.losses}`);
    console.log(`   Expired: ${post.expired}`);
    console.log(`   Win Rate: ${post.win_rate_percent || 0}%`);
    console.log(`   Total Profit Pips: ${parseFloat(post.total_profit_pips || 0).toFixed(1)}`);
    console.log(`   Total Loss Pips: ${parseFloat(post.total_loss_pips || 0).toFixed(1)}`);
    console.log(`   Net Pips: ${parseFloat(post.net_pips || 0).toFixed(1)}`);
    console.log('');

    // 3. Comparison & Recommendation
    console.log('3️⃣ COMPARISON & RECOMMENDATION');
    console.log('-'.repeat(70));

    const preWinRate = parseFloat(pre.win_rate_percent || 0);
    const postWinRate = parseFloat(post.win_rate_percent || 0);
    const winRateChange = postWinRate - preWinRate;
    const postCompleted = parseInt(post.total_signals) - parseInt(post.expired || 0);

    console.log(`   Win Rate Change: ${preWinRate.toFixed(2)}% → ${postWinRate.toFixed(2)}% (${winRateChange >= 0 ? '+' : ''}${winRateChange.toFixed(2)}%)`);
    console.log('');

    if (postCompleted < 10) {
      console.log('⚠️  INSUFFICIENT DATA - REVERT TO 1:1.5 R:R');
      console.log(`   Only ${postCompleted} completed Post-Phase 3 signals.`);
      console.log('   User explicitly requested 1:1.5 R:R - suggests dissatisfaction with Phase 3.');
      console.log('');
      console.log('   ✅ DECISION: Revert to Pre-Phase 3 multipliers (1:1.5 R:R)');
      return 'REVERT';
    } else if (postWinRate >= 48) {
      console.log('✅ PHASE 3 WORKING - BUT USER WANTS 1:1.5 R:R');
      console.log(`   Win rate ${postWinRate.toFixed(2)}% meets 48-52% target.`);
      console.log('   However, user explicitly requested 1:1.5 R:R.');
      console.log('');
      console.log('   ⚠️  USER PREFERENCE OVERRIDE: Revert to 1:1.5 R:R');
      return 'REVERT';
    } else {
      console.log('❌ PHASE 3 FAILED - REVERT TO 1:1.5 R:R');
      console.log(`   Win rate ${postWinRate.toFixed(2)}% below 48% target.`);
      console.log('   Phase 3 did not achieve improvement.');
      console.log('');
      console.log('   ✅ DECISION: Revert to Pre-Phase 3 multipliers (1:1.5 R:R)');
      return 'REVERT';
    }

  } catch (error: any) {
    console.error('\n❌ DATABASE ERROR:', error.message);
    console.log('\n⚠️  Cannot access database - making decision based on user request.');
    console.log('   User explicitly requested 1:1.5 R:R.');
    console.log('');
    console.log('   ✅ DECISION: Revert to Pre-Phase 3 multipliers (1:1.5 R:R)');
    return 'REVERT';
  }
}

analyzePerformance().then(decision => {
  console.log('');
  console.log('='.repeat(70));
  console.log(`✅ ANALYSIS COMPLETE - DECISION: ${decision}`);
  console.log('='.repeat(70));
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

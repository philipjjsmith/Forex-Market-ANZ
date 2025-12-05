import postgres from 'postgres';
import { config } from 'dotenv';

config();

const sql = postgres(process.env.DATABASE_URL);

console.log('📊 PHASE 3 PERFORMANCE ANALYSIS');
console.log('='.repeat(70));
console.log('');

try {
  // Phase 3 was implemented on November 4, 2025
  const phase3Date = '2025-11-04 00:00:00 UTC';

  console.log('📅 Timeline:');
  console.log(`   Pre-Phase 3:  Before ${phase3Date}`);
  console.log(`   Post-Phase 3: After ${phase3Date}`);
  console.log('');

  // 1. Pre-Phase 3 Performance (Before Nov 4, 2025)
  console.log('1️⃣ PRE-PHASE 3 PERFORMANCE (Before Nov 4, 2025)');
  console.log('-'.repeat(70));

  const prePhase3 = await sql`
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
    WHERE created_at < ${phase3Date}
      AND outcome != 'PENDING'
  `;

  const pre = prePhase3[0];
  console.log(`   Total signals: ${pre.total_signals}`);
  console.log(`   Wins: ${pre.wins}`);
  console.log(`   Losses: ${pre.losses}`);
  console.log(`   Expired: ${pre.expired}`);
  console.log(`   Win Rate: ${pre.win_rate_percent || 0}%`);
  console.log(`   Total Profit Pips: ${parseFloat(pre.total_profit_pips || 0).toFixed(1)}`);
  console.log(`   Total Loss Pips: ${parseFloat(pre.total_loss_pips || 0).toFixed(1)}`);
  console.log(`   Net Pips: ${parseFloat(pre.net_pips || 0).toFixed(1)}`);
  console.log('');

  // 2. Post-Phase 3 Performance (After Nov 4, 2025)
  console.log('2️⃣ POST-PHASE 3 PERFORMANCE (After Nov 4, 2025)');
  console.log('-'.repeat(70));

  const postPhase3 = await sql`
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
    WHERE created_at >= ${phase3Date}
      AND outcome != 'PENDING'
  `;

  const post = postPhase3[0];
  console.log(`   Total signals: ${post.total_signals}`);
  console.log(`   Wins: ${post.wins}`);
  console.log(`   Losses: ${post.losses}`);
  console.log(`   Expired: ${post.expired}`);
  console.log(`   Win Rate: ${post.win_rate_percent || 0}%`);
  console.log(`   Total Profit Pips: ${parseFloat(post.total_profit_pips || 0).toFixed(1)}`);
  console.log(`   Total Loss Pips: ${parseFloat(post.total_loss_pips || 0).toFixed(1)}`);
  console.log(`   Net Pips: ${parseFloat(post.net_pips || 0).toFixed(1)}`);
  console.log('');

  // 3. Comparison & Analysis
  console.log('3️⃣ COMPARISON & ANALYSIS');
  console.log('-'.repeat(70));

  const preWinRate = parseFloat(pre.win_rate_percent || 0);
  const postWinRate = parseFloat(post.win_rate_percent || 0);
  const winRateChange = postWinRate - preWinRate;

  const preNetPips = parseFloat(pre.net_pips || 0);
  const postNetPips = parseFloat(post.net_pips || 0);

  console.log(`   Win Rate Change: ${preWinRate.toFixed(2)}% → ${postWinRate.toFixed(2)}% (${winRateChange >= 0 ? '+' : ''}${winRateChange.toFixed(2)}%)`);
  console.log(`   Net Pips Change: ${preNetPips.toFixed(1)} → ${postNetPips.toFixed(1)}`);
  console.log('');

  // 4. Recommendation
  console.log('4️⃣ RECOMMENDATION');
  console.log('-'.repeat(70));
  console.log('');

  // Need at least 10 completed signals for statistical significance
  const postCompleted = parseInt(post.total_signals) - parseInt(post.expired || 0);

  if (postCompleted < 10) {
    console.log('⚠️  INSUFFICIENT DATA FOR DECISION');
    console.log('');
    console.log(`   Post-Phase 3 has only ${postCompleted} completed signals.`);
    console.log('   Need at least 10 completed signals for statistical confidence.');
    console.log('');
    console.log('   RECOMMENDATION: Keep Phase 3 settings (1:1 R:R) for now.');
    console.log('   Reason: Not enough data to judge if Phase 3 failed.');
    console.log('');
    console.log('   ✅ ACTION: Keep current ATR multipliers:');
    console.log('      - TP1: 2.0× ATR (1:1 R:R)');
    console.log('      - TP2: 4.0× ATR (2:1 R:R)');
    console.log('      - TP3: 8.0× ATR (4:1 R:R)');
  } else if (postWinRate >= 48) {
    console.log('✅ PHASE 3 IS WORKING - KEEP CURRENT SETTINGS');
    console.log('');
    console.log(`   Post-Phase 3 win rate: ${postWinRate.toFixed(2)}% (Target: 48-52%)`);
    console.log(`   Improvement: ${winRateChange >= 0 ? '+' : ''}${winRateChange.toFixed(2)}%`);
    console.log('');
    console.log('   Phase 3 achieved its goal of improving win rate.');
    console.log('   Closer targets (1:1 R:R) are easier to hit and working well.');
    console.log('');
    console.log('   ✅ ACTION: Keep current ATR multipliers:');
    console.log('      - TP1: 2.0× ATR (1:1 R:R)');
    console.log('      - TP2: 4.0× ATR (2:1 R:R)');
    console.log('      - TP3: 8.0× ATR (4:1 R:R)');
  } else if (postWinRate >= preWinRate && postWinRate >= 40) {
    console.log('⚡ PHASE 3 IMPROVED PERFORMANCE - KEEP CURRENT SETTINGS');
    console.log('');
    console.log(`   Post-Phase 3 win rate: ${postWinRate.toFixed(2)}% (Not at 48% target yet)`);
    console.log(`   Improvement: ${winRateChange >= 0 ? '+' : ''}${winRateChange.toFixed(2)}%`);
    console.log('');
    console.log('   Phase 3 is improving win rate (moving in right direction).');
    console.log('   Give it more time to reach 48-52% target.');
    console.log('');
    console.log('   ✅ ACTION: Keep current ATR multipliers:');
    console.log('      - TP1: 2.0× ATR (1:1 R:R)');
    console.log('      - TP2: 4.0× ATR (2:1 R:R)');
    console.log('      - TP3: 8.0× ATR (4:1 R:R)');
  } else {
    console.log('❌ PHASE 3 DID NOT IMPROVE - REVERT TO 1.5:1 R:R');
    console.log('');
    console.log(`   Post-Phase 3 win rate: ${postWinRate.toFixed(2)}% (Target was 48-52%)`);
    console.log(`   Change: ${winRateChange >= 0 ? '+' : ''}${winRateChange.toFixed(2)}%`);
    console.log('');
    console.log('   Phase 3 did not achieve improvement in win rate.');
    console.log('   Closer targets (1:1 R:R) are not helping.');
    console.log('');
    console.log('   ❌ ACTION: Revert to Pre-Phase 3 ATR multipliers:');
    console.log('      - TP1: 3.0× ATR (1.5:1 R:R)');
    console.log('      - TP2: 6.0× ATR (3:1 R:R)');
    console.log('      - TP3: 12.0× ATR (6:1 R:R)');
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('✅ ANALYSIS COMPLETE');
  console.log('='.repeat(70));

} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error('Stack:', error.stack);
} finally {
  await sql.end();
}

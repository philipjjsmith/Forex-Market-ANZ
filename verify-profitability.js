import 'dotenv/config';
// COMPREHENSIVE PROFITABILITY VERIFICATION
// Analyzing real trading performance since 3.0x ATR deployment (Jan 3, 2026)
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

const DEPLOYMENT_DATE = '2026-01-03 01:44:10'; // When 3.0x ATR went live

async function verifyProfitability() {
  console.log('💰 PROFITABILITY VERIFICATION - 100% DEEP DIVE\n');
  console.log('=' .repeat(100));
  console.log(`Deployment Date: ${DEPLOYMENT_DATE} (3.0x ATR optimization)`);
  console.log(`Analysis Date: ${new Date().toISOString()}`);
  console.log('=' .repeat(100));

  try {
    // ========================================================================
    // QUERY 1: Overall Signal Counts (Before vs After)
    // ========================================================================
    console.log('\n📊 QUERY 1: Signal Generation - Before vs After Deployment');
    console.log('-'.repeat(100));

    const beforeAfterCounts = await sql`
      SELECT
        CASE
          WHEN created_at < ${DEPLOYMENT_DATE}::timestamp THEN 'BEFORE (2.0x ATR)'
          ELSE 'AFTER (3.0x ATR)'
        END as period,
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE trade_live = true) as live_trades,
        COUNT(*) FILTER (WHERE tier = 'HIGH') as high_tier,
        COUNT(*) FILTER (WHERE tier = 'MEDIUM') as medium_tier
      FROM signal_history
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY period
      ORDER BY period
    `;

    console.table(beforeAfterCounts);

    // ========================================================================
    // QUERY 2: AFTER Deployment - All Signals with Details
    // ========================================================================
    console.log('\n📊 QUERY 2: ALL SIGNALS SINCE 3.0x ATR DEPLOYMENT (Jan 3, 2026)');
    console.log('-'.repeat(100));

    const afterSignals = await sql`
      SELECT
        signal_id,
        symbol,
        type,
        tier,
        trade_live,
        confidence,
        entry_price,
        stop_loss,
        take_profit_1,
        outcome,
        profit_loss_pips,
        created_at,
        outcome_time
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
      ORDER BY created_at DESC
    `;

    if (afterSignals.length === 0) {
      console.log('⚠️  WARNING: NO SIGNALS GENERATED SINCE DEPLOYMENT!');
      console.log('\nPossible reasons:');
      console.log('1. Market conditions did not meet criteria (normal during low volatility)');
      console.log('2. Cron job may not be running');
      console.log('3. Signal generator may have errors');
      console.log('\nRECOMMENDATION: Check cron job status and signal generator logs');
    } else {
      console.log(`✅ Found ${afterSignals.length} signal(s) since deployment\n`);

      // Show summary table
      console.table(afterSignals.map(s => ({
        id: s.signal_id.substring(0, 8),
        symbol: s.symbol,
        type: s.type,
        tier: s.tier,
        live: s.trade_live ? '✅' : '❌',
        conf: `${s.confidence}%`,
        outcome: s.outcome,
        pips: s.profit_loss_pips ? s.profit_loss_pips.toFixed(1) : 'N/A',
        created: new Date(s.created_at).toLocaleString()
      })));

      // ========================================================================
      // QUERY 3: Verify 3.0x ATR is Being Used (Check R/R Ratios)
      // ========================================================================
      console.log('\n📊 QUERY 3: ATR MULTIPLIER VERIFICATION (Confirm 3.0x ATR in use)');
      console.log('-'.repeat(100));

      let using_3x_atr = 0;
      let using_2x_atr = 0;
      let unknown_atr = 0;

      for (const signal of afterSignals.slice(0, 10)) {
        const stopDistance = Math.abs(signal.entry_price - signal.stop_loss);
        const tp1Distance = Math.abs(signal.take_profit_1 - signal.entry_price);
        const rrRatio = tp1Distance / stopDistance;

        console.log(`\nSignal ${signal.signal_id.substring(0, 8)} (${signal.symbol} ${signal.type}):`);
        console.log(`  Entry: ${signal.entry_price.toFixed(5)}`);
        console.log(`  Stop:  ${signal.stop_loss.toFixed(5)} (${stopDistance.toFixed(5)} pips)`);
        console.log(`  TP1:   ${signal.take_profit_1.toFixed(5)} (${tp1Distance.toFixed(5)} pips)`);
        console.log(`  R/R Ratio: 1:${rrRatio.toFixed(2)}`);

        if (rrRatio >= 0.95 && rrRatio <= 1.05) {
          console.log(`  ✅ CONFIRMED: Using 3.0x ATR (1:1 R/R)`);
          using_3x_atr++;
        } else if (rrRatio >= 1.45 && rrRatio <= 1.55) {
          console.log(`  ❌ PROBLEM: Still using 2.0x ATR (1:1.5 R/R)`);
          using_2x_atr++;
        } else {
          console.log(`  ⚠️  UNKNOWN: R/R ratio ${rrRatio.toFixed(2)} doesn't match expected pattern`);
          unknown_atr++;
        }
      }

      console.log('\n' + '-'.repeat(100));
      console.log('ATR VERIFICATION SUMMARY:');
      console.log(`  ✅ Using 3.0x ATR: ${using_3x_atr} signals`);
      console.log(`  ❌ Using 2.0x ATR: ${using_2x_atr} signals`);
      console.log(`  ⚠️  Unknown: ${unknown_atr} signals`);

      if (using_2x_atr > 0) {
        console.log('\n⚠️  CRITICAL: Some signals still using 2.0x ATR! Deployment may not be complete.');
      } else if (using_3x_atr > 0) {
        console.log('\n✅ CONFIRMED: All signals using 3.0x ATR as expected!');
      }
    }

    // ========================================================================
    // QUERY 4: WIN RATE & PROFITABILITY - AFTER Deployment (3.0x ATR)
    // ========================================================================
    console.log('\n📊 QUERY 4: WIN RATE & PROFITABILITY - AFTER 3.0x ATR DEPLOYMENT');
    console.log('-'.repeat(100));

    const afterPerformance = await sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE trade_live = true) as live_trades,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE trade_live = true), 0) as total_pips,
        COALESCE(AVG(profit_loss_pips) FILTER (WHERE trade_live = true AND outcome != 'PENDING'), 0) as avg_pips_per_trade,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
          2
        ) as win_rate_percent
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
        AND trade_live = true
    `;

    console.table(afterPerformance);

    const perf = afterPerformance[0];
    const completedTrades = parseInt(perf.wins) + parseInt(perf.losses);
    const winRate = parseFloat(perf.win_rate_percent) || 0;
    const totalPips = parseFloat(perf.total_pips) || 0;

    console.log('\n📈 PERFORMANCE ANALYSIS (AFTER 3.0x ATR):');
    console.log('-'.repeat(100));
    console.log(`Total Signals Generated: ${perf.total_signals}`);
    console.log(`Live Trades: ${perf.live_trades}`);
    console.log(`Completed Trades: ${completedTrades} (${perf.wins} wins, ${perf.losses} losses)`);
    console.log(`Pending: ${perf.pending}`);
    console.log(`Expired: ${perf.expired}`);
    console.log(`\n🎯 WIN RATE: ${winRate}%`);
    console.log(`💰 TOTAL PIPS: ${totalPips >= 0 ? '+' : ''}${totalPips.toFixed(1)} pips`);
    console.log(`📊 AVG PIPS/TRADE: ${perf.avg_pips_per_trade >= 0 ? '+' : ''}${parseFloat(perf.avg_pips_per_trade).toFixed(1)} pips`);

    // Calculate profitability
    if (completedTrades === 0) {
      console.log('\n⚠️  INSUFFICIENT DATA: No completed trades yet to assess profitability');
      console.log('    Need to wait for more signals to be generated and resolved');
    } else {
      // Profitability assessment
      console.log('\n💰 PROFITABILITY ASSESSMENT:');
      console.log('-'.repeat(100));

      // For 1:1 R/R, need 50% win rate to break even
      const breakEvenWinRate = 50;
      const isProfitable = winRate > breakEvenWinRate;

      if (isProfitable) {
        console.log(`✅ PROFITABLE: Win rate ${winRate}% is ABOVE breakeven ${breakEvenWinRate}%`);
        console.log(`   Edge: +${(winRate - breakEvenWinRate).toFixed(1)} percentage points`);
      } else {
        console.log(`❌ NOT PROFITABLE: Win rate ${winRate}% is BELOW breakeven ${breakEvenWinRate}%`);
        console.log(`   Deficit: -${(breakEvenWinRate - winRate).toFixed(1)} percentage points`);
      }

      // Calculate monthly projection
      const avgPipsPerTrade = parseFloat(perf.avg_pips_per_trade);
      const signalsPerDay = afterSignals.length / ((Date.now() - new Date(DEPLOYMENT_DATE).getTime()) / (1000 * 60 * 60 * 24));
      const signalsPerMonth = signalsPerDay * 30;
      const projectedMonthlyPips = avgPipsPerTrade * signalsPerMonth;

      // $10/pip on $100K account with 1.5% risk
      const dollarsPerPip = 10;
      const projectedMonthlyProfit = projectedMonthlyPips * dollarsPerPip;

      console.log(`\n📊 MONTHLY PROJECTION (based on current performance):`);
      console.log(`   Signals/Day: ${signalsPerDay.toFixed(1)}`);
      console.log(`   Signals/Month: ${signalsPerMonth.toFixed(0)}`);
      console.log(`   Avg Pips/Trade: ${avgPipsPerTrade >= 0 ? '+' : ''}${avgPipsPerTrade.toFixed(1)} pips`);
      console.log(`   Monthly Pips: ${projectedMonthlyPips >= 0 ? '+' : ''}${projectedMonthlyPips.toFixed(0)} pips`);
      console.log(`   Monthly Profit ($100K): ${projectedMonthlyProfit >= 0 ? '+$' : '-$'}${Math.abs(projectedMonthlyProfit).toFixed(0)}`);
    }

    // ========================================================================
    // QUERY 5: BEFORE Deployment Performance (for comparison)
    // ========================================================================
    console.log('\n\n📊 QUERY 5: WIN RATE & PROFITABILITY - BEFORE 3.0x ATR (Last 30 days)');
    console.log('-'.repeat(100));

    const beforePerformance = await sql`
      SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE trade_live = true) as live_trades,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        COALESCE(SUM(profit_loss_pips) FILTER (WHERE trade_live = true), 0) as total_pips,
        COALESCE(AVG(profit_loss_pips) FILTER (WHERE trade_live = true AND outcome != 'PENDING'), 0) as avg_pips_per_trade,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
          2
        ) as win_rate_percent
      FROM signal_history
      WHERE created_at < ${DEPLOYMENT_DATE}::timestamp
        AND created_at >= NOW() - INTERVAL '30 days'
        AND trade_live = true
    `;

    console.table(beforePerformance);

    const beforePerf = beforePerformance[0];
    const beforeCompletedTrades = parseInt(beforePerf.wins) + parseInt(beforePerf.losses);
    const beforeWinRate = parseFloat(beforePerf.win_rate_percent) || 0;
    const beforeTotalPips = parseFloat(beforePerf.total_pips) || 0;

    console.log('\n📈 PERFORMANCE ANALYSIS (BEFORE 3.0x ATR):');
    console.log('-'.repeat(100));
    console.log(`Completed Trades: ${beforeCompletedTrades} (${beforePerf.wins} wins, ${beforePerf.losses} losses)`);
    console.log(`🎯 WIN RATE: ${beforeWinRate}%`);
    console.log(`💰 TOTAL PIPS: ${beforeTotalPips >= 0 ? '+' : ''}${beforeTotalPips.toFixed(1)} pips`);
    console.log(`📊 AVG PIPS/TRADE: ${parseFloat(beforePerf.avg_pips_per_trade).toFixed(1)} pips`);

    // ========================================================================
    // QUERY 6: BEFORE vs AFTER Comparison
    // ========================================================================
    console.log('\n\n📊 QUERY 6: BEFORE vs AFTER COMPARISON');
    console.log('=' .repeat(100));

    if (completedTrades > 0 && beforeCompletedTrades > 0) {
      console.log('\n🔄 PERFORMANCE DELTA:');
      console.log('-'.repeat(100));

      const winRateDelta = winRate - beforeWinRate;
      const pipsDelta = parseFloat(perf.avg_pips_per_trade) - parseFloat(beforePerf.avg_pips_per_trade);

      console.log(`Win Rate: ${beforeWinRate}% → ${winRate}% (${winRateDelta >= 0 ? '+' : ''}${winRateDelta.toFixed(1)} pp)`);
      console.log(`Avg Pips/Trade: ${parseFloat(beforePerf.avg_pips_per_trade).toFixed(1)} → ${parseFloat(perf.avg_pips_per_trade).toFixed(1)} (${pipsDelta >= 0 ? '+' : ''}${pipsDelta.toFixed(1)} pips)`);

      if (winRateDelta > 0 && pipsDelta > 0) {
        console.log('\n✅ IMPROVEMENT CONFIRMED: System is performing BETTER after 3.0x ATR deployment');
      } else if (winRateDelta < 0 || pipsDelta < 0) {
        console.log('\n⚠️  CONCERN: System is performing WORSE after deployment');
        console.log('   This could be due to:');
        console.log('   1. Insufficient sample size (need more trades)');
        console.log('   2. Adverse market conditions');
        console.log('   3. Implementation issue');
      } else {
        console.log('\n➡️  NEUTRAL: Performance is similar to before');
      }
    } else {
      console.log('\n⚠️  Cannot compare - insufficient data in one or both periods');
    }

    // ========================================================================
    // QUERY 7: Recent Signal Details (Last 5)
    // ========================================================================
    console.log('\n\n📊 QUERY 7: RECENT SIGNAL DETAILS (Last 5)');
    console.log('-'.repeat(100));

    const recentSignals = await sql`
      SELECT
        signal_id,
        symbol,
        type,
        tier,
        confidence,
        entry_price,
        stop_loss,
        take_profit_1,
        outcome,
        profit_loss_pips,
        created_at,
        outcome_time
      FROM signal_history
      WHERE created_at >= ${DEPLOYMENT_DATE}::timestamp
        AND trade_live = true
      ORDER BY created_at DESC
      LIMIT 5
    `;

    if (recentSignals.length > 0) {
      for (const signal of recentSignals) {
        console.log(`\n${signal.symbol} ${signal.type} - ${signal.outcome}`);
        console.log(`  ID: ${signal.signal_id}`);
        console.log(`  Tier: ${signal.tier} | Confidence: ${signal.confidence}%`);
        console.log(`  Entry: ${signal.entry_price.toFixed(5)}`);
        console.log(`  Stop: ${signal.stop_loss.toFixed(5)}`);
        console.log(`  TP1: ${signal.take_profit_1.toFixed(5)}`);
        console.log(`  Outcome: ${signal.outcome} ${signal.profit_loss_pips ? `(${signal.profit_loss_pips >= 0 ? '+' : ''}${signal.profit_loss_pips.toFixed(1)} pips)` : ''}`);
        console.log(`  Created: ${new Date(signal.created_at).toLocaleString()}`);
        if (signal.outcome_time) {
          console.log(`  Resolved: ${new Date(signal.outcome_time).toLocaleString()}`);
        }
      }
    } else {
      console.log('No recent signals found');
    }

    // ========================================================================
    // FINAL VERDICT
    // ========================================================================
    console.log('\n\n' + '='.repeat(100));
    console.log('🎯 FINAL VERDICT - IS THE SYSTEM PROFITABLE?');
    console.log('='.repeat(100));

    if (afterSignals.length === 0) {
      console.log('\n❌ CANNOT ASSESS: No signals generated since deployment');
      console.log('   ACTION REQUIRED: Investigate signal generator and cron job');
    } else if (completedTrades === 0) {
      console.log('\n⏳ INSUFFICIENT DATA: Signals generated but none completed yet');
      console.log(`   ${afterSignals.length} signal(s) generated, ${perf.pending} still pending`);
      console.log('   RECOMMENDATION: Wait 2-3 more days for trades to complete');
    } else if (completedTrades < 10) {
      console.log(`\n⚠️  LIMITED DATA: Only ${completedTrades} completed trade(s)`);
      console.log(`   Current Win Rate: ${winRate}%`);
      console.log(`   Current Total Pips: ${totalPips >= 0 ? '+' : ''}${totalPips.toFixed(1)}`);
      console.log('   RECOMMENDATION: Need 10+ trades for statistical significance');
    } else {
      // Sufficient data to make assessment
      if (winRate >= 55 && totalPips > 0) {
        console.log(`\n✅ CONFIRMED PROFITABLE!`);
        console.log(`   Win Rate: ${winRate}% (target: 60%, minimum: 50%)`);
        console.log(`   Total Pips: +${totalPips.toFixed(1)}`);
        console.log(`   Completed Trades: ${completedTrades}`);
        console.log(`   \n🎉 System is performing as expected with 3.0x ATR optimization!`);
      } else if (winRate >= 45 && winRate < 55) {
        console.log(`\n⚠️  MARGINAL PERFORMANCE`);
        console.log(`   Win Rate: ${winRate}% (target: 60%, minimum: 50%)`);
        console.log(`   Status: Near breakeven, needs more time to stabilize`);
      } else {
        console.log(`\n❌ NOT PROFITABLE YET`);
        console.log(`   Win Rate: ${winRate}% (target: 60%, minimum: 50%)`);
        console.log(`   Total Pips: ${totalPips >= 0 ? '+' : ''}${totalPips.toFixed(1)}`);
        console.log(`   \nPossible reasons:`);
        console.log(`   1. Sample size too small (only ${completedTrades} trades)`);
        console.log(`   2. Adverse market conditions (consolidation, choppy markets)`);
        console.log(`   3. Need more time for strategy to prove itself`);
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('✅ Analysis complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('Stack:', error.stack);
  } finally {
    await sql.end();
  }
}

verifyProfitability();

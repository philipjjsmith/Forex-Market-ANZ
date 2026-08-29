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

const DEPLOYMENT_DATE = '2026-01-03 01:44:10'; // 3.0x ATR deployment timestamp

async function verify3xATRProfitability() {
  console.log('💰 3.0x ATR PROFITABILITY VERIFICATION - COMPLETE DEEP DIVE');
  console.log('='.repeat(100));
  console.log(`Deployment Date: ${DEPLOYMENT_DATE} (3.0x ATR optimization deployed)`);
  console.log(`Analysis Date: ${new Date().toISOString()}`);
  console.log(`Days Since Deployment: ${((Date.now() - new Date(DEPLOYMENT_DATE).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)}`);
  console.log('='.repeat(100));
  console.log('');

  try {
    // ============================================================================
    // QUERY 1: Before vs After - Signal Count
    // ============================================================================
    console.log('📊 QUERY 1: Signal Generation - BEFORE vs AFTER Deployment');
    console.log('-'.repeat(100));

    const beforeAfterCount = await client`
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

    console.log('Period              | Total | Live Trades | HIGH Tier | MEDIUM Tier');
    console.log('-'.repeat(100));
    for (const row of beforeAfterCount) {
      console.log(
        `${row.period.padEnd(19)} | ${String(row.total_signals).padEnd(5)} | ${String(row.live_trades).padEnd(11)} | ${String(row.high_tier).padEnd(9)} | ${row.medium_tier}`
      );
    }
    console.log('');

    // ============================================================================
    // QUERY 2: AFTER Deployment - All Signals (Detailed)
    // ============================================================================
    console.log('📊 QUERY 2: ALL SIGNALS SINCE 3.0x ATR DEPLOYMENT');
    console.log('-'.repeat(100));

    const afterSignals = await client`
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

    console.log(`✅ Found ${afterSignals.length} signal(s) generated since deployment\n`);

    if (afterSignals.length === 0) {
      console.log('⚠️  WARNING: NO SIGNALS GENERATED SINCE DEPLOYMENT!');
      console.log('');
      console.log('Possible reasons:');
      console.log('1. Market conditions have not met signal criteria (normal during low volatility)');
      console.log('2. Cron job may not be executing properly');
      console.log('3. Signal generator may have errors');
      console.log('');
      console.log('RECOMMENDATION: Check cron job logs and signal generator status');
      console.log('');
    } else {
      // Display all signals
      console.log('ID       | Symbol   | Type  | Tier   | Live | Conf | Outcome    | Pips    | Created');
      console.log('-'.repeat(100));
      for (const s of afterSignals) {
        const id = s.signal_id.substring(0, 8);
        const pips = s.profit_loss_pips !== null ? String(s.profit_loss_pips.toFixed(1)).padStart(7) : '   N/A ';
        const created = new Date(s.created_at).toISOString().slice(0, 16).replace('T', ' ');
        console.log(
          `${id} | ${s.symbol.padEnd(8)} | ${s.type.padEnd(5)} | ${s.tier.padEnd(6)} | ${s.trade_live ? '✅  ' : '❌  '} | ${String(s.confidence).padEnd(4)} | ${s.outcome.padEnd(10)} | ${pips} | ${created}`
        );
      }
      console.log('');

      // ============================================================================
      // QUERY 3: Verify 3.0x ATR Usage (R/R Ratio Analysis)
      // ============================================================================
      console.log('📊 QUERY 3: ATR MULTIPLIER VERIFICATION (R/R Ratio Analysis)');
      console.log('-'.repeat(100));
      console.log('Analyzing stop loss to TP1 ratios to confirm 3.0x ATR is being used...');
      console.log('');

      let using_3x_count = 0;
      let using_2x_count = 0;
      let unknown_count = 0;

      const samplesToCheck = Math.min(afterSignals.length, 10);
      console.log(`Checking ${samplesToCheck} signal(s):\n`);

      for (const signal of afterSignals.slice(0, samplesToCheck)) {
        const stopDistance = Math.abs(signal.entry_price - signal.stop_loss);
        const tp1Distance = Math.abs(signal.take_profit_1 - signal.entry_price);
        const rrRatio = tp1Distance / stopDistance;

        console.log(`Signal ${signal.signal_id.substring(0, 8)} (${signal.symbol} ${signal.type}):`);
        console.log(`  Entry:      ${signal.entry_price.toFixed(5)}`);
        console.log(`  Stop Loss:  ${signal.stop_loss.toFixed(5)} (distance: ${stopDistance.toFixed(5)})`);
        console.log(`  TP1:        ${signal.take_profit_1.toFixed(5)} (distance: ${tp1Distance.toFixed(5)})`);
        console.log(`  R/R Ratio:  1:${rrRatio.toFixed(2)}`);

        if (rrRatio >= 0.95 && rrRatio <= 1.05) {
          console.log(`  ✅ CONFIRMED: Using 3.0x ATR (1:1 R/R)`);
          using_3x_count++;
        } else if (rrRatio >= 1.45 && rrRatio <= 1.55) {
          console.log(`  ❌ PROBLEM: Still using 2.0x ATR (1:1.5 R/R)`);
          using_2x_count++;
        } else {
          console.log(`  ⚠️  UNKNOWN: R/R ratio doesn't match expected pattern`);
          unknown_count++;
        }
        console.log('');
      }

      console.log('-'.repeat(100));
      console.log('ATR VERIFICATION SUMMARY:');
      console.log(`  ✅ Using 3.0x ATR: ${using_3x_count} signal(s)`);
      console.log(`  ❌ Using 2.0x ATR: ${using_2x_count} signal(s)`);
      console.log(`  ⚠️  Unknown:       ${unknown_count} signal(s)`);
      console.log('');

      if (using_2x_count > 0) {
        console.log('⚠️  CRITICAL WARNING: Some signals still using 2.0x ATR!');
        console.log('   Deployment may not be complete or code not properly deployed.');
        console.log('');
      } else if (using_3x_count > 0) {
        console.log('✅ DEPLOYMENT VERIFIED: All checked signals using 3.0x ATR!');
        console.log('');
      }
    }

    // ============================================================================
    // QUERY 4: AFTER Deployment - Win Rate & Profitability
    // ============================================================================
    console.log('📊 QUERY 4: PERFORMANCE AFTER 3.0x ATR DEPLOYMENT');
    console.log('-'.repeat(100));

    const afterPerformance = await client`
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

    const afterPerf = afterPerformance[0];
    const afterCompletedTrades = Number(afterPerf.wins) + Number(afterPerf.losses);
    const afterWinRate = Number(afterPerf.win_rate_percent) || 0;
    const afterTotalPips = Number(afterPerf.total_pips) || 0;
    const afterAvgPips = Number(afterPerf.avg_pips_per_trade) || 0;

    console.log(`Total Signals:     ${afterPerf.total_signals}`);
    console.log(`Live Trades:       ${afterPerf.live_trades}`);
    console.log(`Completed Trades:  ${afterCompletedTrades} (${afterPerf.wins} wins, ${afterPerf.losses} losses)`);
    console.log(`Pending:           ${afterPerf.pending}`);
    console.log(`Expired:           ${afterPerf.expired}`);
    console.log('');
    console.log(`🎯 WIN RATE:       ${afterWinRate}%`);
    console.log(`💰 TOTAL PIPS:     ${afterTotalPips >= 0 ? '+' : ''}${afterTotalPips.toFixed(1)} pips`);
    console.log(`📊 AVG PIPS/TRADE: ${afterAvgPips >= 0 ? '+' : ''}${afterAvgPips.toFixed(1)} pips`);
    console.log('');

    // Profitability assessment
    if (afterCompletedTrades === 0) {
      console.log('⚠️  INSUFFICIENT DATA: No completed trades yet');
      console.log('   Signals have been generated but none have resolved (hit TP or stop)');
      console.log('   This is normal for swing trading - trades take 24-72 hours to complete');
      console.log('');
    } else {
      const breakEvenWinRate = 50; // For 1:1 R/R
      const isProfitable = afterWinRate > breakEvenWinRate;

      console.log('💰 PROFITABILITY ASSESSMENT:');
      console.log('-'.repeat(100));

      if (isProfitable) {
        console.log(`✅ PROFITABLE: Win rate ${afterWinRate}% is ABOVE breakeven ${breakEvenWinRate}%`);
        console.log(`   Edge: +${(afterWinRate - breakEvenWinRate).toFixed(1)} percentage points`);
      } else {
        console.log(`❌ NOT PROFITABLE YET: Win rate ${afterWinRate}% is BELOW breakeven ${breakEvenWinRate}%`);
        console.log(`   Deficit: -${(breakEvenWinRate - afterWinRate).toFixed(1)} percentage points`);
      }
      console.log('');

      // Monthly projection
      const daysElapsed = (Date.now() - new Date(DEPLOYMENT_DATE).getTime()) / (1000 * 60 * 60 * 24);
      const signalsPerDay = Number(afterPerf.total_signals) / daysElapsed;
      const signalsPerMonth = signalsPerDay * 30;
      const projectedMonthlyPips = afterAvgPips * signalsPerMonth;
      const dollarsPerPip = 10; // $10/pip for $100K account
      const projectedMonthlyProfit = projectedMonthlyPips * dollarsPerPip;

      console.log('📊 MONTHLY PROJECTION (based on current data):');
      console.log('-'.repeat(100));
      console.log(`Days Elapsed:       ${daysElapsed.toFixed(1)} days`);
      console.log(`Signals/Day:        ${signalsPerDay.toFixed(2)} signals`);
      console.log(`Signals/Month:      ${signalsPerMonth.toFixed(0)} signals (estimated)`);
      console.log(`Avg Pips/Trade:     ${afterAvgPips >= 0 ? '+' : ''}${afterAvgPips.toFixed(1)} pips`);
      console.log(`Monthly Pips:       ${projectedMonthlyPips >= 0 ? '+' : ''}${projectedMonthlyPips.toFixed(0)} pips`);
      console.log(`Monthly Profit:     ${projectedMonthlyProfit >= 0 ? '+$' : '-$'}${Math.abs(projectedMonthlyProfit).toFixed(0)} ($100K account)`);
      console.log('');
    }

    // ============================================================================
    // QUERY 5: BEFORE Deployment - Performance (for comparison)
    // ============================================================================
    console.log('📊 QUERY 5: PERFORMANCE BEFORE 3.0x ATR DEPLOYMENT (Last 30 days)');
    console.log('-'.repeat(100));

    const beforePerformance = await client`
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

    const beforePerf = beforePerformance[0];
    const beforeCompletedTrades = Number(beforePerf.wins) + Number(beforePerf.losses);
    const beforeWinRate = Number(beforePerf.win_rate_percent) || 0;
    const beforeTotalPips = Number(beforePerf.total_pips) || 0;
    const beforeAvgPips = Number(beforePerf.avg_pips_per_trade) || 0;

    console.log(`Total Signals:     ${beforePerf.total_signals}`);
    console.log(`Live Trades:       ${beforePerf.live_trades}`);
    console.log(`Completed Trades:  ${beforeCompletedTrades} (${beforePerf.wins} wins, ${beforePerf.losses} losses)`);
    console.log(`Pending:           ${beforePerf.pending}`);
    console.log(`Expired:           ${beforePerf.expired}`);
    console.log('');
    console.log(`🎯 WIN RATE:       ${beforeWinRate}%`);
    console.log(`💰 TOTAL PIPS:     ${beforeTotalPips >= 0 ? '+' : ''}${beforeTotalPips.toFixed(1)} pips`);
    console.log(`📊 AVG PIPS/TRADE: ${beforeAvgPips >= 0 ? '+' : ''}${beforeAvgPips.toFixed(1)} pips`);
    console.log('');

    // ============================================================================
    // QUERY 6: BEFORE vs AFTER Comparison
    // ============================================================================
    console.log('📊 QUERY 6: BEFORE vs AFTER COMPARISON');
    console.log('='.repeat(100));
    console.log('');

    if (afterCompletedTrades > 0 && beforeCompletedTrades > 0) {
      const winRateDelta = afterWinRate - beforeWinRate;
      const pipsDelta = afterAvgPips - beforeAvgPips;
      const totalPipsDelta = afterTotalPips - beforeTotalPips;

      console.log('🔄 PERFORMANCE DELTA:');
      console.log('-'.repeat(100));
      console.log(`Win Rate:          ${beforeWinRate}% → ${afterWinRate}% (${winRateDelta >= 0 ? '+' : ''}${winRateDelta.toFixed(1)} pp)`);
      console.log(`Avg Pips/Trade:    ${beforeAvgPips.toFixed(1)} → ${afterAvgPips.toFixed(1)} (${pipsDelta >= 0 ? '+' : ''}${pipsDelta.toFixed(1)} pips)`);
      console.log(`Total Pips:        ${beforeTotalPips.toFixed(1)} → ${afterTotalPips.toFixed(1)} (${totalPipsDelta >= 0 ? '+' : ''}${totalPipsDelta.toFixed(1)} pips)`);
      console.log('');

      if (winRateDelta > 0 && pipsDelta > 0) {
        console.log('✅ IMPROVEMENT CONFIRMED: System is performing BETTER after 3.0x ATR deployment!');
        console.log('');
      } else if (winRateDelta < 0 || pipsDelta < 0) {
        console.log('⚠️  PERFORMANCE DECLINE: System is performing worse after deployment');
        console.log('   Possible causes:');
        console.log('   1. Sample size too small (statistical noise)');
        console.log('   2. Adverse market conditions (range-bound, choppy markets)');
        console.log('   3. Need more time for performance to stabilize');
        console.log('');
      } else {
        console.log('➡️  NEUTRAL: Performance similar to before deployment');
        console.log('');
      }
    } else if (beforeCompletedTrades === 0 && afterCompletedTrades === 0) {
      console.log('⚠️  Cannot compare - no completed trades in either period');
      console.log('');
    } else if (afterCompletedTrades === 0) {
      console.log('⚠️  Cannot compare - no completed trades after deployment yet');
      console.log(`   Before deployment had ${beforeCompletedTrades} completed trade(s)`);
      console.log('');
    } else {
      console.log('⚠️  Cannot compare - no completed trades before deployment');
      console.log('');
    }

    // ============================================================================
    // QUERY 7: Recent Signal Details
    // ============================================================================
    console.log('📊 QUERY 7: RECENT LIVE TRADES (Last 10 completed)');
    console.log('-'.repeat(100));

    const recentTrades = await client`
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
        AND outcome != 'PENDING'
      ORDER BY outcome_time DESC
      LIMIT 10
    `;

    if (recentTrades.length > 0) {
      console.log('');
      for (const trade of recentTrades) {
        const pips = trade.profit_loss_pips || 0;
        const hoursToResolve = trade.outcome_time && trade.created_at
          ? ((new Date(trade.outcome_time).getTime() - new Date(trade.created_at).getTime()) / (1000 * 60 * 60)).toFixed(1)
          : 'N/A';

        console.log(`${trade.symbol} ${trade.type} - ${trade.outcome}`);
        console.log(`  ID:         ${trade.signal_id.substring(0, 12)}`);
        console.log(`  Tier:       ${trade.tier} (${trade.confidence}% confidence)`);
        console.log(`  Entry:      ${trade.entry_price.toFixed(5)}`);
        console.log(`  Stop:       ${trade.stop_loss.toFixed(5)}`);
        console.log(`  TP1:        ${trade.take_profit_1.toFixed(5)}`);
        console.log(`  Result:     ${pips >= 0 ? '+' : ''}${pips.toFixed(1)} pips`);
        console.log(`  Created:    ${new Date(trade.created_at).toISOString().slice(0, 16).replace('T', ' ')}`);
        console.log(`  Resolved:   ${trade.outcome_time ? new Date(trade.outcome_time).toISOString().slice(0, 16).replace('T', ' ') : 'N/A'}`);
        console.log(`  Duration:   ${hoursToResolve} hours`);
        console.log('');
      }
    } else {
      console.log('No completed trades found since deployment');
      console.log('');
    }

    // ============================================================================
    // FINAL VERDICT
    // ============================================================================
    console.log('='.repeat(100));
    console.log('🎯 FINAL VERDICT - IS THE SYSTEM PROFITABLE?');
    console.log('='.repeat(100));
    console.log('');

    if (afterSignals.length === 0) {
      console.log('❌ CANNOT ASSESS: No signals generated since deployment');
      console.log('   ACTION REQUIRED: Investigate signal generator and cron job');
    } else if (afterCompletedTrades === 0) {
      console.log('⏳ INSUFFICIENT DATA: Signals generated but none completed yet');
      console.log(`   ${afterPerf.total_signals} signal(s) generated, ${afterPerf.pending} pending`);
      console.log('   RECOMMENDATION: Wait 2-3 more days for trades to complete');
      console.log('   Swing trades typically take 24-72 hours to reach TP or stop');
    } else if (afterCompletedTrades < 10) {
      console.log(`⚠️  LIMITED DATA: Only ${afterCompletedTrades} completed trade(s)`);
      console.log(`   Current Win Rate: ${afterWinRate}%`);
      console.log(`   Current Total Pips: ${afterTotalPips >= 0 ? '+' : ''}${afterTotalPips.toFixed(1)}`);
      console.log('   RECOMMENDATION: Need 10+ trades for statistical significance');
      console.log('   Current data may not be representative of true performance');
    } else {
      // Sufficient data for assessment
      if (afterWinRate >= 55 && afterTotalPips > 0) {
        console.log('✅ CONFIRMED PROFITABLE!');
        console.log('');
        console.log(`   Win Rate:       ${afterWinRate}% (target: 60%, minimum: 50%)`);
        console.log(`   Total Pips:     +${afterTotalPips.toFixed(1)}`);
        console.log(`   Avg Pips/Trade: +${afterAvgPips.toFixed(1)}`);
        console.log(`   Completed:      ${afterCompletedTrades} trades`);
        console.log('');
        console.log('🎉 System is performing as expected with 3.0x ATR optimization!');
      } else if (afterWinRate >= 45 && afterWinRate < 55) {
        console.log('⚠️  MARGINAL PERFORMANCE');
        console.log('');
        console.log(`   Win Rate: ${afterWinRate}% (target: 60%, minimum: 50%)`);
        console.log('   Status: Near breakeven, needs more time to stabilize');
        console.log('   Sample size may still be too small for conclusive assessment');
      } else {
        console.log('❌ NOT PROFITABLE YET');
        console.log('');
        console.log(`   Win Rate:  ${afterWinRate}% (target: 60%, minimum: 50%)`);
        console.log(`   Total Pips: ${afterTotalPips >= 0 ? '+' : ''}${afterTotalPips.toFixed(1)}`);
        console.log('');
        console.log('Possible reasons:');
        console.log(`   1. Sample size too small (only ${afterCompletedTrades} trades)`);
        console.log('   2. Adverse market conditions (consolidation, low volatility)');
        console.log('   3. Strategy needs more time to prove itself');
        console.log('   4. May need to investigate for implementation issues');
      }
    }

    console.log('');
    console.log('='.repeat(100));
    console.log('✅ Analysis complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('');
    console.error('❌ ERROR DURING ANALYSIS:');
    console.error(error);
    console.error('');
    if (error instanceof Error) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
  } finally {
    await client.end();
    process.exit(0);
  }
}

verify3xATRProfitability();

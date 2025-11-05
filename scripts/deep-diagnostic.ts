/**
 * Deep Diagnostic Script
 * Investigates GBP/USD filter and November win rate issues
 * Run with: npx tsx scripts/deep-diagnostic.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function runDeepDiagnostic() {
  console.log('🔬 DEEP DIAGNOSTIC ANALYSIS\n');
  console.log('=' .repeat(80));

  try {
    // ============================================================================
    // INVESTIGATION #1: GBP/USD FILTER VERIFICATION
    // ============================================================================
    console.log('\n📊 INVESTIGATION #1: GBP/USD FILTER VERIFICATION\n');
    console.log('Filter deployed: 2025-11-04 00:44:16 EST');
    console.log('Checking if GBP/USD signals were created before or after filter...\n');

    const gbpUsdSignals = await db.execute(sql`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        created_at,
        outcome_time,
        outcome,
        profit_loss_pips,
        strategy_version,
        EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600 as hours_to_resolve
      FROM signal_history
      WHERE symbol = 'GBP/USD'
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome != 'PENDING'
      ORDER BY created_at DESC
      LIMIT 100
    `);

    console.log(`Total GBP/USD signals found: ${gbpUsdSignals.length}\n`);

    // Analyze creation timestamps
    const filterDeployment = new Date('2025-11-04T00:44:16-05:00'); // EST
    let createdBefore = 0;
    let createdAfter = 0;

    for (const signal of gbpUsdSignals as any[]) {
      const createdAt = new Date(signal.created_at);
      if (createdAt < filterDeployment) {
        createdBefore++;
      } else {
        createdAfter++;
      }
    }

    console.log(`✅ Created BEFORE filter (< Nov 4 00:44:16): ${createdBefore}`);
    console.log(`❌ Created AFTER filter (>= Nov 4 00:44:16): ${createdAfter}\n`);

    if (createdAfter > 0) {
      console.log('🚨 WARNING: Found signals created AFTER filter deployment!\n');
      console.log('Recent GBP/USD signals created AFTER filter:');
      for (const signal of gbpUsdSignals as any[]) {
        const createdAt = new Date(signal.created_at);
        if (createdAt >= filterDeployment) {
          console.log(`  - ${signal.signal_id}: created ${signal.created_at}, outcome ${signal.outcome_time}`);
        }
      }
    } else {
      console.log('✅ CONFIRMED: All GBP/USD signals created BEFORE filter deployment');
      console.log('   Filter is working correctly!\n');
    }

    // Show sample with timing
    console.log('\nSample GBP/USD signals (first 10):');
    console.log('-'.repeat(120));
    console.log('Created At          | Outcome Time        | Hours to Resolve | Outcome   | Pips    | Version');
    console.log('-'.repeat(120));
    for (const signal of (gbpUsdSignals as any[]).slice(0, 10)) {
      console.log(
        `${signal.created_at.toISOString().slice(0, 19)} | ` +
        `${signal.outcome_time.toISOString().slice(0, 19)} | ` +
        `${parseFloat(signal.hours_to_resolve).toFixed(1).padStart(16)} | ` +
        `${signal.outcome.padEnd(9)} | ` +
        `${parseFloat(signal.profit_loss_pips).toFixed(1).padStart(7)} | ` +
        `${signal.strategy_version}`
      );
    }

    // ============================================================================
    // INVESTIGATION #2: NOVEMBER WIN RATE ANALYSIS
    // ============================================================================
    console.log('\n\n' + '='.repeat(80));
    console.log('\n📊 INVESTIGATION #2: NOVEMBER WIN RATE ANALYSIS\n');

    // Get November winners (sample 25)
    const novemberWinners = await db.execute(sql`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        outcome,
        profit_loss_pips,
        entry_price,
        stop_loss,
        tp1,
        indicators
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) = '2025-11-01'
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')
      ORDER BY outcome_time DESC
      LIMIT 25
    `);

    // Get November losers (sample 25)
    const novemberLosers = await db.execute(sql`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        outcome,
        profit_loss_pips,
        entry_price,
        stop_loss,
        tp1,
        indicators
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) = '2025-11-01'
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome = 'STOP_HIT'
      ORDER BY outcome_time DESC
      LIMIT 25
    `);

    console.log(`✅ Winners sampled: ${novemberWinners.length}`);
    console.log(`❌ Losers sampled: ${novemberLosers.length}\n`);

    // Analyze indicators
    console.log('Analyzing indicator values...\n');

    const analyzeIndicators = (signals: any[], label: string) => {
      const adxValues: number[] = [];
      const rsiValues: number[] = [];
      const confidenceValues: number[] = [];

      for (const signal of signals) {
        confidenceValues.push(signal.confidence);

        if (signal.indicators) {
          const indicators = typeof signal.indicators === 'string'
            ? JSON.parse(signal.indicators)
            : signal.indicators;

          if (indicators.adx?.adx) adxValues.push(indicators.adx.adx);
          if (indicators.rsi) rsiValues.push(indicators.rsi);
        }
      }

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : 0;
      const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;

      console.log(`\n${label}:`);
      console.log(`  Confidence: avg=${avg(confidenceValues).toFixed(1)}, min=${min(confidenceValues)}, max=${max(confidenceValues)}`);
      console.log(`  ADX: avg=${avg(adxValues).toFixed(1)}, min=${min(adxValues).toFixed(1)}, max=${max(adxValues).toFixed(1)} (${adxValues.length}/${signals.length} have data)`);
      console.log(`  RSI: avg=${avg(rsiValues).toFixed(1)}, min=${min(rsiValues).toFixed(1)}, max=${max(rsiValues).toFixed(1)} (${rsiValues.length}/${signals.length} have data)`);
    };

    analyzeIndicators(novemberWinners as any[], '🏆 WINNERS');
    analyzeIndicators(novemberLosers as any[], '💀 LOSERS');

    // ============================================================================
    // INVESTIGATION #3: OCTOBER VS NOVEMBER COMPARISON
    // ============================================================================
    console.log('\n\n' + '='.repeat(80));
    console.log('\n📊 INVESTIGATION #3: OCTOBER VS NOVEMBER COMPARISON\n');

    const monthComparison = await db.execute(sql`
      SELECT
        DATE_TRUNC('month', outcome_time) as month,
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
        ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
        COUNT(DISTINCT symbol) as unique_symbols
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) IN ('2025-10-01', '2025-11-01')
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome != 'PENDING'
      GROUP BY DATE_TRUNC('month', outcome_time)
      ORDER BY month DESC
    `);

    console.log('Month       | Signals | Wins | Losses | Win Rate | Avg Pips | Avg Conf | Symbols');
    console.log('-'.repeat(90));
    for (const month of monthComparison as any[]) {
      const monthStr = month.month.toISOString().slice(0, 7);
      console.log(
        `${monthStr} | ` +
        `${month.total_signals.toString().padStart(7)} | ` +
        `${month.wins.toString().padStart(4)} | ` +
        `${month.losses.toString().padStart(6)} | ` +
        `${parseFloat(month.win_rate).toFixed(2).padStart(8)}% | ` +
        `${parseFloat(month.avg_pips).toFixed(1).padStart(8)} | ` +
        `${parseFloat(month.avg_confidence).toFixed(1).padStart(8)} | ` +
        `${month.unique_symbols.toString().padStart(7)}`
      );
    }

    // Symbol breakdown by month
    console.log('\n\nSymbol Performance by Month:');
    const symbolByMonth = await db.execute(sql`
      SELECT
        DATE_TRUNC('month', outcome_time) as month,
        symbol,
        COUNT(*) as signals,
        ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate,
        ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) IN ('2025-10-01', '2025-11-01')
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome != 'PENDING'
      GROUP BY DATE_TRUNC('month', outcome_time), symbol
      ORDER BY month DESC, signals DESC
    `);

    let currentMonth = '';
    for (const row of symbolByMonth as any[]) {
      const monthStr = row.month.toISOString().slice(0, 7);
      if (monthStr !== currentMonth) {
        currentMonth = monthStr;
        console.log(`\n${monthStr}:`);
      }
      console.log(
        `  ${row.symbol.padEnd(10)} | ` +
        `${row.signals.toString().padStart(3)} signals | ` +
        `${parseFloat(row.win_rate).toFixed(1).padStart(5)}% win rate | ` +
        `${parseFloat(row.avg_pips).toFixed(1).padStart(8)} avg pips`
      );
    }

    // ============================================================================
    // INVESTIGATION #4: FILTER LOGIC VERIFICATION
    // ============================================================================
    console.log('\n\n' + '='.repeat(80));
    console.log('\n📊 INVESTIGATION #4: FILTER REQUIREMENTS CHECK\n');
    console.log('Expected filters in v2.1.0:');
    console.log('  - ADX >= 25 (trend strength)');
    console.log('  - RSI 45-70 for LONG, 30-55 for SHORT');
    console.log('  - Confidence >= 85');
    console.log('  - GBP/USD disabled\n');

    // Check if signals meet these requirements
    const filterCheck = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE confidence >= 85) as meets_confidence,
        COUNT(*) FILTER (WHERE confidence < 85) as fails_confidence,
        COUNT(*) FILTER (WHERE symbol = 'GBP/USD') as has_gbp_usd
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) = '2025-11-01'
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome != 'PENDING'
        AND strategy_version = '2.1.0'
    `);

    const check = (filterCheck as any[])[0];
    console.log('November 2025 signals (v2.1.0):');
    console.log(`  Total signals: ${check.total}`);
    console.log(`  Confidence >= 85: ${check.meets_confidence} (${(100 * check.meets_confidence / check.total).toFixed(1)}%)`);
    console.log(`  Confidence < 85: ${check.fails_confidence} (${(100 * check.fails_confidence / check.total).toFixed(1)}%)`);
    console.log(`  GBP/USD signals: ${check.has_gbp_usd}`);

    if (check.fails_confidence > 0) {
      console.log('\n⚠️  WARNING: Found signals with confidence < 85 in v2.1.0!');
      console.log('   This should not be possible with Phase 3 filters.');
    } else {
      console.log('\n✅ All signals meet confidence threshold (>= 85)');
    }

    if (check.has_gbp_usd > 0) {
      console.log('\n⚠️  WARNING: Found GBP/USD signals in November!');
      console.log('   These may have been created before the filter.');
    }

    // Check indicator availability
    console.log('\n\nIndicator Data Availability:');
    const indicatorCheck = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE indicators IS NOT NULL) as has_indicators,
        COUNT(*) FILTER (WHERE indicators::text LIKE '%adx%') as has_adx,
        COUNT(*) FILTER (WHERE indicators::text LIKE '%rsi%') as has_rsi
      FROM signal_history
      WHERE DATE_TRUNC('month', outcome_time) = '2025-11-01'
        AND trade_live = true
        AND tier = 'HIGH'
        AND outcome != 'PENDING'
    `);

    const indCheck = (indicatorCheck as any[])[0];
    console.log(`  Total signals: ${indCheck.total}`);
    console.log(`  Has indicators JSON: ${indCheck.has_indicators} (${(100 * indCheck.has_indicators / indCheck.total).toFixed(1)}%)`);
    console.log(`  Has ADX data: ${indCheck.has_adx} (${(100 * indCheck.has_adx / indCheck.total).toFixed(1)}%)`);
    console.log(`  Has RSI data: ${indCheck.has_rsi} (${(100 * indCheck.has_rsi / indCheck.total).toFixed(1)}%)`);

    console.log('\n\n' + '='.repeat(80));
    console.log('✅ DEEP DIAGNOSTIC COMPLETE\n');

  } catch (error) {
    console.error('❌ Error running deep diagnostic:', error);
    throw error;
  }
}

// Run the diagnostic
runDeepDiagnostic()
  .then(() => {
    console.log('\n✅ Analysis complete. Check results above.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

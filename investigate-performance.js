// Temporary script to investigate trading performance issue
import postgres from 'postgres';

const sql = postgres('postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-0-us-east-1.pooler.supabase.com:6543/postgres');

async function investigate() {
  console.log('🔍 INVESTIGATING TRADING PERFORMANCE ISSUE\n');
  console.log('=' .repeat(80));

  try {
    // Query 1: Signal counts by tier and trade_live since Nov 18
    console.log('\n📊 QUERY 1: Signal counts by tier and trade_live (since Nov 18, 2025)');
    console.log('-'.repeat(80));
    const signalCounts = await sql`
      SELECT tier, trade_live, COUNT(*) as total_signals
      FROM signal_history
      WHERE created_at >= '2025-11-18'
      GROUP BY tier, trade_live
      ORDER BY tier, trade_live
    `;
    console.table(signalCounts);

    // Query 2: All signals count to verify total
    console.log('\n📊 QUERY 2: Total signals in database');
    console.log('-'.repeat(80));
    const totalSignals = await sql`
      SELECT COUNT(*) as total FROM signal_history
    `;
    console.log(`Total signals in database: ${totalSignals[0].total}`);

    // Query 3: HIGH tier trade outcomes and pips
    console.log('\n📊 QUERY 3: HIGH tier trade outcomes (since Nov 18, 2025)');
    console.log('-'.repeat(80));
    const outcomes = await sql`
      SELECT
        outcome,
        COUNT(*) as count,
        COALESCE(SUM(profit_loss_pips), 0) as total_pips,
        COALESCE(AVG(profit_loss_pips), 0) as avg_pips
      FROM signal_history
      WHERE created_at >= '2025-11-18' AND trade_live = true AND tier = 'HIGH'
      GROUP BY outcome
      ORDER BY outcome
    `;
    console.table(outcomes);

    // Query 4: Confidence levels
    console.log('\n📊 QUERY 4: Confidence levels (since Nov 18, 2025)');
    console.log('-'.repeat(80));
    const confidence = await sql`
      SELECT
        AVG(confidence) as avg_confidence,
        MIN(confidence) as min_confidence,
        MAX(confidence) as max_confidence,
        COUNT(*) as total_count
      FROM signal_history
      WHERE created_at >= '2025-11-18'
    `;
    console.table(confidence);

    // Query 5: Check if any MEDIUM tier signals are marked as trade_live (BUG CHECK)
    console.log('\n🐛 QUERY 5: BUG CHECK - MEDIUM tier signals with trade_live = true');
    console.log('-'.repeat(80));
    const mediumLiveTrades = await sql`
      SELECT
        signal_id, tier, trade_live, confidence, outcome
      FROM signal_history
      WHERE tier = 'MEDIUM' AND trade_live = true
      LIMIT 10
    `;
    if (mediumLiveTrades.length > 0) {
      console.log('⚠️  WARNING: Found MEDIUM tier signals marked as trade_live = true!');
      console.table(mediumLiveTrades);
    } else {
      console.log('✅ No MEDIUM tier signals with trade_live = true (correct behavior)');
    }

    // Query 6: Recent trades with details
    console.log('\n📊 QUERY 6: Recent 10 trades (since Nov 18)');
    console.log('-'.repeat(80));
    const recentTrades = await sql`
      SELECT
        signal_id, symbol, type, tier, trade_live, confidence,
        outcome, profit_loss_pips, created_at
      FROM signal_history
      WHERE created_at >= '2025-11-18'
      ORDER BY created_at DESC
      LIMIT 10
    `;
    console.table(recentTrades);

    // Query 7: Win rate analysis
    console.log('\n📊 QUERY 7: Win rate analysis (HIGH tier, trade_live = true only)');
    console.log('-'.repeat(80));
    const winRate = await sql`
      SELECT
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
        COUNT(*) as total,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0),
          2
        ) as win_rate_percent
      FROM signal_history
      WHERE created_at >= '2025-11-18' AND trade_live = true AND tier = 'HIGH'
    `;
    console.table(winRate);

    // Query 8: Before and after comparison
    console.log('\n📊 QUERY 8: Performance BEFORE Nov 18, 2025 (old threshold)');
    console.log('-'.repeat(80));
    const beforePerf = await sql`
      SELECT
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COALESCE(SUM(profit_loss_pips), 0) as total_pips,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0),
          2
        ) as win_rate_percent
      FROM signal_history
      WHERE created_at < '2025-11-18' AND trade_live = true AND tier = 'HIGH'
    `;
    console.table(beforePerf);

    console.log('\n📊 QUERY 9: Performance AFTER Nov 18, 2025 (new threshold)');
    console.log('-'.repeat(80));
    const afterPerf = await sql`
      SELECT
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
        COALESCE(SUM(profit_loss_pips), 0) as total_pips,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) /
          NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0),
          2
        ) as win_rate_percent
      FROM signal_history
      WHERE created_at >= '2025-11-18' AND trade_live = true AND tier = 'HIGH'
    `;
    console.table(afterPerf);

    console.log('\n' + '='.repeat(80));
    console.log('✅ Investigation complete!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sql.end();
  }
}

investigate();

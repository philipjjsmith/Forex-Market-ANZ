/**
 * DEEP DIVE: November 17 (100% win rate) vs December (0% win rate)
 * Find out what was different
 */

import postgres from 'postgres';

const db = postgres('postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

async function deepDiveNovDec() {
  console.log('🔬 DEEP DIVE: November 17 vs December Performance');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Query 1: November 17-23 week (100% win rate)
    console.log('📊 NOVEMBER 17-23 WEEK (100% Win Rate)');
    console.log('-'.repeat(100));

    const nov17Signals = await db`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        tier,
        outcome,
        created_at,
        indicators
      FROM signal_history
      WHERE created_at >= '2025-11-17'::date
        AND created_at < '2025-11-24'::date
      ORDER BY created_at
      LIMIT 30
    `;

    console.log(`Total signals: ${nov17Signals.length}`);
    console.table(nov17Signals.map(s => ({
      date: new Date(s.created_at).toISOString().split('T')[0],
      symbol: s.symbol,
      type: s.type,
      confidence: s.confidence,
      tier: s.tier,
      outcome: s.outcome
    })));
    console.log('');

    if (nov17Signals.length > 0 && nov17Signals[0].indicators) {
      console.log('Sample indicators from Nov 17:');
      console.log(JSON.parse(nov17Signals[0].indicators));
      console.log('');
    }

    // Query 2: December signals (0% win rate)
    console.log('📊 DECEMBER 2025 (0% Win Rate)');
    console.log('-'.repeat(100));

    const decSignals = await db`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        tier,
        outcome,
        created_at,
        indicators
      FROM signal_history
      WHERE created_at >= '2025-12-01'::date
        AND created_at < '2026-01-01'::date
      ORDER BY created_at
      LIMIT 30
    `;

    console.log(`Total signals: ${decSignals.length}`);
    console.table(decSignals.map(s => ({
      date: new Date(s.created_at).toISOString().split('T')[0],
      symbol: s.symbol,
      type: s.type,
      confidence: s.confidence,
      tier: s.tier,
      outcome: s.outcome
    })));
    console.log('');

    if (decSignals.length > 0 && decSignals[0].indicators) {
      console.log('Sample indicators from December:');
      console.log(JSON.parse(decSignals[0].indicators));
      console.log('');
    }

    // Query 3: Compare average confidence
    console.log('📊 CONFIDENCE COMPARISON');
    console.log('-'.repeat(100));

    const comparison = await db`
      SELECT
        CASE
          WHEN created_at >= '2025-11-17' AND created_at < '2025-11-24' THEN 'Nov 17-23 (100% WR)'
          WHEN created_at >= '2025-12-01' AND created_at < '2026-01-01' THEN 'December (0% WR)'
          ELSE 'Other'
        END as period,
        COUNT(*) as signals,
        AVG(confidence) as avg_conf,
        MIN(confidence) as min_conf,
        MAX(confidence) as max_conf,
        string_agg(DISTINCT symbol, ', ') as symbols,
        string_agg(DISTINCT tier, ', ') as tiers
      FROM signal_history
      WHERE created_at >= '2025-11-17'
      GROUP BY period
    `;

    console.table(comparison.map(c => ({
      period: c.period,
      signals: c.signals,
      avg_conf: c.avg_conf ? parseFloat(c.avg_conf).toFixed(1) : 'N/A',
      min: c.min_conf,
      max: c.max_conf,
      symbols: c.symbols,
      tiers: c.tiers
    })));
    console.log('');

    // Query 4: Symbol breakdown
    console.log('📊 SYMBOL PERFORMANCE COMPARISON');
    console.log('-'.repeat(100));

    const symbolPerf = await db`
      SELECT
        symbol,
        COUNT(*) FILTER (WHERE created_at >= '2025-11-17' AND created_at < '2025-11-24') as nov17_signals,
        COUNT(*) FILTER (WHERE created_at >= '2025-11-17' AND created_at < '2025-11-24' AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as nov17_wins,
        COUNT(*) FILTER (WHERE created_at >= '2025-12-01' AND created_at < '2026-01-01') as dec_signals,
        COUNT(*) FILTER (WHERE created_at >= '2025-12-01' AND created_at < '2026-01-01' AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as dec_wins,
        COUNT(*) FILTER (WHERE created_at >= '2025-12-01' AND created_at < '2026-01-01' AND outcome = 'STOP_HIT') as dec_losses
      FROM signal_history
      WHERE created_at >= '2025-11-17'
      GROUP BY symbol
      ORDER BY symbol
    `;

    console.table(symbolPerf.map(s => ({
      symbol: s.symbol,
      nov17_sig: s.nov17_signals,
      nov17_wins: s.nov17_wins,
      nov17_wr: s.nov17_signals > 0 ? `${((s.nov17_wins / s.nov17_signals) * 100).toFixed(1)}%` : 'N/A',
      dec_sig: s.dec_signals,
      dec_wins: s.dec_wins,
      dec_losses: s.dec_losses,
      dec_wr: s.dec_signals > 0 ? `${((s.dec_wins / s.dec_signals) * 100).toFixed(1)}%` : 'N/A'
    })));
    console.log('');

    // Query 5: Check if confidence threshold changed
    console.log('📊 CONFIDENCE DISTRIBUTION');
    console.log('-'.repeat(100));

    const confDist = await db`
      SELECT
        confidence,
        COUNT(*) as count,
        COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
        COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
      FROM signal_history
      WHERE created_at >= '2025-11-17'
      GROUP BY confidence
      ORDER BY confidence DESC
    `;

    console.table(confDist.map(c => ({
      confidence: c.confidence,
      count: c.count,
      wins: c.wins,
      losses: c.losses,
      win_rate: (c.wins + c.losses) > 0 ? `${((c.wins / (c.wins + c.losses)) * 100).toFixed(1)}%` : 'N/A'
    })));

    console.log('');
    console.log('='.repeat(100));
    console.log('✅ Deep dive complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

deepDiveNovDec();

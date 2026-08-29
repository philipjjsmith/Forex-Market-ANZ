/**
 * December Analysis - Why 0% Win Rate?
 */

import postgres from 'postgres';

const db = postgres('postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

async function analyzeDecember() {
  console.log('📊 DECEMBER 2025 ANALYSIS (0% Win Rate)');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Get all December signals
    const decSignals = await db`
      SELECT
        signal_id,
        symbol,
        type,
        confidence,
        tier,
        outcome,
        entry_price,
        stop_loss,
        tp1,
        created_at
      FROM signal_history
      WHERE created_at >= '2025-12-01'::date
        AND created_at < '2026-01-01'::date
      ORDER BY created_at
    `;

    console.log(`📈 Total Signals in December: ${decSignals.length}`);
    console.log('');

    // Outcome breakdown
    const outcomes = {
      TP1_HIT: 0,
      TP2_HIT: 0,
      TP3_HIT: 0,
      STOP_HIT: 0,
      EXPIRED: 0,
      PENDING: 0
    };

    decSignals.forEach(s => {
      outcomes[s.outcome as keyof typeof outcomes]++;
    });

    console.log('📊 Outcome Breakdown:');
    console.table(outcomes);
    console.log('');

    // Symbol breakdown
    const bySymbol: Record<string, any> = {};
    decSignals.forEach(s => {
      if (!bySymbol[s.symbol]) {
        bySymbol[s.symbol] = { total: 0, wins: 0, losses: 0, expired: 0 };
      }
      bySymbol[s.symbol].total++;
      if (['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(s.outcome)) {
        bySymbol[s.symbol].wins++;
      } else if (s.outcome === 'STOP_HIT') {
        bySymbol[s.symbol].losses++;
      } else if (s.outcome === 'EXPIRED') {
        bySymbol[s.symbol].expired++;
      }
    });

    console.log('📊 Performance by Symbol:');
    console.table(Object.entries(bySymbol).map(([symbol, data]) => ({
      symbol,
      total: data.total,
      wins: data.wins,
      losses: data.losses,
      expired: data.expired,
      win_rate: data.wins + data.losses > 0 ? `${((data.wins / (data.wins + data.losses)) * 100).toFixed(1)}%` : 'N/A'
    })));
    console.log('');

    // Type breakdown (LONG vs SHORT)
    const byType: Record<string, any> = { LONG: { total: 0, wins: 0, losses: 0 }, SHORT: { total: 0, wins: 0, losses: 0 } };
    decSignals.forEach(s => {
      byType[s.type].total++;
      if (['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(s.outcome)) {
        byType[s.type].wins++;
      } else if (s.outcome === 'STOP_HIT') {
        byType[s.type].losses++;
      }
    });

    console.log('📊 Performance by Type (LONG vs SHORT):');
    console.table(Object.entries(byType).map(([type, data]) => ({
      type,
      total: data.total,
      wins: data.wins,
      losses: data.losses,
      win_rate: data.wins + data.losses > 0 ? `${((data.wins / (data.wins + data.losses)) * 100).toFixed(1)}%` : 'N/A'
    })));
    console.log('');

    // Tier breakdown
    const byTier: Record<string, any> = { HIGH: { total: 0, wins: 0, losses: 0 }, MEDIUM: { total: 0, wins: 0, losses: 0 } };
    decSignals.forEach(s => {
      if (!byTier[s.tier]) byTier[s.tier] = { total: 0, wins: 0, losses: 0 };
      byTier[s.tier].total++;
      if (['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(s.outcome)) {
        byTier[s.tier].wins++;
      } else if (s.outcome === 'STOP_HIT') {
        byTier[s.tier].losses++;
      }
    });

    console.log('📊 Performance by Tier:');
    console.table(Object.entries(byTier).map(([tier, data]) => ({
      tier,
      total: data.total,
      wins: data.wins,
      losses: data.losses,
      win_rate: data.wins + data.losses > 0 ? `${((data.wins / (data.wins + data.losses)) * 100).toFixed(1)}%` : 'N/A'
    })));
    console.log('');

    // Sample of losing trades
    const losses = decSignals.filter(s => s.outcome === 'STOP_HIT').slice(0, 10);
    console.log('📊 Sample of Losing Trades (first 10):');
    console.table(losses.map(s => ({
      date: new Date(s.created_at).toISOString().split('T')[0],
      symbol: s.symbol,
      type: s.type,
      conf: s.confidence,
      tier: s.tier,
      entry: parseFloat(s.entry_price).toFixed(5),
      stop: parseFloat(s.stop_loss).toFixed(5),
      tp1: parseFloat(s.tp1).toFixed(5)
    })));

    console.log('');
    console.log('='.repeat(100));
    console.log('✅ December analysis complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

analyzeDecember();

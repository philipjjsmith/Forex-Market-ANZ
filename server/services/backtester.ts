import { db } from '../db';
import { sql } from 'drizzle-orm';
import { Indicators } from '../../client/src/lib/indicators';

/**
 * Backtesting Service
 * Tests different strategy parameters on historical data
 * Milestone 3B: Parameter Optimization
 */

interface BacktestResult {
  ema: {
    fast: number;
    slow: number;
    name: string;
  };
  atr: {
    multiplier: number;
    name: string;
  };
  winRate: number;
  total: number;
  improvement: number;
}

interface CompletedSignal {
  id: string;
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  tp1: number;
  outcome: string;
  profit_loss_pips: number;
  candles: any;
  indicators: any;
  created_at: Date;
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class Backtester {
  private lastRunTime = 0;

  /**
   * Get the timestamp of the last successful run
   */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  /**
   * Run backtesting on all symbols with sufficient data
   */
  async backtestAllSymbols(): Promise<void> {
    this.lastRunTime = Date.now();
    console.log('🔬 [Backtester] Starting parameter optimization...');

    try {
      const symbols = await this.getSymbolsWithData();
      console.log(`📊 Found ${symbols.length} symbols with 30+ signals`);

      for (const symbol of symbols) {
        await this.backtestSymbol(symbol);
      }

      console.log('✅ Backtesting complete');
    } catch (error) {
      console.error('❌ [Backtester] Error:', error);
      throw error;
    }
  }

  /**
   * Backtest parameter combinations for a single symbol
   */
  async backtestSymbol(symbol: string): Promise<void> {
    console.log(`\n🔬 Backtesting ${symbol}...`);

    // 1. Fetch all completed signals for this symbol
    const completedSignals = await this.getCompletedSignals(symbol);

    if (completedSignals.length < 30) {
      console.log(`⚠️  ${symbol}: Not enough data (${completedSignals.length}/30)`);
      return;
    }

    console.log(`  📊 Analyzing ${completedSignals.length} completed signals`);

    // Get current win rate for comparison
    const currentWinRate = this.calculateCurrentWinRate(completedSignals);
    console.log(`  📈 Current win rate: ${currentWinRate.toFixed(1)}%`);

    // 2. Test different parameter combinations
    const emaTests = [
      { fast: 15, slow: 45, name: '15/45 EMA' },
      { fast: 20, slow: 50, name: '20/50 EMA' },  // Current default
      { fast: 25, slow: 55, name: '25/55 EMA' },
    ];

    const atrTests = [
      { multiplier: 1.5, name: '1.5x ATR' },
      { multiplier: 2.0, name: '2.0x ATR' },  // Current default
      { multiplier: 2.5, name: '2.5x ATR' },
    ];

    let bestConfig: BacktestResult | null = null;
    let bestWinRate = 0;

    // 3. Test all combinations
    for (const ema of emaTests) {
      for (const atr of atrTests) {
        let wins = 0;
        let total = 0;

        // Re-analyze each signal with new parameters
        for (const signal of completedSignals) {
          const candles = signal.candles;

          // Simulate strategy with different parameters
          const hypotheticalSignal = this.simulateStrategy(
            candles,
            ema.fast,
            ema.slow,
            atr.multiplier,
            signal.type
          );

          // Skip if this combo wouldn't generate signal
          if (!hypotheticalSignal) continue;

          total++;

          // Check if this signal actually won
          const actuallyWon = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(signal.outcome);

          if (actuallyWon) wins++;
        }

        const winRate = total > 0 ? (wins / total) * 100 : 0;
        const improvement = winRate - currentWinRate;

        console.log(`  ${ema.name} + ${atr.name}: ${winRate.toFixed(1)}% (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}% / ${total} trades)`);

        // Track best configuration (require at least 20 signals for this combo)
        if (winRate > bestWinRate && total >= 20) {
          bestWinRate = winRate;
          bestConfig = { ema, atr, winRate, total, improvement };
        }
      }
    }

    // 4. Generate recommendation if improvement > 5%
    if (bestConfig && bestConfig.improvement > 5) {
      await this.createRecommendation(symbol, bestConfig, completedSignals.length);
      console.log(`  ✅ ${symbol}: Recommendation created (+${bestConfig.improvement.toFixed(1)}% improvement)`);
    } else if (bestConfig) {
      console.log(`  ℹ️  ${symbol}: Best improvement only +${bestConfig.improvement.toFixed(1)}% (threshold: +5%)`);
    } else {
      console.log(`  ✅ ${symbol}: Current parameters are optimal`);
    }
  }

  /**
   * Simulate strategy with different parameters
   */
  private simulateStrategy(
    candles: Candle[],
    fastPeriod: number,
    slowPeriod: number,
    atrMultiplier: number,
    expectedType: 'LONG' | 'SHORT'
  ): { type: 'LONG' | 'SHORT'; entry: number; stop: number } | null {
    if (candles.length < Math.max(fastPeriod, slowPeriod) + 10) {
      return null; // Not enough data
    }

    // Calculate indicators with new periods
    const closes = candles.map(c => c.close);
    const fastMA = Indicators.ema(closes, fastPeriod);
    const slowMA = Indicators.ema(closes, slowPeriod);
    const atr = Indicators.atr(candles, 14);

    if (!fastMA || !slowMA || !atr) return null;

    // Check for crossover with new parameters
    const prevCloses = closes.slice(0, -1);
    const prevFastMA = Indicators.ema(prevCloses, fastPeriod);
    const prevSlowMA = Indicators.ema(prevCloses, slowPeriod);

    if (!prevFastMA || !prevSlowMA) return null;

    const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
    const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

    if (!bullishCross && !bearishCross) return null;

    const currentPrice = closes[closes.length - 1];
    const signalType = bullishCross ? 'LONG' : 'SHORT';

    // Only consider if it matches the expected type (same as original signal)
    if (signalType !== expectedType) return null;

    // Calculate stop with new ATR multiplier
    const stop = signalType === 'LONG'
      ? currentPrice - (atr * atrMultiplier)
      : currentPrice + (atr * atrMultiplier);

    return {
      type: signalType,
      entry: currentPrice,
      stop,
    };
  }

  /**
   * Calculate current win rate from completed signals
   */
  private calculateCurrentWinRate(signals: CompletedSignal[]): number {
    const wins = signals.filter(s =>
      s.outcome === 'TP1_HIT' || s.outcome === 'TP2_HIT' || s.outcome === 'TP3_HIT'
    ).length;

    return (wins / signals.length) * 100;
  }

  /**
   * Create recommendation in strategy_adaptations table
   */
  private async createRecommendation(
    symbol: string,
    bestConfig: BacktestResult,
    totalSignals: number
  ): Promise<void> {
    const { ema, atr, improvement } = bestConfig;

    const recommendationTitle = `Optimize ${symbol} Strategy Parameters`;
    const recommendationDetails = `Switch from 20/50 EMA to ${ema.fast}/${ema.slow} EMA and ${atr.multiplier}x ATR stop loss`;
    const reasoning = `Backtesting on ${totalSignals} historical signals shows ${improvement.toFixed(1)}% win rate improvement. ` +
      `${ema.fast}/${ema.slow} EMA catches trends ${ema.fast < 20 ? 'earlier' : 'with less noise'}, and ${atr.multiplier}x ATR provides ` +
      `${atr.multiplier > 2 ? 'more room for volatility' : 'tighter risk management'}.`;

    const suggestedChanges = {
      fastMA_period: { from: 20, to: ema.fast },
      slowMA_period: { from: 50, to: ema.slow },
      atr_multiplier: { from: 2.0, to: atr.multiplier }
    };

    try {
      await db.execute(sql`
        INSERT INTO strategy_adaptations (
          user_id,
          pattern_detected,
          confidence_bracket,
          symbol,
          recommendation_title,
          recommendation_details,
          reasoning,
          suggested_changes,
          expected_win_rate_improvement,
          based_on_signals,
          old_strategy_version,
          status,
          created_at
        ) VALUES (
          'ai-system',
          ${`${symbol} shows better performance with ${ema.fast}/${ema.slow} EMA and ${atr.multiplier}x ATR`},
          'ALL',
          ${symbol},
          ${recommendationTitle},
          ${recommendationDetails},
          ${reasoning},
          ${JSON.stringify(suggestedChanges)},
          ${improvement.toFixed(2)},
          ${totalSignals},
          '1.0.0',
          'pending',
          NOW()
        )
      `);

      console.log(`  💾 Recommendation saved to database`);
    } catch (error: any) {
      console.error(`  ❌ Error saving recommendation:`, error.message);
      throw error;
    }
  }

  /**
   * Get symbols with at least 30 completed signals
   */
  private async getSymbolsWithData(): Promise<string[]> {
    const result = await db.execute(sql`
      SELECT symbol, COUNT(*) as signal_count
      FROM signal_history
      WHERE outcome != 'PENDING'
      GROUP BY symbol
      HAVING COUNT(*) >= 30
      ORDER BY symbol
    `) as any[];

    return result.map(r => r.symbol);
  }

  /**
   * Get completed signals for a symbol
   */
  private async getCompletedSignals(symbol: string): Promise<CompletedSignal[]> {
    const result = await db.execute(sql`
      SELECT
        id,
        signal_id,
        symbol,
        type,
        entry_price,
        stop_loss,
        tp1,
        outcome,
        profit_loss_pips,
        candles,
        indicators,
        created_at
      FROM signal_history
      WHERE symbol = ${symbol}
        AND outcome != 'PENDING'
      ORDER BY created_at DESC
    `);

    return result as any[];
  }
}

// Export singleton instance
export const backtester = new Backtester();

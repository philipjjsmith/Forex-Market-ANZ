import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * AI Analyzer Service
 * Learns from signal outcomes to improve future signal generation
 * Phase 3: AI Learning System
 */

export interface SymbolInsights {
  symbol: string;
  totalSignals: number;
  completedSignals: number;
  winRate: number;

  // Pattern effectiveness (base confidence scores)
  bullishCrossoverWinRate: number;  // Default: 30
  bearishCrossoverWinRate: number;  // Default: 30

  // Indicator weights (calculated from historical performance)
  rsiModerateWeight: number;      // RSI 40-70, Default: 15
  rsiOverboughtWeight: number;    // RSI > 70, Default: 0
  rsiOversoldWeight: number;      // RSI < 30, Default: 0
  strongTrendWeight: number;      // ADX > 25, Default: 15
  weakTrendPenalty: number;       // ADX < 20, Default: 0
  bbUpperWeight: number;          // Price in upper BB, Default: 10
  bbLowerWeight: number;          // Price in lower BB, Default: 10
  htfTrendWeight: number;         // Higher timeframe confirmation, Default: 20

  // Optimal parameters
  optimalFastMA: number;          // Best EMA period (default 20)
  optimalSlowMA: number;          // Best EMA period (default 50)
  optimalStopMultiplier: number;  // ATR multiplier (default 2)
  optimalConfidenceThreshold: number; // Min confidence (default 50)

  // Metadata
  lastUpdated: Date;
  minimumSampleSize: number;      // Require 30+ signals before trusting
  hasEnoughData: boolean;
}

interface CompletedSignal {
  id: string;
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  outcome: string;
  profit_loss_pips: number;
  indicators: any;
  candles: any;
  created_at: Date;
}

export class AIAnalyzer {
  private insightsCache: Map<string, SymbolInsights> = new Map();
  private isAnalyzing = false;
  private lastRunTime = 0;

  /**
   * Get the timestamp of the last successful run
   */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  /**
   * Main analysis - runs every 6 hours
   */
  async analyzeAllSymbols(): Promise<void> {
    if (this.isAnalyzing) {
      console.log('⏭️  AI Analyzer already running, skipping...');
      return;
    }

    this.isAnalyzing = true;
    this.lastRunTime = Date.now();
    console.log('🧠 [AI Analyzer] Starting analysis cycle...');

    try {
      const symbols = await this.getActiveSymbols();
      console.log(`📊 Analyzing ${symbols.length} symbols`);

      for (const symbol of symbols) {
        await this.analyzeSymbol(symbol);
      }

      console.log('✅ AI analysis complete');
    } catch (error) {
      console.error('❌ [AI Analyzer] Error:', error);
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Analyze single symbol performance
   */
  async analyzeSymbol(symbol: string): Promise<SymbolInsights> {
    console.log(`🔍 Analyzing ${symbol}...`);

    // 1. Fetch all completed signals for this symbol
    const signals = await this.getCompletedSignals(symbol);

    console.log(`  📊 ${symbol}: ${signals.length} completed signals`);

    // If not enough data, return defaults
    if (signals.length < 30) {
      console.log(`  ⚠️  ${symbol}: Not enough data (need 30+, have ${signals.length})`);
      const insights = this.getDefaultInsights(symbol, signals.length);
      this.insightsCache.set(symbol, insights);
      return insights;
    }

    // 2. Calculate overall win rate
    const wins = signals.filter(s =>
      s.outcome === 'TP1_HIT' || s.outcome === 'TP2_HIT' || s.outcome === 'TP3_HIT'
    ).length;
    const winRate = (wins / signals.length) * 100;

    console.log(`  ✅ ${symbol}: ${winRate.toFixed(1)}% win rate (${wins}/${signals.length})`);

    // 3. Calculate pattern effectiveness
    const bullishSignals = signals.filter(s => s.type === 'LONG');
    const bearishSignals = signals.filter(s => s.type === 'SHORT');

    const bullishWins = bullishSignals.filter(s =>
      s.outcome === 'TP1_HIT' || s.outcome === 'TP2_HIT' || s.outcome === 'TP3_HIT'
    ).length;
    const bearishWins = bearishSignals.filter(s =>
      s.outcome === 'TP1_HIT' || s.outcome === 'TP2_HIT' || s.outcome === 'TP3_HIT'
    ).length;

    const bullishWinRate = bullishSignals.length > 0
      ? (bullishWins / bullishSignals.length) * 100
      : 50; // Default if no data
    const bearishWinRate = bearishSignals.length > 0
      ? (bearishWins / bearishSignals.length) * 100
      : 50;

    // 4. Calculate indicator effectiveness
    const indicatorWeights = await this.calculateIndicatorWeights(signals);

    // 5. Build insights object
    const insights: SymbolInsights = {
      symbol,
      totalSignals: signals.length,
      completedSignals: signals.length,
      winRate,
      bullishCrossoverWinRate: bullishWinRate,
      bearishCrossoverWinRate: bearishWinRate,
      ...indicatorWeights,
      optimalFastMA: 20,  // TODO: Implement parameter optimization in Milestone 3
      optimalSlowMA: 50,
      optimalStopMultiplier: 2.0,
      optimalConfidenceThreshold: 50, // Currently using 50% threshold
      lastUpdated: new Date(),
      minimumSampleSize: 30,
      hasEnoughData: true,
    };

    // 6. Cache insights
    this.insightsCache.set(symbol, insights);

    console.log(`  🎯 ${symbol} insights updated`);

    return insights;
  }

  /**
   * Calculate effectiveness of each indicator condition
   */
  private async calculateIndicatorWeights(signals: CompletedSignal[]): Promise<{
    rsiModerateWeight: number;
    rsiOverboughtWeight: number;
    rsiOversoldWeight: number;
    strongTrendWeight: number;
    weakTrendPenalty: number;
    bbUpperWeight: number;
    bbLowerWeight: number;
    htfTrendWeight: number;
  }> {
    // RSI Moderate (40-70) effectiveness
    const rsiModerateSignals = signals.filter(s => {
      const rsi = this.parseIndicator(s.indicators, 'rsi');
      return rsi !== null && rsi >= 40 && rsi <= 70;
    });
    const rsiModerateWinRate = this.calculateWinRate(rsiModerateSignals);
    const rsiModerateWeight = this.winRateToWeight(rsiModerateWinRate, 15);

    // RSI Overbought (> 70) effectiveness
    const rsiOverboughtSignals = signals.filter(s => {
      const rsi = this.parseIndicator(s.indicators, 'rsi');
      return rsi !== null && rsi > 70;
    });
    const rsiOverboughtWinRate = this.calculateWinRate(rsiOverboughtSignals);
    const rsiOverboughtWeight = this.winRateToWeight(rsiOverboughtWinRate, 0);

    // RSI Oversold (< 30) effectiveness
    const rsiOversoldSignals = signals.filter(s => {
      const rsi = this.parseIndicator(s.indicators, 'rsi');
      return rsi !== null && rsi < 30;
    });
    const rsiOversoldWinRate = this.calculateWinRate(rsiOversoldSignals);
    const rsiOversoldWeight = this.winRateToWeight(rsiOversoldWinRate, 0);

    // Strong Trend (ADX > 25) effectiveness
    const strongTrendSignals = signals.filter(s => {
      const adx = this.parseIndicator(s.indicators, 'adx');
      return adx !== null && adx > 25;
    });
    const strongTrendWinRate = this.calculateWinRate(strongTrendSignals);
    const strongTrendWeight = this.winRateToWeight(strongTrendWinRate, 15);

    // Weak Trend (ADX < 20) penalty
    const weakTrendSignals = signals.filter(s => {
      const adx = this.parseIndicator(s.indicators, 'adx');
      return adx !== null && adx < 20;
    });
    const weakTrendWinRate = this.calculateWinRate(weakTrendSignals);
    // Penalty if weak trend performs poorly
    const weakTrendPenalty = weakTrendWinRate < 50 ? (50 - weakTrendWinRate) / 5 : 0;

    // Bollinger Bands effectiveness (simplified for now)
    const bbUpperWeight = 10; // TODO: Calculate from actual BB conditions
    const bbLowerWeight = 10;

    // Higher timeframe trend (always important)
    const htfTrendWeight = 20;

    return {
      rsiModerateWeight,
      rsiOverboughtWeight,
      rsiOversoldWeight,
      strongTrendWeight,
      weakTrendPenalty,
      bbUpperWeight,
      bbLowerWeight,
      htfTrendWeight,
    };
  }

  /**
   * Parse indicator value from JSONB column
   */
  private parseIndicator(indicators: any, key: string): number | null {
    if (!indicators || typeof indicators !== 'object') return null;

    const value = indicators[key];
    if (value === null || value === undefined || value === 'N/A') return null;

    const parsed = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Calculate win rate for a set of signals
   */
  private calculateWinRate(signals: CompletedSignal[]): number {
    if (signals.length === 0) return 50; // Default if no data

    const wins = signals.filter(s =>
      s.outcome === 'TP1_HIT' || s.outcome === 'TP2_HIT' || s.outcome === 'TP3_HIT'
    ).length;

    return (wins / signals.length) * 100;
  }

  /**
   * Convert win rate % to confidence weight (0-25)
   * Uses default weight as baseline
   */
  private winRateToWeight(winRate: number, defaultWeight: number): number {
    // If win rate > 70%, increase weight
    if (winRate >= 80) return Math.min(defaultWeight + 10, 25);
    if (winRate >= 70) return Math.min(defaultWeight + 5, 25);

    // If win rate 50-70%, use default or slightly adjust
    if (winRate >= 60) return defaultWeight;
    if (winRate >= 50) return Math.max(defaultWeight - 3, 5);

    // If win rate < 50%, decrease weight significantly
    if (winRate >= 40) return Math.max(defaultWeight - 5, 0);
    return 0; // Don't use this indicator if < 40% win rate
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
        confidence,
        outcome,
        profit_loss_pips,
        indicators,
        candles,
        created_at
      FROM signal_history
      WHERE symbol = ${symbol}
        AND outcome != 'PENDING'
      ORDER BY created_at DESC
    `);

    return result as any[];
  }

  /**
   * Get list of symbols with signals
   */
  private async getActiveSymbols(): Promise<string[]> {
    const result = await db.execute(sql`
      SELECT DISTINCT symbol
      FROM signal_history
      ORDER BY symbol
    `) as any[];

    return result.map(r => r.symbol);
  }

  /**
   * Get insights for a symbol (from cache or default)
   */
  getSymbolInsights(symbol: string): SymbolInsights {
    const cached = this.insightsCache.get(symbol);
    if (cached) {
      return cached;
    }

    // Return defaults if not analyzed yet
    return this.getDefaultInsights(symbol, 0);
  }

  /**
   * Default insights when not enough data
   */
  private getDefaultInsights(symbol: string, signalCount: number): SymbolInsights {
    return {
      symbol,
      totalSignals: signalCount,
      completedSignals: signalCount,
      winRate: 0,
      bullishCrossoverWinRate: 30,  // Static defaults
      bearishCrossoverWinRate: 30,
      rsiModerateWeight: 15,
      rsiOverboughtWeight: 0,
      rsiOversoldWeight: 0,
      strongTrendWeight: 15,
      weakTrendPenalty: 0,
      bbUpperWeight: 10,
      bbLowerWeight: 10,
      htfTrendWeight: 20,
      optimalFastMA: 20,
      optimalSlowMA: 50,
      optimalStopMultiplier: 2.0,
      optimalConfidenceThreshold: 50,
      lastUpdated: new Date(),
      minimumSampleSize: 30,
      hasEnoughData: false,
    };
  }

  /**
   * Get all cached insights
   */
  getAllInsights(): SymbolInsights[] {
    return Array.from(this.insightsCache.values());
  }

  /**
   * REMOVED: start() method no longer needed
   * AI analysis is now triggered via HTTP endpoint /api/cron/analyze-ai
   * This allows the service to work on Render free tier (which sleeps after 15 min)
   * External cron service pings the endpoint every 6 hours to trigger analysis
   */
}

// Export singleton instance
export const aiAnalyzer = new AIAnalyzer();

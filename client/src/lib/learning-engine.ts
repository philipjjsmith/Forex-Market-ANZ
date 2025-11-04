/**
 * Learning Engine for Auto-Trader
 * Analyzes historical performance and adjusts future confidence scores
 */

export interface StrategyMetric {
  symbol: string;
  confidenceRange: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgProfit: number;
  avgLoss: number;
  winRate: number;
  profitFactor: number;
  lastUpdated: Date;
}

export interface PerformanceMultiplier {
  symbol: string;
  confidenceRange: string;
  multiplier: number;
  sampleSize: number;
}

export class LearningEngine {
  private metrics: Map<string, StrategyMetric> = new Map();
  private multipliers: Map<string, number> = new Map();

  // Minimum trades required before adjusting confidence
  private readonly MIN_SAMPLE_SIZE = 5;

  // Maximum adjustment range (e.g., 0.8 = -20%, 1.2 = +20%)
  private readonly MIN_MULTIPLIER = 0.7;
  private readonly MAX_MULTIPLIER = 1.3;

  constructor(initialMetrics?: StrategyMetric[]) {
    if (initialMetrics) {
      this.loadMetrics(initialMetrics);
    }
  }

  /**
   * Get confidence range bucket for a score
   */
  private getConfidenceRange(confidence: number): string {
    if (confidence >= 91) return '91-100';
    if (confidence >= 86) return '86-90';
    if (confidence >= 81) return '81-85';
    if (confidence >= 76) return '76-80';
    return '70-75';
  }

  /**
   * Create unique key for symbol + confidence range
   */
  private getMetricKey(symbol: string, confidenceRange: string): string {
    return `${symbol}:${confidenceRange}`;
  }

  /**
   * Load existing metrics from database
   */
  loadMetrics(metrics: StrategyMetric[]): void {
    this.metrics.clear();
    this.multipliers.clear();

    for (const metric of metrics) {
      const key = this.getMetricKey(metric.symbol, metric.confidenceRange);
      this.metrics.set(key, metric);

      // Calculate initial multiplier
      if (metric.totalTrades >= this.MIN_SAMPLE_SIZE) {
        const multiplier = this.calculateMultiplier(metric);
        this.multipliers.set(key, multiplier);
      }
    }

    console.log(`📊 Loaded ${metrics.length} strategy metrics`);
    console.log(`🎯 Active multipliers: ${this.multipliers.size}`);
  }

  /**
   * Calculate performance multiplier for a metric
   * Returns value between MIN_MULTIPLIER and MAX_MULTIPLIER
   */
  private calculateMultiplier(metric: StrategyMetric): number {
    // Not enough data yet
    if (metric.totalTrades < this.MIN_SAMPLE_SIZE) {
      return 1.0; // No adjustment
    }

    // Calculate performance score based on multiple factors
    let score = 0;

    // 1. Win Rate Component (40% weight)
    // Target: 60% win rate
    // 70%+ = excellent, 50-60% = good, <50% = poor
    const winRateScore = (metric.winRate - 50) / 50; // -1 to +0.4 range
    score += winRateScore * 0.4;

    // 2. Profit Factor Component (40% weight)
    // Profit Factor = Total Profit / Total Loss
    // >2.0 = excellent, 1.5-2.0 = good, 1.0-1.5 = okay, <1.0 = poor
    const profitFactorScore = (metric.profitFactor - 1.0) / 2.0; // -0.5 to +0.5 range
    score += profitFactorScore * 0.4;

    // 3. Average P/L Ratio (20% weight)
    // If avg profit > avg loss = good
    const avgPLRatio = metric.avgLoss !== 0
      ? (metric.avgProfit / Math.abs(metric.avgLoss)) - 1
      : 0;
    score += (avgPLRatio / 2) * 0.2; // Normalize and weight

    // 4. Sample Size Confidence
    // More trades = more confident in the multiplier
    const sampleConfidence = Math.min(metric.totalTrades / 20, 1.0); // Max at 20 trades
    score *= sampleConfidence;

    // Convert score to multiplier
    // Score of 0 = 1.0 (no change)
    // Positive score = increase confidence
    // Negative score = decrease confidence
    const multiplier = 1.0 + (score * 0.3); // Max ±30% adjustment

    // Clamp to safe range
    return Math.max(
      this.MIN_MULTIPLIER,
      Math.min(this.MAX_MULTIPLIER, multiplier)
    );
  }

  /**
   * Update metrics with a new trade result
   */
  updateMetric(
    symbol: string,
    confidence: number,
    won: boolean,
    profitLoss: number
  ): StrategyMetric {
    const range = this.getConfidenceRange(confidence);
    const key = this.getMetricKey(symbol, range);

    let metric = this.metrics.get(key);

    if (!metric) {
      // Create new metric
      metric = {
        symbol,
        confidenceRange: range,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgProfit: 0,
        avgLoss: 0,
        winRate: 0,
        profitFactor: 0,
        lastUpdated: new Date(),
      };
    }

    // Update counts
    metric.totalTrades++;
    if (won) {
      metric.winningTrades++;
    } else {
      metric.losingTrades++;
    }

    // Update averages (incremental calculation)
    if (profitLoss > 0) {
      const prevTotal = metric.avgProfit * (metric.winningTrades - 1);
      metric.avgProfit = (prevTotal + profitLoss) / metric.winningTrades;
    } else {
      const prevTotal = metric.avgLoss * (metric.losingTrades - 1);
      metric.avgLoss = (prevTotal + Math.abs(profitLoss)) / metric.losingTrades;
    }

    // Recalculate derived metrics
    metric.winRate = (metric.winningTrades / metric.totalTrades) * 100;

    const totalProfit = metric.avgProfit * metric.winningTrades;
    const totalLoss = metric.avgLoss * metric.losingTrades;
    metric.profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

    metric.lastUpdated = new Date();

    // Save updated metric
    this.metrics.set(key, metric);

    // Recalculate multiplier if we have enough data
    if (metric.totalTrades >= this.MIN_SAMPLE_SIZE) {
      const multiplier = this.calculateMultiplier(metric);
      this.multipliers.set(key, multiplier);

      console.log(`🧠 Learning: ${symbol} ${range} → ${(multiplier * 100).toFixed(0)}% confidence adjustment (${metric.totalTrades} trades, ${metric.winRate.toFixed(1)}% win rate)`);
    }

    return metric;
  }

  /**
   * Adjust a signal's confidence based on learned performance
   */
  adjustConfidence(symbol: string, baseConfidence: number): number {
    const range = this.getConfidenceRange(baseConfidence);
    const key = this.getMetricKey(symbol, range);

    const multiplier = this.multipliers.get(key) || 1.0;
    const adjustedConfidence = baseConfidence * multiplier;

    // Clamp to valid range (0-100)
    return Math.max(0, Math.min(100, adjustedConfidence));
  }

  /**
   * Get performance summary for a symbol
   */
  getSymbolPerformance(symbol: string): StrategyMetric[] {
    const symbolMetrics: StrategyMetric[] = [];

    for (const [key, metric] of this.metrics.entries()) {
      if (key.startsWith(`${symbol}:`)) {
        symbolMetrics.push(metric);
      }
    }

    return symbolMetrics.sort((a, b) =>
      b.totalTrades - a.totalTrades
    );
  }

  /**
   * Get all performance multipliers
   */
  getMultipliers(): PerformanceMultiplier[] {
    const result: PerformanceMultiplier[] = [];

    for (const [key, multiplier] of this.multipliers.entries()) {
      const [symbol, confidenceRange] = key.split(':');
      const metric = this.metrics.get(key);

      if (metric) {
        result.push({
          symbol,
          confidenceRange,
          multiplier,
          sampleSize: metric.totalTrades,
        });
      }
    }

    return result.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  /**
   * Get top performing symbol+confidence combinations
   */
  getTopPerformers(limit = 5): StrategyMetric[] {
    const metricsArray = Array.from(this.metrics.values())
      .filter(m => m.totalTrades >= this.MIN_SAMPLE_SIZE);

    return metricsArray
      .sort((a, b) => {
        // Sort by profit factor, then win rate
        if (b.profitFactor !== a.profitFactor) {
          return b.profitFactor - a.profitFactor;
        }
        return b.winRate - a.winRate;
      })
      .slice(0, limit);
  }

  /**
   * Get worst performing symbol+confidence combinations
   */
  getWorstPerformers(limit = 5): StrategyMetric[] {
    const metricsArray = Array.from(this.metrics.values())
      .filter(m => m.totalTrades >= this.MIN_SAMPLE_SIZE);

    return metricsArray
      .sort((a, b) => {
        // Sort by profit factor ascending
        if (a.profitFactor !== b.profitFactor) {
          return a.profitFactor - b.profitFactor;
        }
        return a.winRate - b.winRate;
      })
      .slice(0, limit);
  }

  /**
   * Get overall statistics
   */
  getOverallStats(): {
    totalMetrics: number;
    activeMultipliers: number;
    avgWinRate: number;
    avgProfitFactor: number;
    totalTrades: number;
  } {
    const metricsArray = Array.from(this.metrics.values());
    const totalTrades = metricsArray.reduce((sum, m) => sum + m.totalTrades, 0);

    let totalWinRate = 0;
    let totalProfitFactor = 0;
    let count = 0;

    for (const metric of metricsArray) {
      if (metric.totalTrades >= this.MIN_SAMPLE_SIZE) {
        totalWinRate += metric.winRate;
        totalProfitFactor += metric.profitFactor;
        count++;
      }
    }

    return {
      totalMetrics: metricsArray.length,
      activeMultipliers: this.multipliers.size,
      avgWinRate: count > 0 ? totalWinRate / count : 0,
      avgProfitFactor: count > 0 ? totalProfitFactor / count : 0,
      totalTrades,
    };
  }

  /**
   * Reset all learning data
   */
  reset(): void {
    this.metrics.clear();
    this.multipliers.clear();
    console.log('🔄 Learning engine reset');
  }
}

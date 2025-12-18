/**
 * MAE/MFE Calculator Service
 * Calculates Maximum Adverse Excursion and Maximum Favorable Excursion from candle data
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Trade {
  type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  symbol: string;
  candles: Candle[] | any; // Can be JSONB from database
}

interface MAEMFEResult {
  mae: number; // Maximum Adverse Excursion in pips
  mfe: number; // Maximum Favorable Excursion in pips
  maePercent: number; // MAE as % of risk
  mfeRatio: number; // MFE / MAE ratio (efficiency)
  worstDrawdown: number; // Deepest point in pips
  bestProfit: number; // Peak profit in pips
  interpretation: {
    executionQuality: string;
    exitTiming: string;
  };
}

export class MAEMFECalculator {
  /**
   * Calculate MAE and MFE from trade candle data
   */
  calculateMAEMFE(trade: Trade): MAEMFEResult {
    // Parse candles if they're stored as JSONB string
    const candles = typeof trade.candles === 'string'
      ? JSON.parse(trade.candles)
      : trade.candles;

    if (!Array.isArray(candles) || candles.length === 0) {
      return this.getEmptyResult();
    }

    const isLong = trade.type === 'LONG';
    const pipFactor = this.getPipFactor(trade.symbol);

    let maxAdverseExcursion = 0;
    let maxFavorableExcursion = 0;

    for (const candle of candles) {
      if (isLong) {
        // For LONG trades:
        // MAE: How far price moved against us (entry - lowest low)
        const adverseMove = trade.entry_price - candle.low;
        maxAdverseExcursion = Math.max(maxAdverseExcursion, adverseMove);

        // MFE: How far price moved in our favor (highest high - entry)
        const favorableMove = candle.high - trade.entry_price;
        maxFavorableExcursion = Math.max(maxFavorableExcursion, favorableMove);
      } else {
        // For SHORT trades:
        // MAE: How far price moved against us (highest high - entry)
        const adverseMove = candle.high - trade.entry_price;
        maxAdverseExcursion = Math.max(maxAdverseExcursion, adverseMove);

        // MFE: How far price moved in our favor (entry - lowest low)
        const favorableMove = trade.entry_price - candle.low;
        maxFavorableExcursion = Math.max(maxFavorableExcursion, favorableMove);
      }
    }

    // Convert to pips
    const maePips = maxAdverseExcursion * pipFactor;
    const mfePips = maxFavorableExcursion * pipFactor;

    // Calculate risk (distance to stop loss)
    const riskPips = Math.abs(trade.entry_price - trade.stop_loss) * pipFactor;

    // Calculate percentages and ratios
    const maePercent = riskPips > 0 ? (maePips / riskPips) * 100 : 0;
    const mfeRatio = maePips > 0 ? mfePips / maePips : 0;

    return {
      mae: maePips,
      mfe: mfePips,
      maePercent,
      mfeRatio,
      worstDrawdown: maePips,
      bestProfit: mfePips,
      interpretation: {
        executionQuality: this.interpretMAE(maePercent),
        exitTiming: this.interpretMFERatio(mfeRatio)
      }
    };
  }

  /**
   * Get pip factor based on currency pair
   * JPY pairs: 1 pip = 0.01 (2 decimals)
   * Other pairs: 1 pip = 0.0001 (4 decimals)
   */
  private getPipFactor(symbol: string): number {
    return symbol.includes('JPY') ? 100 : 10000;
  }

  /**
   * Interpret MAE as percentage of risk
   */
  private interpretMAE(maePercent: number): string {
    if (maePercent < 20) return 'Excellent - minimal drawdown';
    if (maePercent < 50) return 'Good - acceptable drawdown';
    if (maePercent < 80) return 'Fair - came close to stop loss';
    if (maePercent < 100) return 'Poor - nearly stopped out';
    return 'Very Poor - exceeded stop loss (slippage)';
  }

  /**
   * Interpret MFE/MAE ratio (efficiency)
   */
  private interpretMFERatio(ratio: number): string {
    if (ratio >= 5.0) return 'Excellent - captured most of the move';
    if (ratio >= 3.0) return 'Good - strong profit capture';
    if (ratio >= 2.0) return 'Fair - moderate profit capture';
    if (ratio >= 1.0) return 'Poor - gave back significant profits';
    return 'Very Poor - stopped out near worst point';
  }

  /**
   * Calculate break-even time (when trade first went profitable)
   */
  calculateBreakEvenTime(trade: Trade): Date | null {
    const candles = typeof trade.candles === 'string'
      ? JSON.parse(trade.candles)
      : trade.candles;

    if (!Array.isArray(candles) || candles.length === 0) {
      return null;
    }

    const isLong = trade.type === 'LONG';

    for (const candle of candles) {
      const wasProfit = isLong
        ? candle.high > trade.entry_price
        : candle.low < trade.entry_price;

      if (wasProfit) {
        return new Date(candle.time);
      }
    }

    return null; // Never went into profit
  }

  /**
   * Get empty result (when candles are missing)
   */
  private getEmptyResult(): MAEMFEResult {
    return {
      mae: 0,
      mfe: 0,
      maePercent: 0,
      mfeRatio: 0,
      worstDrawdown: 0,
      bestProfit: 0,
      interpretation: {
        executionQuality: 'Insufficient Data',
        exitTiming: 'Insufficient Data'
      }
    };
  }

  /**
   * Calculate MAE/MFE efficiency score (0-100)
   */
  calculateEfficiencyScore(maeResult: MAEMFEResult): number {
    let score = 100;

    // Penalize high MAE (came too close to stop loss)
    if (maeResult.maePercent > 80) score -= 30;
    else if (maeResult.maePercent > 50) score -= 15;
    else if (maeResult.maePercent > 20) score -= 5;

    // Reward high MFE/MAE ratio (captured the move efficiently)
    if (maeResult.mfeRatio >= 5.0) score += 0; // Perfect
    else if (maeResult.mfeRatio >= 3.0) score -= 5;
    else if (maeResult.mfeRatio >= 2.0) score -= 15;
    else if (maeResult.mfeRatio >= 1.0) score -= 25;
    else score -= 40; // Very poor exit

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Analyze multiple trades to find average MAE/MFE
   */
  analyzePortfolioMAEMFE(trades: Trade[]): {
    avgMAE: number;
    avgMFE: number;
    avgEfficiency: number;
    bestEfficiency: number;
    worstEfficiency: number;
  } {
    if (trades.length === 0) {
      return {
        avgMAE: 0,
        avgMFE: 0,
        avgEfficiency: 0,
        bestEfficiency: 0,
        worstEfficiency: 0
      };
    }

    const results = trades.map(t => this.calculateMAEMFE(t));
    const efficiencies = results.map(r => this.calculateEfficiencyScore(r));

    return {
      avgMAE: results.reduce((sum, r) => sum + r.mae, 0) / results.length,
      avgMFE: results.reduce((sum, r) => sum + r.mfe, 0) / results.length,
      avgEfficiency: efficiencies.reduce((sum, e) => sum + e, 0) / efficiencies.length,
      bestEfficiency: Math.max(...efficiencies),
      worstEfficiency: Math.min(...efficiencies)
    };
  }
}

// Export singleton instance
export const maeMfeCalculator = new MAEMFECalculator();

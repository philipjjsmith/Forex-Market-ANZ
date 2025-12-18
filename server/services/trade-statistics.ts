/**
 * Trade Statistics Service
 * Calculates professional-grade metrics: Sharpe Ratio, Sortino Ratio, Profit Factor, Expectancy
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

interface Trade {
  profit_loss_pips: number;
  outcome: string;
  created_at?: string;
  outcome_time?: string;
}

interface StatisticsResult {
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  expectancy: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  largestWin: number;
  largestLoss: number;
  interpretation: {
    sharpe: string;
    sortino: string;
    profitFactor: string;
  };
}

export class TradeStatisticsService {
  /**
   * Calculate comprehensive statistics for a set of trades
   */
  calculateStatistics(trades: Trade[]): StatisticsResult {
    if (trades.length === 0) {
      return this.getEmptyStatistics();
    }

    const winningTrades = trades.filter(t => t.profit_loss_pips > 0);
    const losingTrades = trades.filter(t => t.profit_loss_pips < 0);

    const winRate = winningTrades.length / trades.length;
    const avgWin = this.calculateAverage(winningTrades.map(t => t.profit_loss_pips));
    const avgLoss = Math.abs(this.calculateAverage(losingTrades.map(t => t.profit_loss_pips)));

    const sharpeRatio = this.calculateSharpeRatio(trades);
    const sortinoRatio = this.calculateSortinoRatio(trades);
    const profitFactor = this.calculateProfitFactor(trades);
    const expectancy = this.calculateExpectancy(trades);

    return {
      sharpeRatio,
      sortinoRatio,
      profitFactor,
      expectancy,
      winRate: winRate * 100, // Convert to percentage
      avgWin,
      avgLoss,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      largestWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profit_loss_pips)) : 0,
      largestLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.profit_loss_pips)) : 0,
      interpretation: {
        sharpe: this.interpretSharpe(sharpeRatio),
        sortino: this.interpretSortino(sortinoRatio),
        profitFactor: this.interpretProfitFactor(profitFactor)
      }
    };
  }

  /**
   * Sharpe Ratio: Risk-adjusted return
   * Formula: (Average Return - Risk Free Rate) / Standard Deviation of Returns
   * Annualized by multiplying by sqrt(252 trading days)
   */
  private calculateSharpeRatio(trades: Trade[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map(t => t.profit_loss_pips);
    const avgReturn = this.calculateAverage(returns);
    const stdDev = this.calculateStdDev(returns);

    if (stdDev === 0) return 0;

    const riskFreeRate = 0; // Conservative assumption for forex
    const sharpe = (avgReturn - riskFreeRate) / stdDev;

    // Annualize (assuming 252 trading days per year)
    return sharpe * Math.sqrt(252);
  }

  /**
   * Sortino Ratio: Risk-adjusted return focusing only on downside volatility
   * Formula: Average Return / Downside Deviation
   * Better than Sharpe because it only penalizes downside volatility
   */
  private calculateSortinoRatio(trades: Trade[]): number {
    if (trades.length < 2) return 0;

    const returns = trades.map(t => t.profit_loss_pips);
    const avgReturn = this.calculateAverage(returns);

    // Calculate downside deviation (only negative returns)
    const downsideReturns = returns.filter(r => r < 0);
    if (downsideReturns.length === 0) return avgReturn > 0 ? 999 : 0; // Perfect trades

    const downsideDeviation = Math.sqrt(
      downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length
    );

    if (downsideDeviation === 0) return 0;

    const sortino = avgReturn / downsideDeviation;

    // Annualize
    return sortino * Math.sqrt(252);
  }

  /**
   * Profit Factor: Gross profit / Gross loss
   * Formula: Sum(Winning Trades) / Abs(Sum(Losing Trades))
   */
  private calculateProfitFactor(trades: Trade[]): number {
    const grossProfit = trades
      .filter(t => t.profit_loss_pips > 0)
      .reduce((sum, t) => sum + t.profit_loss_pips, 0);

    const grossLoss = Math.abs(
      trades
        .filter(t => t.profit_loss_pips < 0)
        .reduce((sum, t) => sum + t.profit_loss_pips, 0)
    );

    if (grossLoss === 0) {
      return grossProfit > 0 ? 999 : 0; // All winners or all breakeven
    }

    return grossProfit / grossLoss;
  }

  /**
   * Expectancy: Average amount you expect to win per trade
   * Formula: (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
   */
  private calculateExpectancy(trades: Trade[]): number {
    const winningTrades = trades.filter(t => t.profit_loss_pips > 0);
    const losingTrades = trades.filter(t => t.profit_loss_pips < 0);

    if (trades.length === 0) return 0;

    const winRate = winningTrades.length / trades.length;
    const lossRate = losingTrades.length / trades.length;

    const avgWin = winningTrades.length > 0
      ? this.calculateAverage(winningTrades.map(t => t.profit_loss_pips))
      : 0;

    const avgLoss = losingTrades.length > 0
      ? Math.abs(this.calculateAverage(losingTrades.map(t => t.profit_loss_pips)))
      : 0;

    return (winRate * avgWin) - (lossRate * avgLoss);
  }

  /**
   * Helper: Calculate average
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  /**
   * Helper: Calculate standard deviation
   */
  private calculateStdDev(numbers: number[]): number {
    if (numbers.length < 2) return 0;

    const avg = this.calculateAverage(numbers);
    const variance = numbers.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) / numbers.length;

    return Math.sqrt(variance);
  }

  /**
   * Interpret Sharpe Ratio
   */
  private interpretSharpe(sharpe: number): string {
    if (sharpe >= 3.0) return 'Exceptional';
    if (sharpe >= 2.0) return 'Excellent';
    if (sharpe >= 1.0) return 'Good';
    if (sharpe >= 0.5) return 'Acceptable';
    return 'Poor';
  }

  /**
   * Interpret Sortino Ratio
   */
  private interpretSortino(sortino: number): string {
    if (sortino >= 3.0) return 'Exceptional';
    if (sortino >= 2.0) return 'Excellent';
    if (sortino >= 1.0) return 'Good';
    return 'Needs Improvement';
  }

  /**
   * Interpret Profit Factor
   */
  private interpretProfitFactor(pf: number): string {
    if (pf >= 2.0) return 'Excellent';
    if (pf >= 1.5) return 'Good';
    if (pf >= 1.0) return 'Acceptable';
    return 'Losing Strategy';
  }

  /**
   * Get empty statistics (for when no trades exist)
   */
  private getEmptyStatistics(): StatisticsResult {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      profitFactor: 0,
      expectancy: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      largestWin: 0,
      largestLoss: 0,
      interpretation: {
        sharpe: 'Insufficient Data',
        sortino: 'Insufficient Data',
        profitFactor: 'Insufficient Data'
      }
    };
  }

  /**
   * Calculate R-Multiple for a single trade
   * R-Multiple = Actual Profit/Loss / Initial Risk
   */
  calculateRMultiple(profitPips: number, riskPips: number): number {
    if (riskPips === 0) return 0;
    return profitPips / riskPips;
  }

  /**
   * Calculate consecutive wins/losses streaks
   */
  calculateStreaks(trades: Trade[]): { longestWinStreak: number; longestLossStreak: number; currentStreak: number } {
    if (trades.length === 0) {
      return { longestWinStreak: 0, longestLossStreak: 0, currentStreak: 0 };
    }

    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    // Sort by outcome time (most recent first)
    const sorted = [...trades].sort((a, b) => {
      const timeA = new Date(a.outcome_time || a.created_at || 0).getTime();
      const timeB = new Date(b.outcome_time || b.created_at || 0).getTime();
      return timeB - timeA;
    });

    for (const trade of sorted) {
      if (trade.profit_loss_pips > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
      } else if (trade.profit_loss_pips < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
      }
    }

    const currentStreak = currentWinStreak > 0 ? currentWinStreak : -currentLossStreak;

    return {
      longestWinStreak,
      longestLossStreak,
      currentStreak
    };
  }
}

// Export singleton instance
export const tradeStatisticsService = new TradeStatisticsService();

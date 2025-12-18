/**
 * Strategy Analyzer Service
 * Analyzes strategy-level performance metrics for comparison and benchmarking
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

import { db } from '../db.js';
import { sql } from 'drizzle-orm';

interface StrategyStats {
  strategyName: string;
  strategyVersion: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  avgDuration: number; // in hours
  totalPips: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
  expectancy: number;
}

interface StrategyComparison {
  current: StrategyStats;
  average: StrategyStats;
  percentile: number;
  rank: string;
}

export class StrategyAnalyzer {
  /**
   * Get statistics for a specific strategy
   */
  async getStrategyStats(
    strategyName: string,
    userId: string,
    version?: string
  ): Promise<StrategyStats | null> {
    try {
      // Build query to get all closed trades for this strategy
      const query = version
        ? sql`
            SELECT
              profit_loss_pips,
              outcome,
              created_at,
              outcome_time
            FROM signal_history
            WHERE user_id = ${userId}
              AND strategy_name = ${strategyName}
              AND strategy_version = ${version}
              AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
              AND outcome_time IS NOT NULL
          `
        : sql`
            SELECT
              profit_loss_pips,
              outcome,
              created_at,
              outcome_time,
              strategy_version
            FROM signal_history
            WHERE user_id = ${userId}
              AND strategy_name = ${strategyName}
              AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
              AND outcome_time IS NOT NULL
          `;

      const result = await db.execute(query);
      const trades = result.rows as any[];

      if (trades.length === 0) {
        return null;
      }

      // Use most recent version if not specified
      const actualVersion = version || trades[0].strategy_version;

      return this.calculateStrategyStats(strategyName, actualVersion, trades);
    } catch (error) {
      console.error('Error fetching strategy stats:', error);
      return null;
    }
  }

  /**
   * Calculate strategy statistics from trades
   */
  private calculateStrategyStats(
    strategyName: string,
    strategyVersion: string,
    trades: any[]
  ): StrategyStats {
    const winningTrades = trades.filter(t => parseFloat(t.profit_loss_pips) > 0);
    const losingTrades = trades.filter(t => parseFloat(t.profit_loss_pips) < 0);

    const totalPips = trades.reduce((sum, t) => sum + parseFloat(t.profit_loss_pips), 0);
    const avgProfit = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss_pips), 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss_pips), 0) / losingTrades.length)
      : 0;

    // Calculate average duration
    const durations = trades
      .filter(t => t.outcome_time && t.created_at)
      .map(t => {
        const start = new Date(t.created_at).getTime();
        const end = new Date(t.outcome_time).getTime();
        return (end - start) / (1000 * 60 * 60); // Convert to hours
      });

    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    // Profit factor
    const grossProfit = winningTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss_pips), 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss_pips), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    // Expectancy
    const winRate = winningTrades.length / trades.length;
    const lossRate = losingTrades.length / trades.length;
    const expectancy = (winRate * avgProfit) - (lossRate * avgLoss);

    // Best and worst trades
    const allPips = trades.map(t => parseFloat(t.profit_loss_pips));
    const bestTrade = allPips.length > 0 ? Math.max(...allPips) : 0;
    const worstTrade = allPips.length > 0 ? Math.min(...allPips) : 0;

    return {
      strategyName,
      strategyVersion,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: winRate * 100,
      avgProfit,
      avgLoss,
      avgDuration,
      totalPips,
      bestTrade,
      worstTrade,
      profitFactor,
      expectancy
    };
  }

  /**
   * Compare a trade to its strategy average
   */
  async compareToStrategyAverage(
    tradeProfit: number,
    strategyName: string,
    userId: string
  ): Promise<StrategyComparison | null> {
    const stats = await this.getStrategyStats(strategyName, userId);

    if (!stats) {
      return null;
    }

    // Calculate percentile (where does this trade rank?)
    const query = sql`
      SELECT profit_loss_pips
      FROM signal_history
      WHERE user_id = ${userId}
        AND strategy_name = ${strategyName}
        AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
      ORDER BY profit_loss_pips DESC
    `;

    const result = await db.execute(query);
    const allTrades = result.rows.map((r: any) => parseFloat(r.profit_loss_pips));

    const betterTrades = allTrades.filter(p => p > tradeProfit).length;
    const percentile = allTrades.length > 0
      ? ((allTrades.length - betterTrades) / allTrades.length) * 100
      : 50;

    // Determine rank
    let rank: string;
    if (percentile >= 90) rank = 'Top 10%';
    else if (percentile >= 75) rank = 'Top 25%';
    else if (percentile >= 50) rank = 'Above Average';
    else if (percentile >= 25) rank = 'Below Average';
    else rank = 'Bottom 25%';

    return {
      current: {
        ...stats,
        avgProfit: tradeProfit
      },
      average: stats,
      percentile,
      rank
    };
  }

  /**
   * Get all strategies for a user
   */
  async getAllStrategies(userId: string): Promise<StrategyStats[]> {
    try {
      const query = sql`
        SELECT DISTINCT strategy_name, strategy_version
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
        ORDER BY strategy_name, strategy_version DESC
      `;

      const result = await db.execute(query);
      const strategies = result.rows as any[];

      const stats: StrategyStats[] = [];

      for (const strategy of strategies) {
        const stat = await this.getStrategyStats(
          strategy.strategy_name,
          userId,
          strategy.strategy_version
        );
        if (stat) {
          stats.push(stat);
        }
      }

      return stats;
    } catch (error) {
      console.error('Error fetching all strategies:', error);
      return [];
    }
  }

  /**
   * Get strategy leaderboard (best performing strategies)
   */
  rankStrategies(strategies: StrategyStats[]): StrategyStats[] {
    // Sort by profit factor (best indicator of overall performance)
    return [...strategies].sort((a, b) => {
      // Primary: Profit factor
      if (Math.abs(b.profitFactor - a.profitFactor) > 0.1) {
        return b.profitFactor - a.profitFactor;
      }

      // Secondary: Win rate
      if (Math.abs(b.winRate - a.winRate) > 5) {
        return b.winRate - a.winRate;
      }

      // Tertiary: Total trades (more data = more reliable)
      return b.totalTrades - a.totalTrades;
    });
  }

  /**
   * Analyze if strategy performance is declining
   */
  async detectPerformanceDecline(
    strategyName: string,
    userId: string
  ): Promise<{
    isDecline: boolean;
    recentWinRate: number;
    historicalWinRate: number;
    recommendation: string;
  }> {
    try {
      // Get last 10 trades
      const recentQuery = sql`
        SELECT profit_loss_pips
        FROM signal_history
        WHERE user_id = ${userId}
          AND strategy_name = ${strategyName}
          AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
        ORDER BY outcome_time DESC
        LIMIT 10
      `;

      const recentResult = await db.execute(recentQuery);
      const recentTrades = recentResult.rows as any[];

      if (recentTrades.length < 10) {
        return {
          isDecline: false,
          recentWinRate: 0,
          historicalWinRate: 0,
          recommendation: 'Insufficient recent trades to detect performance decline'
        };
      }

      // Get historical average (excluding last 10)
      const historicalQuery = sql`
        SELECT profit_loss_pips
        FROM signal_history
        WHERE user_id = ${userId}
          AND strategy_name = ${strategyName}
          AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'MANUALLY_CLOSED')
        ORDER BY outcome_time DESC
        OFFSET 10
      `;

      const historicalResult = await db.execute(historicalQuery);
      const historicalTrades = historicalResult.rows as any[];

      if (historicalTrades.length < 10) {
        return {
          isDecline: false,
          recentWinRate: 0,
          historicalWinRate: 0,
          recommendation: 'Insufficient historical data for comparison'
        };
      }

      const recentWinRate = (recentTrades.filter(t => parseFloat(t.profit_loss_pips) > 0).length / recentTrades.length) * 100;
      const historicalWinRate = (historicalTrades.filter(t => parseFloat(t.profit_loss_pips) > 0).length / historicalTrades.length) * 100;

      const decline = historicalWinRate - recentWinRate;
      const isDecline = decline > 20; // 20% drop is significant

      let recommendation: string;
      if (isDecline) {
        recommendation = `⚠️ Performance decline detected: Recent win rate (${recentWinRate.toFixed(1)}%) is significantly lower than historical (${historicalWinRate.toFixed(1)}%). Consider reviewing strategy parameters or market conditions.`;
      } else if (decline > 10) {
        recommendation = `⚡ Slight performance dip: Recent win rate (${recentWinRate.toFixed(1)}%) vs historical (${historicalWinRate.toFixed(1)}%). Monitor next few trades closely.`;
      } else {
        recommendation = `✅ Performance stable: Recent win rate (${recentWinRate.toFixed(1)}%) consistent with historical (${historicalWinRate.toFixed(1)}%).`;
      }

      return {
        isDecline,
        recentWinRate,
        historicalWinRate,
        recommendation
      };
    } catch (error) {
      console.error('Error detecting performance decline:', error);
      return {
        isDecline: false,
        recentWinRate: 0,
        historicalWinRate: 0,
        recommendation: 'Error analyzing performance trends'
      };
    }
  }
}

// Export singleton instance
export const strategyAnalyzer = new StrategyAnalyzer();

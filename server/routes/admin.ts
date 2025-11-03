import type { Express } from "express";
import { db } from "../db";
import { sql } from 'drizzle-orm';
import { signalGenerator } from '../services/signal-generator';
import { twelveDataAPI } from '../services/twelve-data';
import { exchangeRateAPI } from '../services/exchangerate-api';
import { requireAuth, requireAdmin } from '../auth-middleware';

export function registerAdminRoutes(app: Express) {
  console.log('✅ Admin routes registered');

  /**
   * GET /api/admin/health
   * Returns system health status
   */
  app.get("/api/admin/health", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get pending signals count
      const pendingResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM signal_history
        WHERE outcome = 'PENDING'
      `);
      const pendingSignals = (pendingResult as any)[0]?.count || 0;

      // Get validated today count
      const validatedResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM signal_history
        WHERE outcome_time >= CURRENT_DATE
        AND outcome IN ('TP1_HIT', 'STOP_HIT')
      `);
      const validatedToday = (validatedResult as any)[0]?.count || 0;

      // Get API usage stats
      const exchangeRateStats = exchangeRateAPI.getCacheStats();
      const twelveDataStats = twelveDataAPI.getCacheStats();

      // Calculate cache hit rates (simplified - you'd track this in production)
      const exchangeRateCacheHitRate = exchangeRateStats.size > 0 ? 85 : 0;
      const twelveDataCacheHitRate = twelveDataStats.size > 0 ? 75 : 0;

      const health = {
        status: 'healthy' as const,
        signalGenerator: {
          isRunning: false, // We'd track this in a real implementation
          lastRun: new Date().toISOString(), // Placeholder
          nextRun: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins from now
          signalsGenerated: 0,
          signalsTracked: 0,
        },
        outcomeValidator: {
          isRunning: false,
          lastRun: new Date().toISOString(),
          pendingSignals,
          validatedToday,
        },
        apiUsage: {
          exchangeRateAPI: {
            callsToday: 0, // Would track this in production
            limit: 1500,
            cacheHitRate: exchangeRateCacheHitRate,
          },
          twelveDataAPI: {
            callsToday: 0, // Would track this in production
            limit: 800,
            cacheHitRate: twelveDataCacheHitRate,
          },
        },
      };

      res.json(health);
    } catch (error: any) {
      console.error('Error fetching admin health:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/logs
   * Returns recent signal generation logs
   */
  app.get("/api/admin/logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      // In a real implementation, you'd store these in a separate logs table
      // For now, we'll derive from signal_history
      const result = await db.execute(sql`
        SELECT
          DATE_TRUNC('hour', created_at) as hour,
          COUNT(*) as signals_tracked,
          MIN(created_at) as timestamp
        FROM signal_history
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY hour DESC
        LIMIT 10
      `);

      const logs = (result as any[]).map((row, idx) => ({
        id: `log-${idx}`,
        timestamp: row.timestamp,
        duration: Math.floor(Math.random() * 60) + 30, // Simulated
        pairsProcessed: 5,
        signalsGenerated: parseInt(row.signals_tracked) || 0,
        signalsTracked: parseInt(row.signals_tracked) || 0,
        errors: [],
        status: 'success' as const,
      }));

      res.json(logs);
    } catch (error: any) {
      console.error('Error fetching admin logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/admin/trigger-generation
   * Manually trigger signal generation
   */
  app.post("/api/admin/trigger-generation", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('🎯 Manual signal generation triggered by admin');

      // Trigger generation in the background
      signalGenerator.generateSignals().catch(error => {
        console.error('Error in manual signal generation:', error);
      });

      res.json({
        success: true,
        message: 'Signal generation started. Check logs for progress.'
      });
    } catch (error: any) {
      console.error('Error triggering generation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/growth-stats
   * Returns growth tracking metrics and profitability data
   * Query params:
   * - days: filter by days (7, 30, 90, or 0 for all time - default 0)
   */
  app.get("/api/admin/growth-stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 0; // 0 = all time

      // Build date filter
      const dateFilter = days > 0
        ? sql`AND outcome_time >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
        : sql``;

      // 1. Overall metrics
      const overallResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COALESCE(SUM(profit_loss_pips), 0) as total_profit_pips,
          COALESCE(AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')), 0) as avg_win_pips,
          COALESCE(AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'), 0) as avg_loss_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history
        WHERE outcome != 'PENDING'
          ${dateFilter}
      `);

      const overall = (overallResult as any)[0];

      // 2. Cumulative profit over time (daily aggregation)
      const cumulativeProfitResult = await db.execute(sql`
        WITH daily_profits AS (
          SELECT
            DATE(outcome_time) as date,
            SUM(profit_loss_pips) as daily_pips
          FROM signal_history
          WHERE outcome != 'PENDING'
            ${dateFilter}
          GROUP BY DATE(outcome_time)
          ORDER BY date ASC
        )
        SELECT
          date,
          daily_pips,
          SUM(daily_pips) OVER (ORDER BY date ASC) as cumulative_pips
        FROM daily_profits
      `);

      // 3. Monthly comparison
      const monthlyResult = await db.execute(sql`
        SELECT
          DATE_TRUNC('month', outcome_time) as month,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history
        WHERE outcome != 'PENDING'
          ${dateFilter}
        GROUP BY DATE_TRUNC('month', outcome_time)
        ORDER BY month DESC
        LIMIT 12
      `);

      // 4. Symbol performance comparison
      const symbolResult = await db.execute(sql`
        SELECT
          symbol,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history
        WHERE outcome != 'PENDING'
          ${dateFilter}
        GROUP BY symbol
        ORDER BY profit_pips DESC
      `);

      // 5. Calculate key metrics
      const totalTrades = parseInt(overall.wins) + parseInt(overall.losses);
      const winRate = parseFloat(overall.win_rate) || 0;
      const avgWinPips = parseFloat(overall.avg_win_pips) || 0;
      const avgLossPips = parseFloat(overall.avg_loss_pips) || 0;

      // Profit Factor = (Wins * AvgWin) / (Losses * AvgLoss)
      const totalWinPips = parseInt(overall.wins) * avgWinPips;
      const totalLossPips = parseInt(overall.losses) * avgLossPips;
      const profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;

      // Sharpe Ratio approximation (simplified)
      const avgProfitPerTrade = parseFloat(overall.total_profit_pips) / totalTrades || 0;
      const sharpeRatio = avgProfitPerTrade > 0 ? (avgProfitPerTrade / 100) : 0; // Simplified

      // Max Drawdown (proper peak-to-trough calculation)
      let peak = 0;
      let maxDrawdown = 0;

      for (const point of cumulativeProfitResult as any[]) {
        const current = parseFloat(point.cumulative_pips);

        if (current > peak) {
          peak = current;
        }

        const drawdown = peak - current;

        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      res.json({
        overall: {
          totalSignals: parseInt(overall.total_signals),
          wins: parseInt(overall.wins),
          losses: parseInt(overall.losses),
          totalProfitPips: parseFloat(overall.total_profit_pips),
          winRate,
          avgWinPips,
          avgLossPips,
          profitFactor: parseFloat(profitFactor.toFixed(2)),
          sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
          maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
        },
        cumulativeProfit: cumulativeProfitResult as any[],
        monthlyComparison: monthlyResult as any[],
        symbolPerformance: symbolResult as any[],
        timeframe: days === 0 ? 'All Time' : `Last ${days} days`,
      });
    } catch (error: any) {
      console.error('Error fetching growth stats:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

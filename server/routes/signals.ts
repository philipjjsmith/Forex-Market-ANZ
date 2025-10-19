import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../auth-middleware";

/**
 * Signal Tracking API Routes
 * Handles saving signals to database and fetching performance data
 */

// Helper to convert string numbers to actual numbers
function parseNumericFields(obj: any, fields: string[]): any {
  const parsed = { ...obj };
  fields.forEach(field => {
    if (parsed[field] !== null && parsed[field] !== undefined) {
      parsed[field] = parseFloat(parsed[field]);
    }
  });
  return parsed;
}

export function registerSignalRoutes(app: Express) {

  /**
   * POST /api/signals/track
   * Save a 70%+ confidence signal for tracking
   */
  app.post("/api/signals/track", requireAuth, async (req, res) => {
    try {
      const { signal, candles } = req.body;

      // Validate signal has minimum 70% confidence
      if (!signal || signal.confidence < 70) {
        return res.status(400).json({
          message: "Only signals with 70%+ confidence can be tracked"
        });
      }

      // Get user from authenticated request
      const userId = req.userId!;

      if (!userId) {
        return res.status(401).json({
          message: "Must be logged in to track signals"
        });
      }

      // Insert signal into database
      await db.execute(sql`
        INSERT INTO signal_history (
          signal_id,
          user_id,
          symbol,
          type,
          confidence,
          entry_price,
          current_price,
          stop_loss,
          tp1,
          tp2,
          tp3,
          stop_limit_price,
          order_type,
          execution_type,
          strategy_name,
          strategy_version,
          indicators,
          candles,
          created_at,
          expires_at
        ) VALUES (
          ${signal.id},
          ${userId},
          ${signal.symbol},
          ${signal.type},
          ${signal.confidence},
          ${signal.entry},
          ${signal.currentPrice},
          ${signal.stop},
          ${signal.targets[0]},
          ${signal.targets[1]},
          ${signal.targets[2]},
          ${signal.stopLimitPrice || null},
          ${signal.orderType},
          ${signal.executionType},
          ${signal.strategy},
          ${signal.version},
          ${JSON.stringify(signal.indicators)},
          ${JSON.stringify(candles)},
          NOW(),
          NOW() + INTERVAL '48 hours'
        )
        ON CONFLICT (signal_id) DO NOTHING
      `);

      res.json({
        success: true,
        message: "Signal tracked successfully",
        signalId: signal.id
      });

    } catch (error: any) {
      console.error("Error tracking signal:", error);
      res.status(500).json({
        message: "Failed to track signal",
        error: error.message
      });
    }
  });

  /**
   * GET /api/signals/active
   * Get all active (pending) signals for current user
   */
  app.get("/api/signals/active", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      const result = await db.execute(sql`
        SELECT
          signal_id,
          symbol,
          type,
          confidence,
          entry_price,
          current_price,
          stop_loss,
          tp1,
          tp2,
          tp3,
          order_type,
          execution_type,
          created_at,
          expires_at,
          indicators
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome = 'PENDING'
          AND expires_at > NOW()
        ORDER BY created_at DESC
      `);

      // Parse numeric fields (postgres returns DECIMAL as strings)
      const signals = (result as any[]).map((signal: any) =>
        parseNumericFields(signal, [
          'confidence', 'entry_price', 'current_price', 'stop_loss', 'tp1', 'tp2', 'tp3'
        ])
      );

      res.json({
        signals
      });

    } catch (error: any) {
      console.error("Error fetching active signals:", error);
      res.status(500).json({
        message: "Failed to fetch active signals",
        error: error.message
      });
    }
  });

  /**
   * GET /api/signals/performance
   * Get performance metrics for current user
   */
  app.get("/api/signals/performance", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      // Get overall stats
      const overallResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
          COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
          ROUND(
            (COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT'))::DECIMAL /
            NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0)) * 100,
            2
          ) as win_rate,
          AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as avg_win_pips,
          AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT') as avg_loss_pips
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome != 'PENDING'
      `);

      const overall = (overallResult as any)[0];

      // Get per-symbol breakdown
      const symbolResult = await db.execute(sql`
        SELECT
          symbol,
          confidence_bracket,
          total_signals,
          tp1_hit + tp2_hit + tp3_hit as wins,
          stop_hit as losses,
          win_rate,
          avg_profit_pips,
          avg_loss_pips
        FROM strategy_performance
        WHERE user_id = ${userId}
        ORDER BY symbol, confidence_bracket
      `);

      const bySymbol = symbolResult as any;

      // Check if user has enough data for insights
      const totalCompleted = parseInt(overall.total_signals) - parseInt(overall.pending);
      const insightsUnlocked = totalCompleted >= 10;
      const advancedUnlocked = totalCompleted >= 30;

      res.json({
        overall: {
          totalSignals: parseInt(overall.total_signals),
          wins: parseInt(overall.wins),
          losses: parseInt(overall.losses),
          expired: parseInt(overall.expired),
          pending: parseInt(overall.pending),
          winRate: parseFloat(overall.win_rate) || 0,
          avgWinPips: parseFloat(overall.avg_win_pips) || 0,
          avgLossPips: parseFloat(overall.avg_loss_pips) || 0,
        },
        bySymbol,
        unlocks: {
          insightsUnlocked,
          advancedUnlocked,
          signalsNeededForInsights: Math.max(0, 10 - totalCompleted),
          signalsNeededForAdvanced: Math.max(0, 30 - totalCompleted),
        }
      });

    } catch (error: any) {
      console.error("Error fetching performance:", error);
      res.status(500).json({
        message: "Failed to fetch performance data",
        error: error.message
      });
    }
  });

  /**
   * POST /api/signals/:signalId/close
   * Manually close a signal (user exited early)
   */
  app.post("/api/signals/:signalId/close", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;
      const { signalId } = req.params;
      const { closePrice } = req.body;

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      if (!closePrice) {
        return res.status(400).json({ message: "Close price required" });
      }

      // Get signal details
      const signalResult = await db.execute(sql`
        SELECT type, entry_price, user_id
        FROM signal_history
        WHERE signal_id = ${signalId}
        LIMIT 1
      `);

      const signal = (signalResult as any)[0];

      if (!signal) {
        return res.status(404).json({ message: "Signal not found" });
      }

      if (signal.user_id !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      // Calculate profit/loss
      const pipValue = 0.0001;
      let profitLossPips: number;

      if (signal.type === 'LONG') {
        profitLossPips = (closePrice - signal.entry_price) / pipValue;
      } else {
        profitLossPips = (signal.entry_price - closePrice) / pipValue;
      }

      // Update signal
      await db.execute(sql`
        UPDATE signal_history
        SET
          outcome = 'MANUALLY_CLOSED',
          outcome_price = ${closePrice},
          outcome_time = NOW(),
          profit_loss_pips = ${profitLossPips},
          manually_closed_by_user = true,
          updated_at = NOW()
        WHERE signal_id = ${signalId}
      `);

      res.json({
        success: true,
        message: "Signal closed successfully",
        profitLossPips: profitLossPips.toFixed(1)
      });

    } catch (error: any) {
      console.error("Error closing signal:", error);
      res.status(500).json({
        message: "Failed to close signal",
        error: error.message
      });
    }
  });

  /**
   * GET /api/signals/history
   * Get completed signals history
   */
  app.get("/api/signals/history", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 50;

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      const result = await db.execute(sql`
        SELECT
          signal_id,
          symbol,
          type,
          confidence,
          entry_price,
          stop_loss,
          tp1,
          outcome,
          outcome_price,
          outcome_time,
          profit_loss_pips,
          manually_closed_by_user,
          created_at
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome != 'PENDING'
        ORDER BY outcome_time DESC
        LIMIT ${limit}
      `);

      // Parse numeric fields
      const history = (result as any[]).map((signal: any) =>
        parseNumericFields(signal, [
          'confidence', 'entry_price', 'stop_loss', 'tp1', 'outcome_price', 'profit_loss_pips'
        ])
      );

      res.json({
        history
      });

    } catch (error: any) {
      console.error("Error fetching history:", error);
      res.status(500).json({
        message: "Failed to fetch signal history",
        error: error.message
      });
    }
  });
}

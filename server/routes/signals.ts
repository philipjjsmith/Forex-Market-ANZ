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

// Generate demo/example winning trades when no real trades are available
function generateDemoWinningTrades(count: number = 3): any[] {
  const now = new Date();
  const demoTrades = [
    {
      signal_id: 'demo-eurusd-tp3',
      symbol: 'EUR/USD',
      type: 'LONG',
      confidence: 92,
      tier: 'HIGH',
      entry_price: 1.08450,
      stop_loss: 1.08150,
      tp1: 1.08750,
      tp2: 1.09050,
      tp3: 1.09350,
      outcome: 'TP3_HIT',
      outcome_price: 1.09350,
      profit_loss_pips: 90.0,
      indicators: {
        rsi: '58.2',
        adx: '34.5',
        macd: { value: 0.00045, signal: 0.00032, histogram: 0.00013 },
        ema20: 1.08350,
        ema50: 1.08100,
        atr: 0.00089,
        bb: { upper: 1.08950, middle: 1.08450, lower: 1.07950 }
      },
      candles: generateDemoCandles('EUR/USD', 1.08450, 1.09350, 48),
      strategy_name: 'ICT 3-Timeframe Strategy',
      strategy_version: 'v3.1.0',
      created_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
      outcome_time: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      duration: '2d',
      durationHours: 48,
      achievedRR: 3.0,
      manually_closed_by_user: false
    },
    {
      signal_id: 'demo-usdjpy-tp2',
      symbol: 'USD/JPY',
      type: 'SHORT',
      confidence: 88,
      tier: 'HIGH',
      entry_price: 149.850,
      stop_loss: 150.350,
      tp1: 149.350,
      tp2: 148.850,
      tp3: 148.350,
      outcome: 'TP2_HIT',
      outcome_price: 148.850,
      profit_loss_pips: 100.0,
      indicators: {
        rsi: '42.8',
        adx: '31.2',
        macd: { value: -0.085, signal: -0.062, histogram: -0.023 },
        ema20: 150.050,
        ema50: 150.450,
        atr: 0.425,
        bb: { upper: 150.650, middle: 149.850, lower: 149.050 }
      },
      candles: generateDemoCandles('USD/JPY', 149.850, 148.850, 36),
      strategy_name: 'ICT 3-Timeframe Strategy',
      strategy_version: 'v3.1.0',
      created_at: new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString(),
      outcome_time: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      duration: '1d 12h',
      durationHours: 36,
      achievedRR: 2.0,
      manually_closed_by_user: false
    },
    {
      signal_id: 'demo-eurusd-tp1',
      symbol: 'EUR/USD',
      type: 'SHORT',
      confidence: 85,
      tier: 'HIGH',
      entry_price: 1.09200,
      stop_loss: 1.09500,
      tp1: 1.08900,
      tp2: 1.08600,
      tp3: 1.08300,
      outcome: 'TP1_HIT',
      outcome_price: 1.08900,
      profit_loss_pips: 30.0,
      indicators: {
        rsi: '38.5',
        adx: '28.9',
        macd: { value: -0.00032, signal: -0.00015, histogram: -0.00017 },
        ema20: 1.09350,
        ema50: 1.09550,
        atr: 0.00076,
        bb: { upper: 1.09850, middle: 1.09200, lower: 1.08550 }
      },
      candles: generateDemoCandles('EUR/USD', 1.09200, 1.08900, 18),
      strategy_name: 'ICT 3-Timeframe Strategy',
      strategy_version: 'v3.1.0',
      created_at: new Date(now.getTime() - 18 * 60 * 60 * 1000).toISOString(),
      outcome_time: new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString(),
      duration: '18h',
      durationHours: 18,
      achievedRR: 1.0,
      manually_closed_by_user: false
    }
  ];

  return demoTrades.slice(0, count);
}

// Generate realistic demo candles for charting
function generateDemoCandles(symbol: string, startPrice: number, endPrice: number, hours: number): any[] {
  const candles = [];
  const priceStep = (endPrice - startPrice) / hours;
  // Aggressive volatility for maximum chart visibility (60-87% of Y-range)
  const volatility = symbol.includes('JPY') ? 1.0 : 0.0060; // 2x increase from previous attempt
  const trendStrength = 0.7; // How much candles follow the trend vs random

  for (let i = 0; i < Math.min(hours * 4, 200); i++) { // 15-min candles, max 200
    const time = new Date(Date.now() - (hours * 60 - i * 15) * 60 * 1000);
    const basePrice = startPrice + (priceStep * i / 4);

    // Add realistic market noise and trend-following behavior
    const trendMove = priceStep / 4 * trendStrength;
    const randomMove = (Math.random() - 0.5) * volatility * (1 - trendStrength);

    const open = basePrice + (Math.random() - 0.5) * volatility * 0.6; // 2x multiplier for larger candle bodies
    const close = open + trendMove + randomMove;

    // Create realistic wicks (shadows)
    const wickSize = volatility * (0.3 + Math.random() * 0.4);
    const high = Math.max(open, close) + wickSize * Math.random();
    const low = Math.min(open, close) - wickSize * Math.random();

    candles.push({
      date: time.toISOString(),
      timestamp: time,
      open: parseFloat(open.toFixed(symbol.includes('JPY') ? 3 : 5)),
      high: parseFloat(high.toFixed(symbol.includes('JPY') ? 3 : 5)),
      low: parseFloat(low.toFixed(symbol.includes('JPY') ? 3 : 5)),
      close: parseFloat(close.toFixed(symbol.includes('JPY') ? 3 : 5))
    });
  }

  return candles;
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
          tier,
          trade_live,
          position_size_percent,
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
          ${signal.tier || (signal.confidence >= 85 ? 'HIGH' : 'MEDIUM')},
          ${signal.tradeLive !== undefined ? signal.tradeLive : (signal.confidence >= 85)},
          ${signal.positionSizePercent !== undefined ? signal.positionSizePercent : (signal.confidence >= 85 ? 1.00 : 0.00)},
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
   * Includes both user-specific manual signals AND global automated signals from ai-system
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
          tier,
          trade_live,
          position_size_percent,
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
        WHERE (
          user_id = ${userId}
          OR user_id = (SELECT id FROM users WHERE email = 'ai@system.internal')
        )
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
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0)) * 100,
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
      // 🔧 FIX: JPY pairs use 0.01 for 1 pip, all other pairs use 0.0001
      const pipValue = signal.symbol.includes('JPY') ? 0.01 : 0.0001;
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
   * GET /api/signals/winning-trades-week
   * Get top winning trades from the past 7 days for dashboard showcase
   * Includes full chart data (candles) and technical indicators for detailed analysis
   * Query params:
   * - limit: number of trades to return (default 5, max 10)
   * - includeDemo: if true, shows demo trades when no real trades available (default true)
   */
  app.get("/api/signals/winning-trades-week", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 10);
      const includeDemo = req.query.includeDemo !== 'false'; // Default to true

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      // Fetch winning trades from past 30 days (extended from 7 to show more examples)
      // Note: tier, trade_live, position_size_percent columns removed for backwards compatibility
      // tier is calculated from confidence (85+ = HIGH, 70-84 = MEDIUM)
      const result = await db.execute(sql`
        SELECT
          signal_id,
          symbol,
          type,
          confidence,
          entry_price,
          stop_loss,
          tp1,
          tp2,
          tp3,
          outcome,
          outcome_price,
          outcome_time,
          profit_loss_pips,
          indicators,
          candles,
          strategy_name,
          strategy_version,
          created_at,
          manually_closed_by_user
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')
          AND outcome_time >= NOW() - INTERVAL '30 days'
          AND profit_loss_pips > 0
        ORDER BY profit_loss_pips DESC
        LIMIT ${limit}
      `);

      // Parse numeric fields and calculate additional metrics
      let trades = (result as any[]).map((trade: any) => {
        const parsed = parseNumericFields(trade, [
          'confidence',
          'entry_price',
          'stop_loss',
          'tp1',
          'tp2',
          'tp3',
          'outcome_price',
          'profit_loss_pips'
        ]);

        // Calculate trade duration in hours
        const createdAt = new Date(parsed.created_at);
        const outcomeTime = new Date(parsed.outcome_time);
        const durationMs = outcomeTime.getTime() - createdAt.getTime();
        const durationHours = Math.round(durationMs / (1000 * 60 * 60));

        // Calculate achieved risk:reward ratio
        const riskPips = Math.abs(parsed.entry_price - parsed.stop_loss);
        const pipValue = trade.symbol.includes('JPY') ? 0.01 : 0.0001;
        const riskInPips = riskPips / pipValue;
        const achievedRR = riskInPips > 0 ? (parsed.profit_loss_pips / riskInPips).toFixed(2) : '0.00';

        // Format duration as human-readable string
        let durationFormatted: string;
        if (durationHours < 24) {
          durationFormatted = `${durationHours}h`;
        } else {
          const days = Math.floor(durationHours / 24);
          const hours = durationHours % 24;
          durationFormatted = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
        }

        return {
          ...parsed,
          tier: parsed.confidence >= 85 ? 'HIGH' : 'MEDIUM', // Calculate tier from confidence
          duration: durationFormatted,
          durationHours,
          achievedRR: parseFloat(achievedRR)
        };
      });

      // If no real trades found and demo is enabled, return demo/example trades
      if (trades.length === 0 && includeDemo) {
        trades = generateDemoWinningTrades(limit);
      }

      res.json({
        trades,
        count: trades.length,
        isDemo: trades.length > 0 && result.length === 0 && includeDemo
      });

    } catch (error: any) {
      console.error("Error fetching winning trades:", error);
      res.status(500).json({
        message: "Failed to fetch winning trades",
        error: error.message
      });
    }
  });

  /**
   * GET /api/signals/history
   * Get completed signals history with pagination and filters
   * Query params:
   * - limit: number of signals to return (default 50)
   * - offset: number of signals to skip for pagination (default 0)
   * - days: filter by days (7, 30, 90, or 0 for all time - default 0)
   */
  app.get("/api/signals/history", requireAuth, async (req, res) => {
    try {
      const userId = req.userId!;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const days = parseInt(req.query.days as string) || 0; // 0 = all time

      if (!userId) {
        return res.status(401).json({ message: "Must be logged in" });
      }

      // Build date filter condition
      const dateFilter = days > 0
        ? sql`AND outcome_time >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
        : sql``;

      // Get total count for pagination
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total
        FROM signal_history
        WHERE user_id = ${userId}
          AND outcome != 'PENDING'
          ${dateFilter}
      `);

      const total = parseInt((countResult as any)[0]?.total || '0');

      // Get paginated results
      const result = await db.execute(sql`
        SELECT
          signal_id,
          symbol,
          type,
          confidence,
          tier,
          trade_live,
          position_size_percent,
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
          ${dateFilter}
        ORDER BY outcome_time DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `);

      // Parse numeric fields
      const history = (result as any[]).map((signal: any) =>
        parseNumericFields(signal, [
          'confidence', 'entry_price', 'stop_loss', 'tp1', 'outcome_price', 'profit_loss_pips'
        ])
      );

      res.json({
        history,
        total,
        limit,
        offset,
        hasMore: offset + history.length < total
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

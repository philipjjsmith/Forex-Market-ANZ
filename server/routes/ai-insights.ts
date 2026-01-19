import type { Express } from "express";
import { db } from "../db";
import { sql } from 'drizzle-orm';
import { aiAnalyzer } from '../services/ai-analyzer';
import { backtester } from '../services/backtester';
import { parameterService } from '../services/parameter-service';
import { requireAuth, requireAdmin } from '../auth-middleware';

/**
 * AI Insights API Routes
 * Provides data for the AI learning dashboard
 */
export function registerAIRoutes(app: Express) {
  console.log('✅ AI insights routes registered');

  /**
   * GET /api/ai/insights
   * Returns overall AI learning status
   */
  app.get("/api/ai/insights", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get overall statistics
      const statsResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history
      `);

      const stats = (statsResult as any)[0];

      // Get pending recommendations count
      const recsResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM strategy_adaptations
        WHERE status = 'pending'
      `);

      const pendingRecs = (recsResult as any)[0]?.count || 0;

      // Get all cached insights
      const allInsights = aiAnalyzer.getAllInsights();

      res.json({
        totalSignals: parseInt(stats.total_signals) || 0,
        completedSignals: parseInt(stats.completed_signals) || 0,
        wins: parseInt(stats.wins) || 0,
        losses: parseInt(stats.losses) || 0,
        winRate: parseFloat(stats.win_rate) || 0,
        pendingRecommendations: pendingRecs,
        lastAnalysis: new Date(),
        symbolInsights: allInsights.map(insight => ({
          symbol: insight.symbol,
          totalSignals: insight.totalSignals,
          winRate: insight.winRate,
          hasEnoughData: insight.hasEnoughData,
        })),
      });
    } catch (error: any) {
      console.error('❌ Error fetching AI insights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ai/insights/:symbol
   * Returns detailed insights for a specific symbol
   */
  app.get("/api/ai/insights/:symbol", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { symbol } = req.params;

      // Get cached insights
      const insights = aiAnalyzer.getSymbolInsights(symbol);

      // Get recent signals for this symbol
      const recentSignals = await db.execute(sql`
        SELECT
          signal_id,
          type,
          confidence,
          outcome,
          profit_loss_pips,
          created_at
        FROM signal_history
        WHERE symbol = ${symbol}
          AND outcome != 'PENDING'
        ORDER BY created_at DESC
        LIMIT 10
      `);

      res.json({
        ...insights,
        recentSignals: recentSignals as any[],
      });
    } catch (error: any) {
      console.error('❌ Error fetching symbol insights:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ai/recommendations
   * Returns pending AI-generated recommendations
   */
  app.get("/api/ai/recommendations", requireAuth, requireAdmin, async (req, res) => {
    try {
      const recs = await db.execute(sql`
        SELECT
          id,
          pattern_detected,
          confidence_bracket,
          symbol,
          recommendation_title,
          recommendation_details,
          reasoning,
          suggested_changes,
          expected_win_rate_improvement,
          based_on_signals,
          status,
          old_strategy_version,
          created_at
        FROM strategy_adaptations
        WHERE status = 'pending'
        ORDER BY expected_win_rate_improvement DESC, created_at DESC
      `);

      res.json(recs as any[]);
    } catch (error: any) {
      console.error('❌ Error fetching recommendations:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/recommendations/:id/approve
   * Approve and apply an AI recommendation
   * Milestone 3C: Recommendation Approval System
   */
  app.post("/api/ai/recommendations/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Get recommendation details
      const recResult = await db.execute(sql`
        SELECT * FROM strategy_adaptations
        WHERE id = ${id}
      `);

      if (!recResult || (recResult as any[]).length === 0) {
        return res.status(404).json({ error: 'Recommendation not found' });
      }

      const recommendation = (recResult as any[])[0];

      // Increment strategy version (1.0.0 → 1.1.0)
      const newVersion = incrementVersion(recommendation.old_strategy_version);

      // Mark as approved and applied
      await db.execute(sql`
        UPDATE strategy_adaptations
        SET
          status = 'approved',
          user_decision_at = NOW(),
          applied_at = NOW(),
          new_strategy_version = ${newVersion}
        WHERE id = ${id}
      `);

      // Clear parameter cache for this symbol
      parameterService.clearCache(recommendation.symbol);

      console.log(`✅ [Milestone 3C] Recommendation ${id} approved`);
      console.log(`   Symbol: ${recommendation.symbol}`);
      console.log(`   Title: ${recommendation.recommendation_title}`);
      console.log(`   Version: ${recommendation.old_strategy_version} → ${newVersion}`);
      console.log(`   Expected improvement: +${recommendation.expected_win_rate_improvement}%`);
      console.log(`   Changes: ${JSON.stringify(recommendation.suggested_changes)}`);

      res.json({
        success: true,
        message: `Recommendation approved! Parameters will apply to next ${recommendation.symbol} signals.`,
        newVersion,
        symbol: recommendation.symbol,
        improvement: recommendation.expected_win_rate_improvement,
      });
    } catch (error: any) {
      console.error('❌ Error approving recommendation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/recommendations/:id/reject
   * Reject an AI recommendation
   */
  app.post("/api/ai/recommendations/:id/reject", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      await db.execute(sql`
        UPDATE strategy_adaptations
        SET
          status = 'rejected',
          user_decision_at = NOW()
        WHERE id = ${id}
      `);

      console.log(`❌ Recommendation ${id} rejected`);

      res.json({
        success: true,
        message: 'Recommendation rejected.',
      });
    } catch (error: any) {
      console.error('❌ Error rejecting recommendation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/analyze
   * Manually trigger AI analysis
   */
  app.post("/api/ai/analyze", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('🎯 Manual AI analysis triggered');

      // Trigger analysis in the background
      aiAnalyzer.analyzeAllSymbols().catch(error => {
        console.error('Error in manual AI analysis:', error);
      });

      res.json({
        success: true,
        message: 'AI analysis started. Check insights in 30-60 seconds.',
      });
    } catch (error: any) {
      console.error('❌ Error triggering analysis:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ai/performance/:symbol
   * Returns performance breakdown by indicator conditions
   */
  app.get("/api/ai/performance/:symbol", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { symbol } = req.params;

      // Query for RSI effectiveness
      const rsiPerformance = await db.execute(sql`
        SELECT
          CASE
            WHEN (indicators->>'rsi')::FLOAT BETWEEN 40 AND 70 THEN 'RSI_MODERATE'
            WHEN (indicators->>'rsi')::FLOAT > 70 THEN 'RSI_OVERBOUGHT'
            WHEN (indicators->>'rsi')::FLOAT < 30 THEN 'RSI_OVERSOLD'
            ELSE 'RSI_UNKNOWN'
          END as rsi_zone,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            COUNT(*),
            2
          ) as win_rate
        FROM signal_history
        WHERE symbol = ${symbol}
          AND outcome != 'PENDING'
          AND indicators->>'rsi' != 'N/A'
        GROUP BY rsi_zone
        ORDER BY win_rate DESC
      `);

      // Query for ADX effectiveness
      const adxPerformance = await db.execute(sql`
        SELECT
          CASE
            WHEN (indicators->>'adx')::FLOAT > 25 THEN 'STRONG_TREND'
            WHEN (indicators->>'adx')::FLOAT >= 20 THEN 'MODERATE_TREND'
            ELSE 'WEAK_TREND'
          END as trend_strength,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            COUNT(*),
            2
          ) as win_rate
        FROM signal_history
        WHERE symbol = ${symbol}
          AND outcome != 'PENDING'
          AND indicators->>'adx' != 'N/A'
        GROUP BY trend_strength
        ORDER BY win_rate DESC
      `);

      res.json({
        symbol,
        rsiPerformance: rsiPerformance as any[],
        adxPerformance: adxPerformance as any[],
      });
    } catch (error: any) {
      console.error('❌ Error fetching performance breakdown:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/backtest
   * Trigger parameter optimization backtesting
   * Milestone 3B: Backtesting Engine
   */
  app.post("/api/ai/backtest", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('🔬 Manual backtesting triggered');

      // Trigger backtesting in the background
      backtester.backtestAllSymbols().catch(error => {
        console.error('Error in manual backtesting:', error);
      });

      res.json({
        success: true,
        message: 'Backtesting started. Check recommendations in AI Insights when complete.',
      });
    } catch (error: any) {
      console.error('❌ Error triggering backtesting:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/backtest/:symbol
   * Trigger backtesting for a specific symbol
   */
  app.post("/api/ai/backtest/:symbol", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { symbol } = req.params;
      console.log(`🔬 Backtesting triggered for ${symbol}`);

      // Trigger backtesting in the background
      backtester.backtestSymbol(symbol).catch(error => {
        console.error(`Error backtesting ${symbol}:`, error);
      });

      res.json({
        success: true,
        message: `Backtesting started for ${symbol}. Check recommendations when complete.`,
      });
    } catch (error: any) {
      console.error('❌ Error triggering symbol backtesting:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ai/metrics
   * 📊 COMPREHENSIVE METRICS DASHBOARD - INDUSTRY GRADE 2026
   *
   * Query Parameters:
   * - version: Filter by strategy version (e.g., "3.1.0")
   * - since: Filter by date (e.g., "2026-01-17")
   * - tier: Filter by tier ("HIGH" or "MEDIUM")
   *
   * Returns professional-grade trading metrics including:
   * - Overall performance (win rate, profit factor, Sharpe ratio)
   * - Risk-adjusted metrics (Sortino, Calmar, SQN)
   * - R-Multiple analysis
   * - Per-symbol breakdown
   * - Live trading vs practice metrics
   * - Drawdown analysis
   *
   * Based on Van Tharp methodology and hedge fund standards
   */
  app.get("/api/ai/metrics", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Extract filter parameters
      const { version, since, tier } = req.query;

      // Build WHERE clause dynamically
      let whereConditions: string[] = [];
      if (version) {
        whereConditions.push(`strategy_version = '${version}'`);
      }
      if (since) {
        whereConditions.push(`created_at >= '${since}'`);
      }
      if (tier) {
        whereConditions.push(`tier = '${tier}'`);
      }

      const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      const completedWhereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')} AND outcome != 'PENDING'`
        : `WHERE outcome != 'PENDING'`;

      // 1. Overall System Performance with filters
      const overallStats = await db.execute(sql.raw(`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COUNT(*) FILTER (WHERE outcome = 'EXPIRED') as expired,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          SUM(CASE
            WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN ABS(profit_loss_pips)
            ELSE 0
          END) as total_win_pips,
          SUM(CASE
            WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips)
            ELSE 0
          END) as total_loss_pips,
          SUM(profit_loss_pips) as net_pips,
          AVG(CASE WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN profit_loss_pips END) as avg_win_pips,
          AVG(CASE WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips) END) as avg_loss_pips,
          MIN(created_at) as first_signal_date,
          MAX(created_at) as last_signal_date
        FROM signal_history
        ${whereClause}
      `)) as any[];

      const overall = overallStats[0];

      // ============================================================
      // PROFIT FACTOR (Gross Profits / Gross Losses)
      // Good: >1.5, Excellent: >2.0
      // ============================================================
      const profitFactor = parseFloat(overall.total_loss_pips) > 0
        ? (parseFloat(overall.total_win_pips) / parseFloat(overall.total_loss_pips))
        : 0;

      // ============================================================
      // PAYOFF RATIO (Average Win / Average Loss)
      // Target: >2.0 for 2:1 Risk-Reward
      // ============================================================
      const avgWin = parseFloat(overall.avg_win_pips) || 0;
      const avgLoss = parseFloat(overall.avg_loss_pips) || 0;
      const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

      // ============================================================
      // EXPECTANCY (Edge per trade)
      // Formula: (Win% × AvgWin) - (Loss% × AvgLoss)
      // ============================================================
      const winRate = parseFloat(overall.win_rate) || 0;
      const wins = parseInt(overall.wins) || 0;
      const losses = parseInt(overall.losses) || 0;
      const totalDecided = wins + losses;
      const lossRate = totalDecided > 0 ? (losses / totalDecided) * 100 : 0;
      const expectancy = totalDecided > 0
        ? ((winRate / 100) * avgWin) - ((lossRate / 100) * avgLoss)
        : 0;

      // ============================================================
      // FETCH ALL RETURNS FOR ADVANCED METRICS
      // ============================================================
      const allReturns = await db.execute(sql.raw(`
        SELECT profit_loss_pips, outcome, created_at
        FROM signal_history
        ${completedWhereClause}
        ORDER BY created_at ASC
      `)) as any[];

      const returns = allReturns.map((r: any) => parseFloat(r.profit_loss_pips) || 0);
      const avgReturn = returns.length > 0
        ? returns.reduce((sum, r) => sum + r, 0) / returns.length
        : 0;

      // ============================================================
      // SHARPE RATIO (Risk-Adjusted Return)
      // Formula: AvgReturn / StdDev
      // Good: >0.75, Excellent: >1.5
      // ============================================================
      const variance = returns.length > 0
        ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
        : 0;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

      // ============================================================
      // SORTINO RATIO (Downside Risk-Adjusted Return)
      // Only considers negative volatility - better than Sharpe
      // Good: >1.0, Excellent: >2.0, Outstanding: >3.0
      // ============================================================
      const negativeReturns = returns.filter(r => r < 0);
      const downsideVariance = negativeReturns.length > 0
        ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
        : 0;
      const downsideDeviation = Math.sqrt(downsideVariance);
      const sortinoRatio = downsideDeviation > 0 ? avgReturn / downsideDeviation : 0;

      // ============================================================
      // MAX DRAWDOWN & CALMAR RATIO
      // Calmar = Annual Return / Max Drawdown
      // Good: >1.0, Excellent: >2.0
      // ============================================================
      let peak = 0;
      let maxDrawdown = 0;
      let runningPnL = 0;

      for (const r of returns) {
        runningPnL += r;
        if (runningPnL > peak) {
          peak = runningPnL;
        }
        const drawdown = peak - runningPnL;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      const netPips = parseFloat(overall.net_pips) || 0;
      const calmarRatio = maxDrawdown > 0 ? netPips / maxDrawdown : 0;

      // ============================================================
      // SQN (System Quality Number) - Van Tharp
      // Formula: √N × (Expectancy / StdDev)
      // 2.0-2.5: Average, 2.5-3.0: Good, 3.0-5.0: Excellent, 5.0+: Superb
      // Using 100-trade normalized version
      // ============================================================
      const sqnRaw = stdDev > 0 && returns.length > 0
        ? (Math.sqrt(Math.min(returns.length, 100)) * (avgReturn / stdDev))
        : 0;

      // ============================================================
      // RECOVERY FACTOR
      // Net Profit / Max Drawdown
      // Good: >3.0
      // ============================================================
      const recoveryFactor = maxDrawdown > 0 ? netPips / maxDrawdown : 0;

      // ============================================================
      // CONSECUTIVE WINS/LOSSES ANALYSIS
      // ============================================================
      let maxConsecWins = 0;
      let maxConsecLosses = 0;
      let currentConsecWins = 0;
      let currentConsecLosses = 0;

      for (const trade of allReturns) {
        if (trade.outcome?.includes('TP')) {
          currentConsecWins++;
          currentConsecLosses = 0;
          if (currentConsecWins > maxConsecWins) maxConsecWins = currentConsecWins;
        } else if (trade.outcome === 'STOP_HIT') {
          currentConsecLosses++;
          currentConsecWins = 0;
          if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
        }
      }

      // ============================================================
      // R-MULTIPLE DISTRIBUTION
      // Assuming 1R = average loss (stop loss distance)
      // ============================================================
      const rMultiples = avgLoss > 0
        ? returns.map(r => r / avgLoss)
        : returns;
      const avgRMultiple = rMultiples.length > 0
        ? rMultiples.reduce((sum, r) => sum + r, 0) / rMultiples.length
        : 0;
      const largestWinR = rMultiples.length > 0 ? Math.max(...rMultiples) : 0;
      const largestLossR = rMultiples.length > 0 ? Math.min(...rMultiples) : 0;

      // 2. Per-Symbol Performance with filters
      const symbolWhereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

      const symbolStats = await db.execute(sql.raw(`
        SELECT
          symbol,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          SUM(CASE
            WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN ABS(profit_loss_pips)
            ELSE 0
          END) as win_pips,
          SUM(CASE
            WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips)
            ELSE 0
          END) as loss_pips,
          SUM(profit_loss_pips) as net_pips,
          AVG(CASE WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN profit_loss_pips END) as avg_win,
          AVG(CASE WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips) END) as avg_loss
        FROM signal_history
        ${symbolWhereClause}
        GROUP BY symbol
        ORDER BY completed DESC
      `)) as any[];

      const symbolMetrics = symbolStats.map((s: any) => {
        const symbolPF = parseFloat(s.loss_pips) > 0
          ? parseFloat(s.win_pips) / parseFloat(s.loss_pips)
          : 0;
        const symbolAvgWin = parseFloat(s.avg_win) || 0;
        const symbolAvgLoss = parseFloat(s.avg_loss) || 0;
        const symbolPayoff = symbolAvgLoss > 0 ? symbolAvgWin / symbolAvgLoss : 0;
        const symbolWR = parseFloat(s.win_rate) || 0;
        const symbolLR = 100 - symbolWR;
        const symbolExpectancy = ((symbolWR / 100) * symbolAvgWin) - ((symbolLR / 100) * symbolAvgLoss);

        return {
          symbol: s.symbol,
          totalSignals: parseInt(s.total_signals) || 0,
          completed: parseInt(s.completed) || 0,
          wins: parseInt(s.wins) || 0,
          losses: parseInt(s.losses) || 0,
          winRate: symbolWR,
          netPips: parseFloat(s.net_pips) || 0,
          profitFactor: parseFloat(symbolPF.toFixed(2)),
          payoffRatio: parseFloat(symbolPayoff.toFixed(2)),
          avgWinPips: parseFloat(symbolAvgWin.toFixed(1)),
          avgLossPips: parseFloat(symbolAvgLoss.toFixed(1)),
          expectancy: parseFloat(symbolExpectancy.toFixed(2)),
          hasEnoughData: parseInt(s.completed) >= 30,
        };
      });

      // 3. Live Trading Performance (FXIFY-specific) with filters
      const liveWhereBase = whereConditions.length > 0
        ? `${whereConditions.join(' AND ')} AND`
        : '';

      const liveStats = await db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE ${liveWhereBase} trade_live = true) as live_signals,
          COUNT(*) FILTER (WHERE ${liveWhereBase} trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as live_wins,
          COUNT(*) FILTER (WHERE ${liveWhereBase} trade_live = true AND outcome = 'STOP_HIT') as live_losses,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE ${liveWhereBase} trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE ${liveWhereBase} trade_live = true AND outcome != 'PENDING'), 0),
            2
          ) as live_win_rate,
          SUM(CASE
            WHEN ${liveWhereBase} trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN ABS(profit_loss_pips)
            ELSE 0
          END) as live_win_pips,
          SUM(CASE
            WHEN ${liveWhereBase} trade_live = true AND outcome = 'STOP_HIT' THEN ABS(profit_loss_pips)
            ELSE 0
          END) as live_loss_pips,
          SUM(CASE
            WHEN ${liveWhereBase} trade_live = true THEN profit_loss_pips
            ELSE 0
          END) as live_net_pips,
          AVG(CASE WHEN ${liveWhereBase} trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN profit_loss_pips END) as live_avg_win,
          AVG(CASE WHEN ${liveWhereBase} trade_live = true AND outcome = 'STOP_HIT' THEN ABS(profit_loss_pips) END) as live_avg_loss
        FROM signal_history
      `)) as any[];

      const live = liveStats[0];
      const livePF = parseFloat(live.live_loss_pips) > 0
        ? parseFloat(live.live_win_pips) / parseFloat(live.live_loss_pips)
        : 0;
      const liveAvgWin = parseFloat(live.live_avg_win) || 0;
      const liveAvgLoss = parseFloat(live.live_avg_loss) || 0;
      const liveWR = parseFloat(live.live_win_rate) || 0;
      const liveLR = 100 - liveWR;
      const liveExpectancy = ((liveWR / 100) * liveAvgWin) - ((liveLR / 100) * liveAvgLoss);

      // 4. Recent Recommendations with Metrics
      const recommendations = await db.execute(sql`
        SELECT
          id,
          symbol,
          recommendation_title,
          expected_win_rate_improvement,
          suggested_changes,
          status,
          created_at
        FROM strategy_adaptations
        ORDER BY created_at DESC
        LIMIT 5
      `) as any[];

      const recsWithMetrics = recommendations.map((rec: any) => {
        const changes = rec.suggested_changes || {};
        return {
          id: rec.id,
          symbol: rec.symbol,
          title: rec.recommendation_title,
          improvement: parseFloat(rec.expected_win_rate_improvement) || 0,
          profitFactor: changes.profit_factor || null,
          sharpeRatio: changes.sharpe_ratio || null,
          status: rec.status,
          createdAt: rec.created_at,
        };
      });

      // 5. System Health Indicators
      const hasEnoughData = symbolMetrics.some(s => s.hasEnoughData);
      const pendingRecCount = recommendations.filter(r => r.status === 'pending').length;

      // 6. Risk of Ruin Estimation (simplified)
      // Based on win rate and payoff ratio
      // Professional target: <5%
      const riskOfRuin = winRate > 0 && payoffRatio > 0
        ? Math.pow((1 - ((winRate / 100) - ((1 - winRate / 100) / payoffRatio))) /
                   (1 + ((winRate / 100) - ((1 - winRate / 100) / payoffRatio))), 50) * 100
        : 100;

      res.json({
        // Filter info
        filters: {
          version: version || 'all',
          since: since || 'all-time',
          tier: tier || 'all',
          appliedFilters: whereConditions.length,
        },

        // Core Performance Metrics
        overall: {
          totalSignals: parseInt(overall.total_signals) || 0,
          completedSignals: parseInt(overall.completed_signals) || 0,
          pendingSignals: (parseInt(overall.total_signals) || 0) - (parseInt(overall.completed_signals) || 0),
          wins: parseInt(overall.wins) || 0,
          losses: parseInt(overall.losses) || 0,
          expired: parseInt(overall.expired) || 0,
          winRate: parseFloat(overall.win_rate) || 0,
          lossRate: parseFloat(lossRate.toFixed(2)),
          netPips: parseFloat(netPips.toFixed(1)),
          avgWinPips: parseFloat(avgWin.toFixed(1)),
          avgLossPips: parseFloat(avgLoss.toFixed(1)),
          firstSignalDate: overall.first_signal_date,
          lastSignalDate: overall.last_signal_date,
        },

        // Professional Risk-Adjusted Metrics
        riskAdjusted: {
          profitFactor: parseFloat(profitFactor.toFixed(2)),
          profitFactorGrade: profitFactor >= 2.0 ? 'Excellent' : profitFactor >= 1.5 ? 'Good' : profitFactor >= 1.0 ? 'Break-even' : 'Poor',
          sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
          sharpeGrade: sharpeRatio >= 1.5 ? 'Excellent' : sharpeRatio >= 0.75 ? 'Good' : sharpeRatio >= 0 ? 'Average' : 'Poor',
          sortinoRatio: parseFloat(sortinoRatio.toFixed(2)),
          sortinoGrade: sortinoRatio >= 2.0 ? 'Excellent' : sortinoRatio >= 1.0 ? 'Good' : 'Needs Improvement',
          calmarRatio: parseFloat(calmarRatio.toFixed(2)),
          calmarGrade: calmarRatio >= 2.0 ? 'Excellent' : calmarRatio >= 1.0 ? 'Good' : 'Needs Improvement',
          sqn: parseFloat(sqnRaw.toFixed(2)),
          sqnGrade: sqnRaw >= 5.0 ? 'Superb' : sqnRaw >= 3.0 ? 'Excellent' : sqnRaw >= 2.5 ? 'Good' : sqnRaw >= 2.0 ? 'Average' : 'Below Average',
        },

        // Expectancy & Edge Analysis
        edge: {
          expectancyPerTrade: parseFloat(expectancy.toFixed(2)),
          expectancyGrade: expectancy > 0 ? 'Positive Edge' : 'No Edge',
          payoffRatio: parseFloat(payoffRatio.toFixed(2)),
          payoffGrade: payoffRatio >= 2.0 ? 'Excellent (2:1+)' : payoffRatio >= 1.5 ? 'Good' : 'Needs Improvement',
          recoveryFactor: parseFloat(recoveryFactor.toFixed(2)),
          riskOfRuinPercent: parseFloat(Math.min(riskOfRuin, 100).toFixed(2)),
          riskOfRuinGrade: riskOfRuin < 5 ? 'Safe' : riskOfRuin < 20 ? 'Acceptable' : 'Dangerous',
        },

        // R-Multiple Analysis (Van Tharp)
        rMultiples: {
          avgRMultiple: parseFloat(avgRMultiple.toFixed(2)),
          largestWinR: parseFloat(largestWinR.toFixed(2)),
          largestLossR: parseFloat(largestLossR.toFixed(2)),
          rExpectancy: parseFloat((avgRMultiple).toFixed(3)),
        },

        // Drawdown Analysis
        drawdown: {
          maxDrawdownPips: parseFloat(maxDrawdown.toFixed(1)),
          currentDrawdownPips: parseFloat((peak - runningPnL).toFixed(1)),
          peakPips: parseFloat(peak.toFixed(1)),
          maxConsecutiveWins: maxConsecWins,
          maxConsecutiveLosses: maxConsecLosses,
        },

        // Live Trading Performance (FXIFY HIGH tier only)
        liveTrading: {
          signals: parseInt(live.live_signals) || 0,
          wins: parseInt(live.live_wins) || 0,
          losses: parseInt(live.live_losses) || 0,
          winRate: parseFloat(live.live_win_rate) || 0,
          profitFactor: parseFloat(livePF.toFixed(2)),
          netPips: parseFloat(live.live_net_pips) || 0,
          avgWinPips: parseFloat(liveAvgWin.toFixed(1)),
          avgLossPips: parseFloat(liveAvgLoss.toFixed(1)),
          expectancy: parseFloat(liveExpectancy.toFixed(2)),
        },

        // Per-Symbol Breakdown
        symbolMetrics,

        // Recent AI Recommendations
        recentRecommendations: recsWithMetrics,

        // System Health
        systemHealth: {
          hasEnoughData,
          minSignalsForReliability: 30,
          currentSignalCount: returns.length,
          pendingRecommendations: pendingRecCount,
          backtesterLastRun: backtester.getLastRunTime(),
          aiAnalyzerLastRun: aiAnalyzer.getLastRunTime(),
          dataQuality: returns.length >= 30 ? 'Reliable' : returns.length >= 10 ? 'Limited' : 'Insufficient',
        },

        // Metadata
        timestamp: new Date().toISOString(),
        calculatedMetrics: [
          'Win Rate', 'Profit Factor', 'Sharpe Ratio', 'Sortino Ratio',
          'Calmar Ratio', 'SQN', 'Expectancy', 'Payoff Ratio', 'R-Multiples',
          'Max Drawdown', 'Recovery Factor', 'Risk of Ruin'
        ],
      });
    } catch (error: any) {
      console.error('❌ Error fetching metrics dashboard:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/recommendations/:id/rollback
   * Rollback an approved recommendation to previous parameters
   * Milestone 3C: Recommendation Approval System
   */
  app.post("/api/ai/recommendations/:id/rollback", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // Get recommendation details for logging
      const recResult = await db.execute(sql`
        SELECT symbol, recommendation_title, new_strategy_version, old_strategy_version
        FROM strategy_adaptations
        WHERE id = ${id} AND status = 'approved'
      `);

      if (!recResult || (recResult as any[]).length === 0) {
        return res.status(404).json({ error: 'Approved recommendation not found' });
      }

      const recommendation = (recResult as any[])[0];

      // Mark as rolled back
      await db.execute(sql`
        UPDATE strategy_adaptations
        SET
          status = 'rolled_back',
          applied_at = NULL
        WHERE id = ${id}
      `);

      // Clear parameter cache for this symbol
      parameterService.clearCache(recommendation.symbol);

      console.log(`🔄 [Milestone 3C] Recommendation ${id} rolled back`);
      console.log(`   Symbol: ${recommendation.symbol}`);
      console.log(`   Title: ${recommendation.recommendation_title}`);
      console.log(`   Reverted: ${recommendation.new_strategy_version} → ${recommendation.old_strategy_version}`);

      res.json({
        success: true,
        message: `Parameters rolled back to defaults for ${recommendation.symbol}`,
        symbol: recommendation.symbol,
        revertedVersion: recommendation.old_strategy_version,
      });
    } catch (error: any) {
      console.error('❌ Error rolling back recommendation:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

/**
 * Helper function: Increment strategy version
 * 1.0.0 → 1.1.0
 * 1.5.0 → 1.6.0
 */
function incrementVersion(version: string): string {
  const parts = version.split('.');
  const major = parseInt(parts[0]) || 1;
  const minor = parseInt(parts[1]) || 0;
  const patch = parseInt(parts[2]) || 0;

  return `${major}.${minor + 1}.${patch}`;
}

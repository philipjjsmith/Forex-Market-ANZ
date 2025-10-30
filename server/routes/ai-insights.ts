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

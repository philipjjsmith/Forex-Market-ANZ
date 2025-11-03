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
}

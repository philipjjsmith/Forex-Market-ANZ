import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { exchangeRateAPI } from "./services/exchangerate-api";
import { insertUserSchema } from "@shared/schema";
import { generateToken } from "./jwt";
import { requireAuth } from "./auth-middleware";
import bcrypt from "bcrypt";
import { registerSignalRoutes } from "./routes/signals";
import { registerAdminRoutes } from "./routes/admin";
import { registerAIRoutes } from "./routes/ai-insights";
import { signalGenerator } from "./services/signal-generator";
import { outcomeValidator } from "./services/outcome-validator";
import { aiAnalyzer } from "./services/ai-analyzer";
import { backtester } from "./services/backtester";
import { propFirmService, FXIFY_TWO_PHASE_STANDARD, FXIFY_TWO_PHASE_STANDARD_PHASE2, FXIFY_FUNDED_ACCOUNT } from "./services/prop-firm-config";
import { db } from "./db";
import { sql } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {
  // ========== CRON/SCHEDULED JOB ENDPOINTS ==========
  // These endpoints are pinged by UptimeRobot or cron services to trigger automated tasks
  // This architecture works on Render free tier (which sleeps after 15min of inactivity)

  /**
   * Signal Generation Cron (every 15 minutes)
   * Triggered by: UptimeRobot every 5 minutes (rate-limited to 15min)
   */
  app.get("/api/cron/generate-signals", async (req, res) => {
    try {
      const lastRun = signalGenerator.getLastRunTime();
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;

      // Only run if 15+ minutes since last run
      if (lastRun > 0 && now - lastRun < fifteenMinutes) {
        const minutesAgo = Math.round((now - lastRun) / 60000);
        const nextRunIn = Math.round((fifteenMinutes - (now - lastRun)) / 60000);

        return res.json({
          skipped: true,
          message: `Last run was ${minutesAgo} minute(s) ago`,
          nextRunIn: `${nextRunIn} minute(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger generation (non-blocking)
      signalGenerator.generateSignals().catch(error => {
        console.error('Error in signal generation:', error);
      });

      res.json({
        success: true,
        message: 'Signal generation triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (generate-signals):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Outcome Validation Cron (every 5 minutes)
   * Triggered by: UptimeRobot every 5 minutes
   */
  app.get("/api/cron/validate-outcomes", async (req, res) => {
    try {
      const lastRun = outcomeValidator.getLastRunTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      // Only run if 5+ minutes since last run
      if (lastRun > 0 && now - lastRun < fiveMinutes) {
        const minutesAgo = Math.round((now - lastRun) / 60000);
        const nextRunIn = Math.round((fiveMinutes - (now - lastRun)) / 60000);

        return res.json({
          skipped: true,
          message: `Last run was ${minutesAgo} minute(s) ago`,
          nextRunIn: `${nextRunIn} minute(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger validation (non-blocking)
      outcomeValidator.validatePendingSignals().catch(error => {
        console.error('Error in outcome validation:', error);
      });

      res.json({
        success: true,
        message: 'Outcome validation triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (validate-outcomes):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * AI Analysis Cron (every 6 hours)
   * Triggered by: External cron service (cron-job.org) every 6 hours
   */
  app.get("/api/cron/analyze-ai", async (req, res) => {
    try {
      const lastRun = aiAnalyzer.getLastRunTime();
      const now = Date.now();
      const sixHours = 6 * 60 * 60 * 1000;

      // Only run if 6+ hours since last run
      if (lastRun > 0 && now - lastRun < sixHours) {
        const hoursAgo = ((now - lastRun) / (60 * 60 * 1000)).toFixed(1);
        const nextRunIn = ((sixHours - (now - lastRun)) / (60 * 60 * 1000)).toFixed(1);

        return res.json({
          skipped: true,
          message: `Last run was ${hoursAgo} hour(s) ago`,
          nextRunIn: `${nextRunIn} hour(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger analysis (non-blocking)
      aiAnalyzer.analyzeAllSymbols().catch(error => {
        console.error('Error in AI analysis:', error);
      });

      res.json({
        success: true,
        message: 'AI analysis triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (analyze-ai):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 🚀 AUTOMATED BACKTESTING CRON (Weekly - Every Sunday)
   * Triggered by: UptimeRobot every Sunday at 00:00 UTC
   * Purpose: Continuously optimize parameters based on latest data
   * Industry Standard: Walk-forward optimization every 6 months (we do weekly for faster adaptation)
   */
  app.get("/api/cron/backtest", async (req, res) => {
    try {
      const lastRun = backtester.getLastRunTime();
      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;

      // Only run if 7+ days since last run (weekly schedule)
      if (lastRun > 0 && now - lastRun < oneWeek) {
        const daysAgo = ((now - lastRun) / (24 * 60 * 60 * 1000)).toFixed(1);
        const nextRunIn = ((oneWeek - (now - lastRun)) / (24 * 60 * 60 * 1000)).toFixed(1);

        return res.json({
          skipped: true,
          message: `Last run was ${daysAgo} day(s) ago`,
          nextRunIn: `${nextRunIn} day(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      console.log('🔬 [CRON] Automated backtesting triggered');
      console.log(`   Last run: ${lastRun > 0 ? new Date(lastRun).toISOString() : 'Never'}`);
      console.log(`   This will test 9 parameter combinations per symbol (EMA: 15/45, 20/50, 25/55 × ATR: 1.5x, 2.0x, 2.5x)`);
      console.log(`   Creating recommendations for improvements > 5%`);

      // Trigger backtesting (non-blocking)
      backtester.backtestAllSymbols().catch(error => {
        console.error('Error in automated backtesting:', error);
      });

      res.json({
        success: true,
        message: 'Automated backtesting triggered - AI will optimize parameters based on latest data',
        timestamp: new Date().toISOString(),
        nextScheduledRun: new Date(now + oneWeek).toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (backtest):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Backtesting Cron (every 24 hours)
   * Triggered by: UptimeRobot every 24 hours
   * Analyzes historical signals and generates optimization recommendations
   */
  app.get("/api/cron/run-backtesting", async (req, res) => {
    try {
      const lastRun = backtester.getLastRunTime();
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      // Only run if 24+ hours since last run
      if (lastRun > 0 && now - lastRun < twentyFourHours) {
        const hoursAgo = ((now - lastRun) / (60 * 60 * 1000)).toFixed(1);
        const nextRunIn = ((twentyFourHours - (now - lastRun)) / (60 * 60 * 1000)).toFixed(1);

        return res.json({
          skipped: true,
          message: `Last run was ${hoursAgo} hour(s) ago`,
          nextRunIn: `${nextRunIn} hour(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger backtesting (non-blocking)
      backtester.backtestAllSymbols().catch(error => {
        console.error('Error in backtesting:', error);
      });

      res.json({
        success: true,
        message: 'Backtesting triggered - analyzing historical signals for optimization opportunities',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (run-backtesting):', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== PROP FIRM CONFIGURATION ENDPOINTS ==========
  // FXIFY Two-Phase Standard Challenge Configuration

  /**
   * Get current prop firm configuration
   */
  app.get("/api/prop-firm/config", requireAuth, async (req, res) => {
    try {
      const config = propFirmService.getConfig();
      const summary = propFirmService.getRiskSummary();
      const dailyStatus = propFirmService.getDailyStatus();

      res.json({
        success: true,
        config: summary,
        dailyStatus,
        message: `Active: ${config.name} - ${config.challengeType}`
      });
    } catch (error: any) {
      console.error('❌ Error getting prop firm config:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Set prop firm configuration (Phase 1, Phase 2, or Funded)
   */
  app.post("/api/prop-firm/config", requireAuth, async (req, res) => {
    try {
      const { phase } = req.body;

      let config;
      switch (phase) {
        case 'phase1':
          config = FXIFY_TWO_PHASE_STANDARD;
          break;
        case 'phase2':
          config = FXIFY_TWO_PHASE_STANDARD_PHASE2;
          break;
        case 'funded':
          config = FXIFY_FUNDED_ACCOUNT;
          break;
        default:
          return res.status(400).json({
            error: 'Invalid phase. Use: phase1, phase2, or funded'
          });
      }

      propFirmService.setConfig(config);

      res.json({
        success: true,
        message: `Configuration set to: ${config.name} - ${config.challengeType}`,
        config: propFirmService.getRiskSummary()
      });
    } catch (error: any) {
      console.error('❌ Error setting prop firm config:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Initialize daily tracker with starting balance
   */
  app.post("/api/prop-firm/init-daily", requireAuth, async (req, res) => {
    try {
      const { startingBalance } = req.body;

      if (!startingBalance || typeof startingBalance !== 'number') {
        return res.status(400).json({
          error: 'startingBalance is required (number)'
        });
      }

      propFirmService.initDailyTracker(startingBalance);

      res.json({
        success: true,
        message: `Daily tracker initialized with $${startingBalance}`,
        dailyStatus: propFirmService.getDailyStatus()
      });
    } catch (error: any) {
      console.error('❌ Error initializing daily tracker:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Update daily tracker with trade result
   */
  app.post("/api/prop-firm/update-trade", requireAuth, async (req, res) => {
    try {
      const { pnl, currentBalance } = req.body;

      if (typeof pnl !== 'number' || typeof currentBalance !== 'number') {
        return res.status(400).json({
          error: 'pnl and currentBalance are required (numbers)'
        });
      }

      propFirmService.updateDailyTracker(pnl, currentBalance);

      const dailyStatus = propFirmService.getDailyStatus();
      const canTrade = propFirmService.canTrade(Math.abs(dailyStatus?.dailyPnLPercent || 0));

      res.json({
        success: true,
        dailyStatus,
        canTrade,
        message: canTrade.allowed ? 'Trading allowed' : canTrade.reason
      });
    } catch (error: any) {
      console.error('❌ Error updating trade:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Check if trading is allowed
   */
  app.get("/api/prop-firm/can-trade", requireAuth, async (req, res) => {
    try {
      const dailyStatus = propFirmService.getDailyStatus();
      const dailyLossPercent = Math.abs(dailyStatus?.dailyPnLPercent || 0);
      const canTrade = propFirmService.canTrade(dailyLossPercent);
      const maxTradesReached = propFirmService.maxTradesReached();

      res.json({
        success: true,
        canTrade: canTrade.allowed && !maxTradesReached,
        reason: !canTrade.allowed ? canTrade.reason :
                maxTradesReached ? 'Max trades per day reached' : 'Trading allowed',
        dailyStatus,
        config: propFirmService.getRiskSummary()
      });
    } catch (error: any) {
      console.error('❌ Error checking trading status:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Reset daily tracker (for new trading day or fresh start)
   */
  app.post("/api/prop-firm/reset-daily", requireAuth, async (req, res) => {
    try {
      const { startingBalance } = req.body;

      if (!startingBalance || typeof startingBalance !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'startingBalance is required and must be a number'
        });
      }

      // Force reset by clearing current tracker and reinitializing
      propFirmService.resetDailyTracker(startingBalance);

      res.json({
        success: true,
        message: 'Daily tracker reset successfully',
        newStatus: propFirmService.getDailyStatus(),
        config: propFirmService.getRiskSummary()
      });
    } catch (error: any) {
      console.error('❌ Error resetting daily tracker:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * 📊 COMPREHENSIVE PROP FIRM DASHBOARD
   * Industry-grade trading performance tracking for FXIFY challenge
   *
   * Features:
   * - Phase progress tracking (current vs 5% target)
   * - Daily loss monitoring with visual indicators
   * - Strategy v3.1.0 performance (filtered from historical data)
   * - All professional metrics (Sharpe, Sortino, Calmar, SQN, etc.)
   * - FXIFY-specific compliance monitoring
   */
  app.get("/api/prop-firm/dashboard", requireAuth, async (req, res) => {
    try {
      const config = propFirmService.getConfig();
      const dailyStatus = propFirmService.getDailyStatus();
      const dailyLossPercent = Math.abs(dailyStatus?.dailyPnLPercent || 0);
      const canTrade = propFirmService.canTrade(dailyLossPercent);
      const maxTradesReached = propFirmService.maxTradesReached();

      // Data filter: 'production' (fresh start, DEFAULT), 'legacy' (old data), 'all' (everything)
      const dataFilter = (req.query.data as string) || 'production';

      // Build date filter based on data quality
      // FRESH START: January 19, 2026 00:00:00 UTC - Clean slate for new strategy tracking
      // All signals before this date are considered "legacy" (historical learning data)
      const STRATEGY_PIVOT_DATE = '2026-01-19 00:00:00 UTC';

      let dateFilterSQL = sql``;
      if (dataFilter === 'production') {
        // Show only signals from Nov 4+ (new ICT 3-TF strategy)
        dateFilterSQL = sql`AND created_at >= ${STRATEGY_PIVOT_DATE}`;
      } else if (dataFilter === 'legacy') {
        // Show only pre-Nov 4 signals (old strategy)
        dateFilterSQL = sql`AND created_at < ${STRATEGY_PIVOT_DATE}`;
      }
      // else: 'all' - no date filter, show everything

      // Get strategy v3.1.0 performance from signal_history
      const strategyPerformance = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome != 'PENDING') as completed_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          SUM(CASE WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN ABS(profit_loss_pips) ELSE 0 END) as total_win_pips,
          SUM(CASE WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips) ELSE 0 END) as total_loss_pips,
          SUM(profit_loss_pips) as net_pips,
          AVG(CASE WHEN outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT') THEN profit_loss_pips END) as avg_win,
          AVG(CASE WHEN outcome = 'STOP_HIT' THEN ABS(profit_loss_pips) END) as avg_loss,
          COUNT(DISTINCT DATE(created_at)) as trading_days,
          MIN(created_at) as first_signal_date,
          MAX(created_at) as last_signal_date
        FROM signal_history
        WHERE strategy_version >= '3.1.0'
          AND trade_live = true
          ${dateFilterSQL}
      `) as any[];

      const perf = strategyPerformance[0] || {};

      // Calculate derived metrics
      const totalWinPips = parseFloat(perf.total_win_pips) || 0;
      const totalLossPips = parseFloat(perf.total_loss_pips) || 0;
      const netPips = parseFloat(perf.net_pips) || 0;
      const avgWin = parseFloat(perf.avg_win) || 0;
      const avgLoss = parseFloat(perf.avg_loss) || 0;
      const winRate = parseFloat(perf.win_rate) || 0;
      const profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;
      const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
      const expectancy = ((winRate / 100) * avgWin) - (((100 - winRate) / 100) * avgLoss);

      // Phase progress calculation
      // Assuming $100,000 account, 1 pip ≈ $10 for standard lot
      // Phase 1 target: 5% = $5,000 = 500 pips net
      const assumedAccountSize = 100000;
      const pipValue = 10; // Standard lot
      const profitInDollars = netPips * pipValue;
      const profitPercent = (profitInDollars / assumedAccountSize) * 100;
      const phaseTarget = config.phase1Target;
      const phaseProgress = Math.min((profitPercent / phaseTarget) * 100, 100);

      // Daily loss status
      const dailyLossLimit = config.maxDailyLoss;
      const dailyLossBuffer = config.dailyLossBuffer;
      const dailyLossStatus = dailyLossPercent >= dailyLossBuffer ? 'DANGER' :
                              dailyLossPercent >= dailyLossBuffer * 0.5 ? 'WARNING' : 'SAFE';

      // Drawdown tracking
      const drawdownPercent = Math.abs(Math.min(profitPercent, 0));
      const maxDrawdownLimit = config.maxDrawdown;
      const drawdownStatus = drawdownPercent >= maxDrawdownLimit * 0.8 ? 'DANGER' :
                             drawdownPercent >= maxDrawdownLimit * 0.5 ? 'WARNING' : 'SAFE';

      // Trading days progress
      const tradingDays = parseInt(perf.trading_days) || 0;
      const minTradingDays = config.minTradingDays;
      const tradingDaysProgress = Math.min((tradingDays / minTradingDays) * 100, 100);

      res.json({
        // Header Info
        propFirm: config.name,
        challengeType: config.challengeType,
        strategyVersion: '3.1.0',
        timestamp: new Date().toISOString(),

        // Data Filter Info (for transparency)
        dataFilter: {
          current: dataFilter,
          options: ['production', 'legacy', 'all'],
          description: dataFilter === 'production'
            ? 'Fresh start: Jan 19, 2026+ signals only (clean slate)'
            : dataFilter === 'legacy'
            ? 'Historical data: pre-Jan 19, 2026 (learning archive)'
            : 'All signals combined (historical + new)',
          dateRange: {
            from: perf.first_signal_date || null,
            to: perf.last_signal_date || null
          }
        },

        // Phase Progress
        phaseProgress: {
          currentProfitPercent: parseFloat(profitPercent.toFixed(2)),
          targetPercent: phaseTarget,
          progressPercent: parseFloat(phaseProgress.toFixed(1)),
          pipsToTarget: parseFloat(((phaseTarget - profitPercent) / 100 * assumedAccountSize / pipValue).toFixed(0)),
          estimatedTradesRemaining: expectancy > 0 ? Math.ceil(((phaseTarget - profitPercent) / 100 * assumedAccountSize / pipValue) / expectancy) : 'N/A',
          status: profitPercent >= phaseTarget ? 'PASSED' : phaseProgress >= 80 ? 'CLOSE' : 'IN_PROGRESS'
        },

        // Daily Loss Protection
        dailyLoss: {
          currentLossPercent: parseFloat(dailyLossPercent.toFixed(2)),
          bufferPercent: dailyLossBuffer,
          limitPercent: dailyLossLimit,
          remainingBufferPercent: parseFloat((dailyLossBuffer - dailyLossPercent).toFixed(2)),
          status: dailyLossStatus,
          isLocked: dailyStatus?.isLocked || false,
          tradesToday: dailyStatus?.tradesCount || 0,
          maxTradesPerDay: config.maxTradesPerDay,
          tradesRemaining: config.maxTradesPerDay - (dailyStatus?.tradesCount || 0)
        },

        // Drawdown Monitoring
        drawdown: {
          currentDrawdownPercent: parseFloat(drawdownPercent.toFixed(2)),
          maxAllowedPercent: maxDrawdownLimit,
          remainingPercent: parseFloat((maxDrawdownLimit - drawdownPercent).toFixed(2)),
          type: config.drawdownType,
          status: drawdownStatus
        },

        // Trading Days
        tradingDays: {
          completed: tradingDays,
          required: minTradingDays,
          progressPercent: parseFloat(tradingDaysProgress.toFixed(0)),
          remaining: Math.max(0, minTradingDays - tradingDays),
          status: tradingDays >= minTradingDays ? 'MET' : 'IN_PROGRESS'
        },

        // Strategy Performance (v3.1.0 only)
        performance: {
          totalSignals: parseInt(perf.total_signals) || 0,
          completedSignals: parseInt(perf.completed_signals) || 0,
          wins: parseInt(perf.wins) || 0,
          losses: parseInt(perf.losses) || 0,
          winRate: winRate,
          winRateGrade: winRate >= 60 ? 'Excellent' : winRate >= 55 ? 'Good' : winRate >= 50 ? 'Average' : 'Below Target',
          netPips: parseFloat(netPips.toFixed(1)),
          avgWinPips: parseFloat(avgWin.toFixed(1)),
          avgLossPips: parseFloat(avgLoss.toFixed(1)),
          profitFactor: parseFloat(profitFactor.toFixed(2)),
          profitFactorGrade: profitFactor >= 2.0 ? 'Excellent' : profitFactor >= 1.5 ? 'Good' : profitFactor >= 1.0 ? 'Break-even' : 'Poor',
          payoffRatio: parseFloat(payoffRatio.toFixed(2)),
          expectancyPerTrade: parseFloat(expectancy.toFixed(2)),
          expectancyGrade: expectancy > 0 ? 'Positive Edge' : 'No Edge'
        },

        // Trading Status
        tradingStatus: {
          canTrade: canTrade.allowed && !maxTradesReached,
          reason: !canTrade.allowed ? canTrade.reason :
                  maxTradesReached ? 'Max trades per day reached' : 'Trading allowed',
          riskPerTrade: `${config.riskPerTrade}%`,
          positionSizeHigh: `${config.highTierRisk}%`,
          positionSizeMedium: `${config.mediumTierRisk}%`
        },

        // Compliance Checklist
        compliance: {
          dailyLossCompliant: dailyLossPercent < dailyLossLimit,
          maxDrawdownCompliant: drawdownPercent < maxDrawdownLimit,
          tradingDaysMet: tradingDays >= minTradingDays,
          profitTargetMet: profitPercent >= phaseTarget,
          overallStatus: (dailyLossPercent < dailyLossLimit && drawdownPercent < maxDrawdownLimit)
            ? (profitPercent >= phaseTarget && tradingDays >= minTradingDays ? 'PASSED' : 'COMPLIANT')
            : 'BREACH_RISK'
        },

        // Quick Stats for Dashboard Cards
        quickStats: [
          { label: 'Phase Progress', value: `${phaseProgress.toFixed(0)}%`, status: phaseProgress >= 100 ? 'success' : 'info' },
          { label: 'Win Rate', value: `${winRate.toFixed(0)}%`, status: winRate >= 55 ? 'success' : 'warning' },
          { label: 'Net Pips', value: `${netPips >= 0 ? '+' : ''}${netPips.toFixed(0)}`, status: netPips >= 0 ? 'success' : 'danger' },
          { label: 'Daily Loss', value: `${dailyLossPercent.toFixed(1)}%`, status: dailyLossStatus.toLowerCase() },
          { label: 'Trades Today', value: `${dailyStatus?.tradesCount || 0}/${config.maxTradesPerDay}`, status: 'info' },
          { label: 'Trading Days', value: `${tradingDays}/${minTradingDays}`, status: tradingDays >= minTradingDays ? 'success' : 'info' }
        ]
      });
    } catch (error: any) {
      console.error('❌ Error fetching prop firm dashboard:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Register signal tracking routes
  registerSignalRoutes(app);

  // Register admin routes
  registerAdminRoutes(app);

  // Register AI insights routes
  registerAIRoutes(app);

  // ========== AUTHENTICATION ROUTES ==========

  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validation = insertUserSchema.safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors[0].message,
        });
      }

      const { username, email, password } = validation.data;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered',
        });
      }

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken',
        });
      }

      // Create user (password will be hashed in storage)
      const user = await storage.createUser({ username, email, password });

      // Generate JWT token
      const token = generateToken(user);

      console.log('✅ Registration successful:', email);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('❌ Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed',
      });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required',
        });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);

      if (!user) {
        console.log('❌ Login failed: User not found for email:', email);
        return res.status(401).json({
          success: false,
          error: 'Incorrect email or password',
        });
      }

      // Check if user signed up with Google (no password)
      if (!user.password) {
        console.log('❌ Login failed: User has no password (Google account)');
        return res.status(401).json({
          success: false,
          error: 'Please sign in with Google',
        });
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        console.log('❌ Login failed: Password mismatch');
        return res.status(401).json({
          success: false,
          error: 'Incorrect email or password',
        });
      }

      // Generate JWT token
      const token = generateToken(user);

      console.log('✅ Login successful for:', email);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('❌ Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed',
      });
    }
  });

  // Logout (JWT is stateless - just client-side token removal)
  app.post("/api/auth/logout", (req, res) => {
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });

  // Get current user (requires JWT authentication)
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      // requireAuth middleware already validated token and attached user info
      const user = await storage.getUser(req.userId!);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error('❌ /api/auth/me error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user',
      });
    }
  });

  // Forgot password - simplified version without email
  app.post("/api/auth/forgot-password", async (req, res) => {
    res.json({
      success: true,
      message: 'Password reset functionality coming soon',
    });
  });

  // ========== FOREX API ROUTES ==========

  // Forex API routes
  app.get("/api/forex/quotes", async (req, res) => {
    try {
      console.log('📊 Fetching forex quotes...');
      const quotes = await exchangeRateAPI.fetchAllQuotes();

      res.json({
        success: true,
        data: quotes,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error in /api/forex/quotes:', error);

      // Fallback to mock data if API fails (for development/testing)
      console.log('⚠️  Using mock forex data as fallback');
      const mockQuotes = [
        {
          symbol: 'EUR/USD',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          exchangeRate: 1.0850,
          bidPrice: 1.0849,
          askPrice: 1.0851,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'GBP/USD',
          fromCurrency: 'GBP',
          toCurrency: 'USD',
          exchangeRate: 1.2650,
          bidPrice: 1.2649,
          askPrice: 1.2651,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'USD/JPY',
          fromCurrency: 'USD',
          toCurrency: 'JPY',
          exchangeRate: 149.50,
          bidPrice: 149.49,
          askPrice: 149.51,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'AUD/USD',
          fromCurrency: 'AUD',
          toCurrency: 'USD',
          exchangeRate: 0.6520,
          bidPrice: 0.6519,
          askPrice: 0.6521,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'USD/CHF',
          fromCurrency: 'USD',
          toCurrency: 'CHF',
          exchangeRate: 0.8750,
          bidPrice: 0.8749,
          askPrice: 0.8751,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
      ];

      res.json({
        success: true,
        data: mockQuotes,
        timestamp: new Date().toISOString(),
        mock: true,
      });
    }
  });

  // Cache stats endpoint (for debugging)
  app.get("/api/forex/cache-stats", (req, res) => {
    const stats = exchangeRateAPI.getCacheStats();
    res.json({
      success: true,
      data: stats,
    });
  });

  // Historical data endpoint for learning simulator
  app.get("/api/forex/historical/:pair", async (req, res) => {
    try {
      const { pair } = req.params;

      // Parse pair like "EUR-USD" into "EUR/USD" format for Twelve Data
      const currencies = pair.split('-');
      if (currencies.length !== 2) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pair format. Use format: EUR-USD',
        });
      }

      const symbol = `${currencies[0]}/${currencies[1]}`; // e.g., "EUR/USD"

      // Use Twelve Data for historical data (800 calls/day free tier)
      const apiKey = process.env.TWELVE_DATA_KEY || 'demo';
      const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=100&apikey=${apiKey}`;

      console.log(`📈 Fetching historical data for ${symbol}...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Twelve Data API error: ${response.status}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.status === 'error') {
        return res.status(400).json({
          success: false,
          error: data.message || 'Error fetching historical data',
        });
      }

      if (!data.values || !Array.isArray(data.values)) {
        throw new Error('Invalid response from Twelve Data');
      }

      // Convert to our candle format (Twelve Data returns newest first, so reverse it)
      const candles = data.values.map((item: any) => ({
        date: item.datetime,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
      })).reverse(); // Oldest first

      res.json({
        success: true,
        data: {
          pair: symbol,
          candles,
          count: candles.length,
        },
      });

    } catch (error: any) {
      console.error('❌ Error fetching historical data:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch historical data',
      });
    }
  });

  /**
   * On-Demand Signal Analysis (v3.1.0)
   * Allows manual signal generation for specific symbol
   * Uses ICT 3-Timeframe methodology with real Twelve Data candles
   */
  app.post("/api/signals/analyze", async (req, res) => {
    try {
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: 'Symbol is required'
        });
      }

      // Validate symbol
      const validSymbols = ['EUR/USD', 'USD/CHF']; // Optimized pairs: EUR/USD (60% WR) + USD/CHF (25% WR)
      if (!validSymbols.includes(symbol)) {
        return res.status(400).json({
          success: false,
          error: `Invalid symbol. Must be one of: ${validSymbols.join(', ')}`
        });
      }

      // Generate signal using v3.1.0 ICT methodology
      const result = await signalGenerator.generateSignalForSymbol(symbol);

      res.json({
        success: true,
        signal: result?.signal || null,
        candles: result?.candles || [],
        message: result?.signal
          ? `Generated ${result.signal.tier} tier signal with ${result.signal.confidence}% confidence`
          : 'No signal generated (market conditions not aligned)'
      });

    } catch (error: any) {
      console.error('❌ Error in on-demand analysis:', error);

      // Check if it's a rate limit error
      const isRateLimit = error.message?.includes('rate limit');
      const statusCode = isRateLimit ? 429 : 500;

      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to analyze market',
        isRateLimit: isRateLimit
      });
    }
  });

  /**
   * ADX Sensitivity Test (Admin/Debug endpoint)
   * Tests multiple ADX thresholds to validate system robustness
   * Used for parameter sensitivity analysis (industry best practice)
   */
  app.post("/api/admin/test-adx-sensitivity", async (req, res) => {
    try {
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: 'Symbol is required'
        });
      }

      const validSymbols = ['EUR/USD', 'USD/CHF']; // Optimized pairs: EUR/USD (60% WR) + USD/CHF (25% WR)
      if (!validSymbols.includes(symbol)) {
        return res.status(400).json({
          success: false,
          error: `Invalid symbol. Must be one of: ${validSymbols.join(', ')}`
        });
      }

      console.log(`\n🧪 ADX SENSITIVITY TEST for ${symbol}`);
      console.log(`${'='.repeat(60)}\n`);

      // Test multiple ADX thresholds: [20, 22, 25, 27, 30]
      const thresholds = [20, 22, 25, 27, 30];
      const results = [];

      for (const threshold of thresholds) {
        console.log(`\n🔬 Testing ADX Threshold: ${threshold}`);
        console.log(`${'-'.repeat(60)}`);

        const result = await signalGenerator.testAdxThreshold(symbol, threshold);
        results.push(result);
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ ADX Sensitivity Test Complete\n`);

      res.json({
        success: true,
        symbol,
        results,
        recommendation: analyzeResults(results)
      });

    } catch (error: any) {
      console.error('❌ Error in ADX sensitivity test:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to run sensitivity test'
      });
    }
  });

  // Helper function to analyze test results
  function analyzeResults(results: any[]) {
    const signalCounts = results.map(r => ({
      threshold: r.threshold,
      signalGenerated: r.signal !== null,
      confidence: r.signal?.confidence || 0
    }));

    const lowestWithSignal = signalCounts.find(r => r.signalGenerated);
    const highestQuality = signalCounts.reduce((max, r) =>
      r.confidence > max.confidence ? r : max,
      { threshold: 0, confidence: 0 }
    );

    return {
      summary: `Tested ${results.length} ADX thresholds`,
      lowestThresholdWithSignal: lowestWithSignal?.threshold || 'None',
      highestQualityThreshold: highestQuality.threshold || 'None',
      highestConfidence: highestQuality.confidence,
      recommendation: lowestWithSignal
        ? `System can generate signals. ADX ${lowestWithSignal.threshold} allows signals, but ADX 25 (industry standard) is recommended for profitability.`
        : 'No signals at any threshold - market conditions genuinely poor (W+D+4H not aligned)'
    };
  }

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}

/**
 * Prop Firm Configuration Service
 * Configures trading parameters for specific prop firm challenges
 *
 * ACTIVE: The5ers Bootcamp Configuration
 * - Phase 1: 10% profit target, balance-based drawdown (5% max from initial)
 * - Phase 2: 10% profit target (The5ers scales, same rules apply)
 * - Balance-based static drawdown: floor fixed from initial balance
 * - EAs allowed on MatchTrader (US traders)
 * - No minimum trading days, no time limit
 * - Bi-weekly payouts, $150 minimum
 *
 * PREVIOUS: FXIFY — eliminated. US traders restricted to DXtrade (no EA support)
 * due to MetaQuotes banning MT4/MT5 for US traders at FXIFY.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

export interface PropFirmConfig {
  name: string;
  challengeType: string;

  // Risk Management
  riskPerTrade: number;           // % of account per trade
  maxDailyLoss: number;           // % daily loss limit
  dailyLossBuffer: number;        // Stop trading at this % (leaves buffer)
  maxDrawdown: number;            // % max drawdown
  drawdownType: 'static' | 'trailing';

  // Profit Targets
  phase1Target: number;           // % profit target Phase 1
  phase2Target: number;           // % profit target Phase 2

  // Trading Rules
  minTradingDays: number;
  maxTradesPerDay: number;        // Limit trades to protect daily loss
  allowedStrategies: string[];
  prohibitedStrategies: string[];

  // Position Sizing by Tier
  highTierRisk: number;           // % for HIGH confidence signals
  mediumTierRisk: number;         // % for MEDIUM confidence signals

  // Safety Features
  enableDailyLossProtection: boolean;
  enableDrawdownProtection: boolean;
  autoStopOnDailyLimit: boolean;
}

// The5ers Bootcamp Configuration (Phase 1)
// $22 entry — US traders, MatchTrader, EA allowed
export const THE5ERS_BOOTCAMP: PropFirmConfig = {
  name: 'The5ers',
  challengeType: 'Bootcamp Phase 1',

  // Risk Management - Conservative for Phase 1
  riskPerTrade: 1.0,              // 1% risk per trade (conservative)
  maxDailyLoss: 5.0,              // 5% max drawdown from initial (balance-based static)
  dailyLossBuffer: 4.0,           // Stop trading at 4% (leaves 1% buffer)
  maxDrawdown: 5.0,               // 5% max total drawdown (balance-based floor)
  drawdownType: 'static',         // Balance-based static: floor fixed from initial balance

  // Profit Targets
  phase1Target: 10.0,             // 10% profit target Phase 1 (The5ers Bootcamp)
  phase2Target: 10.0,             // 10% profit target Phase 2

  // Trading Rules
  minTradingDays: 0,              // No minimum trading days
  maxTradesPerDay: 3,             // Max 3 signals per day (conservative, protects drawdown)
  allowedStrategies: [
    'ICT 3-Timeframe Strategy',
    'FVG Entry Strategy',
    'Swing Trading',
    'Day Trading',
  ],
  prohibitedStrategies: [
    'High-Frequency Trading (HFT)',
    'Tick Scalping',
    'Latency Arbitrage',
    'Statistical Arbitrage',
    'News Scalping (5min before/after)',
    'Reverse Hedging',
    'Group Hedging'
  ],

  // Position Sizing by Tier
  highTierRisk: 1.0,              // 1% for HIGH confidence (Phase 1 conservative)
  mediumTierRisk: 0.0,            // 0% for MEDIUM (practice only — never live trade)

  // Safety Features
  enableDailyLossProtection: true,
  enableDrawdownProtection: true,
  autoStopOnDailyLimit: true
};

// The5ers Phase 2 Configuration (after passing Phase 1)
export const THE5ERS_BOOTCAMP_PHASE2: PropFirmConfig = {
  ...THE5ERS_BOOTCAMP,
  challengeType: 'Bootcamp Phase 2',
  riskPerTrade: 1.5,              // Slightly more aggressive after proving strategy
  highTierRisk: 1.5,
};

// BrightFunded Phase 1 — Scale-up firm (truly static 10% drawdown, ~4hr payouts)
// Switch to this AFTER The5ers Bootcamp is passed and system is proven profitable
export const BRIGHTFUNDED_PHASE1: PropFirmConfig = {
  name: 'BrightFunded',
  challengeType: 'Standard Phase 1',

  riskPerTrade: 1.0,
  maxDailyLoss: 5.0,              // 5% daily drawdown limit
  dailyLossBuffer: 4.0,
  maxDrawdown: 10.0,              // 10% truly static max drawdown
  drawdownType: 'static',

  phase1Target: 8.0,              // 8% Phase 1 target
  phase2Target: 5.0,              // 5% Phase 2 target

  minTradingDays: 0,
  maxTradesPerDay: 3,
  allowedStrategies: [
    'ICT 3-Timeframe Strategy',
    'FVG Entry Strategy',
    'Swing Trading',
    'Day Trading',
  ],
  prohibitedStrategies: [
    'High-Frequency Trading (HFT)',
    'Tick Scalping',
    'Latency Arbitrage',
    'Statistical Arbitrage',
    'News Scalping (5min before/after)',
    'Reverse Hedging',
    'Group Hedging'
  ],

  highTierRisk: 1.0,
  mediumTierRisk: 0.0,

  enableDailyLossProtection: true,
  enableDrawdownProtection: true,
  autoStopOnDailyLimit: true
};

// Daily Loss Tracking
interface DailyLossTracker {
  date: string;                   // YYYY-MM-DD
  startingBalance: number;
  currentBalance: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  tradesCount: number;
  isLocked: boolean;              // True if daily loss limit hit
}

class PropFirmService {
  private config: PropFirmConfig = THE5ERS_BOOTCAMP;
  // Auto-initialize with today's date so canTrade() works from first request
  private dailyTracker: DailyLossTracker = {
    date: new Date().toISOString().split('T')[0],
    startingBalance: 10000,
    currentBalance: 10000,
    dailyPnL: 0,
    dailyPnLPercent: 0,
    tradesCount: 0,
    isLocked: false
  };

  /**
   * Set the active prop firm configuration
   */
  setConfig(config: PropFirmConfig): void {
    this.config = config;
    console.log(`[PropFirm] Configuration set: ${config.name} - ${config.challengeType}`);
    console.log(`[PropFirm] Risk per trade: ${config.riskPerTrade}%`);
    console.log(`[PropFirm] Daily loss limit: ${config.maxDailyLoss}% (buffer at ${config.dailyLossBuffer}%)`);
  }

  /**
   * Get current configuration
   */
  getConfig(): PropFirmConfig {
    return this.config;
  }

  /**
   * Get position size for a given confidence tier
   */
  getPositionSize(tier: 'HIGH' | 'MEDIUM'): number {
    if (tier === 'HIGH') {
      return this.config.highTierRisk;
    }
    return this.config.mediumTierRisk;
  }

  /**
   * Check if trading is allowed (daily loss protection)
   */
  canTrade(currentDailyLossPercent: number): { allowed: boolean; reason: string } {
    if (this.config.enableDailyLossProtection) {
      if (currentDailyLossPercent >= this.config.dailyLossBuffer) {
        return {
          allowed: false,
          reason: `Daily loss buffer reached: ${currentDailyLossPercent.toFixed(2)}% >= ${this.config.dailyLossBuffer}% buffer (limit: ${this.config.maxDailyLoss}%)`
        };
      }
    }

    if (this.dailyTracker?.isLocked) {
      return {
        allowed: false,
        reason: 'Trading locked for today due to daily loss limit'
      };
    }

    return { allowed: true, reason: 'Trading allowed' };
  }

  /**
   * Check if strategy is allowed
   */
  isStrategyAllowed(strategyName: string): boolean {
    const isProhibited = this.config.prohibitedStrategies.some(
      prohibited => strategyName.toLowerCase().includes(prohibited.toLowerCase())
    );

    if (isProhibited) {
      console.warn(`[PropFirm] Strategy "${strategyName}" is PROHIBITED for ${this.config.name}`);
      return false;
    }

    return true;
  }

  /**
   * Initialize daily tracker
   */
  initDailyTracker(startingBalance: number): void {
    const today = new Date().toISOString().split('T')[0];

    if (this.dailyTracker?.date !== today) {
      this.dailyTracker = {
        date: today,
        startingBalance,
        currentBalance: startingBalance,
        dailyPnL: 0,
        dailyPnLPercent: 0,
        tradesCount: 0,
        isLocked: false
      };
      console.log(`[PropFirm] Daily tracker initialized for ${today} with balance $${startingBalance}`);
    }
  }

  /**
   * Update daily tracker with trade result
   */
  updateDailyTracker(pnl: number, currentBalance: number): void {
    if (!this.dailyTracker) return;

    this.dailyTracker.currentBalance = currentBalance;
    this.dailyTracker.dailyPnL += pnl;
    this.dailyTracker.dailyPnLPercent = (this.dailyTracker.dailyPnL / this.dailyTracker.startingBalance) * 100;
    this.dailyTracker.tradesCount++;

    if (this.dailyTracker.dailyPnLPercent <= -this.config.dailyLossBuffer) {
      this.dailyTracker.isLocked = true;
      console.warn(`[PropFirm] DAILY LOSS BUFFER HIT! Trading locked for today.`);
      console.warn(`[PropFirm] Daily P&L: ${this.dailyTracker.dailyPnLPercent.toFixed(2)}%`);
    }

    console.log(`[PropFirm] Daily update: P&L ${this.dailyTracker.dailyPnLPercent.toFixed(2)}%, Trades: ${this.dailyTracker.tradesCount}`);
  }

  /**
   * Get daily tracker status
   */
  getDailyStatus(): DailyLossTracker {
    return this.dailyTracker;
  }

  /**
   * Force reset daily tracker (for new trading day or fresh start)
   */
  resetDailyTracker(startingBalance: number): void {
    const today = new Date().toISOString().split('T')[0];

    this.dailyTracker = {
      date: today,
      startingBalance,
      currentBalance: startingBalance,
      dailyPnL: 0,
      dailyPnLPercent: 0,
      tradesCount: 0,
      isLocked: false
    };

    console.log(`[PropFirm] Daily tracker RESET for ${today} with balance $${startingBalance}`);
    console.log(`[PropFirm] All counters cleared. Trading unlocked.`);
  }

  /**
   * Check if max trades per day reached.
   * IMPORTANT: Queries the DATABASE (not in-memory) so this survives Render restarts.
   * Render free tier restarts on every UptimeRobot ping — in-memory counters are unreliable.
   */
  async maxTradesReached(): Promise<boolean> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const result = await db.execute(sql`
        SELECT COUNT(*) as n
        FROM signal_history
        WHERE data_quality = 'production'
          AND DATE(created_at AT TIME ZONE 'UTC') = ${today}::date
          AND outcome IN ('PENDING', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')
      `);
      const count = Number((result as any[])[0]?.n ?? 0);
      if (count >= this.config.maxTradesPerDay) {
        console.log(`[PropFirm] Max trades reached: ${count}/${this.config.maxTradesPerDay} today (DB check)`);
        return true;
      }
      return false;
    } catch (err) {
      // If DB query fails, fall back to in-memory counter (safe default)
      console.warn('[PropFirm] DB trade count check failed, using in-memory fallback:', err);
      return this.dailyTracker.tradesCount >= this.config.maxTradesPerDay;
    }
  }

  /**
   * Get risk management summary for display
   */
  getRiskSummary(): object {
    return {
      propFirm: this.config.name,
      challengeType: this.config.challengeType,
      riskPerTrade: `${this.config.riskPerTrade}%`,
      dailyLossLimit: `${this.config.maxDailyLoss}%`,
      dailyLossBuffer: `${this.config.dailyLossBuffer}%`,
      maxDrawdown: `${this.config.maxDrawdown}%`,
      drawdownType: this.config.drawdownType,
      maxTradesPerDay: this.config.maxTradesPerDay,
      phase1Target: `${this.config.phase1Target}%`,
      phase2Target: `${this.config.phase2Target}%`,
      currentDailyPnL: this.dailyTracker ? `${this.dailyTracker.dailyPnLPercent.toFixed(2)}%` : 'N/A',
      tradesToday: this.dailyTracker?.tradesCount || 0,
      tradingLocked: this.dailyTracker?.isLocked || false
    };
  }
}

// Export singleton instance
export const propFirmService = new PropFirmService();

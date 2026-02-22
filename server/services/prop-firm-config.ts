/**
 * Prop Firm Configuration Service
 * Configures trading parameters for specific prop firm challenges
 *
 * FXIFY Two-Phase Standard Configuration:
 * - Phase 1: 5% profit target, 4% daily loss, 10% max drawdown
 * - Phase 2: 5% profit target, 4% daily loss, 10% max drawdown
 * - Static drawdown (recommended for EA trading)
 * - EAs allowed on MT4/MT5
 * - Minimum 5 trading days
 * - No time limit
 */

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

// FXIFY Two-Phase Standard Configuration
export const FXIFY_TWO_PHASE_STANDARD: PropFirmConfig = {
  name: 'FXIFY',
  challengeType: 'Two-Phase Standard',

  // Risk Management - Conservative for Phase 1
  riskPerTrade: 1.0,              // 1% risk per trade (conservative)
  maxDailyLoss: 4.0,              // 4% daily loss limit
  dailyLossBuffer: 3.0,           // Stop trading at 3% (leaves 1% buffer)
  maxDrawdown: 10.0,              // 10% max drawdown
  drawdownType: 'static',         // Static drawdown (recommended for EA)

  // Profit Targets
  phase1Target: 5.0,              // 5% profit target Phase 1
  phase2Target: 5.0,              // 5% profit target Phase 2

  // Trading Rules
  minTradingDays: 5,              // Minimum 5 trading days
  maxTradesPerDay: 3,             // Max 3 trades per day (protects daily loss)
  allowedStrategies: [
    'ICT 3-Timeframe Strategy',
    'Swing Trading',
    'Day Trading',
    'Position Trading'
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
  mediumTierRisk: 0.0,            // 0% for MEDIUM (practice only)

  // Safety Features
  enableDailyLossProtection: true,
  enableDrawdownProtection: true,
  autoStopOnDailyLimit: true
};

// Phase 2 Configuration (slightly more aggressive after passing Phase 1)
export const FXIFY_TWO_PHASE_STANDARD_PHASE2: PropFirmConfig = {
  ...FXIFY_TWO_PHASE_STANDARD,
  challengeType: 'Two-Phase Standard (Phase 2)',
  riskPerTrade: 1.5,              // 1.5% risk per trade (can be more aggressive)
  highTierRisk: 1.5,              // 1.5% for HIGH confidence
};

// Funded Account Configuration (most conservative)
export const FXIFY_FUNDED_ACCOUNT: PropFirmConfig = {
  ...FXIFY_TWO_PHASE_STANDARD,
  challengeType: 'Funded Account',
  riskPerTrade: 1.0,              // Back to 1% for funded (protect capital)
  highTierRisk: 1.0,
  dailyLossBuffer: 2.5,           // Even more conservative on funded account
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
  private config: PropFirmConfig = FXIFY_TWO_PHASE_STANDARD;
  // Auto-initialize with today's date so canTrade() works from first request (even before signal gen runs)
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
    // Check daily loss limit
    if (this.config.enableDailyLossProtection) {
      if (currentDailyLossPercent >= this.config.dailyLossBuffer) {
        return {
          allowed: false,
          reason: `Daily loss buffer reached: ${currentDailyLossPercent.toFixed(2)}% >= ${this.config.dailyLossBuffer}% buffer (limit: ${this.config.maxDailyLoss}%)`
        };
      }
    }

    // Check if daily tracker is locked
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
    // Check if explicitly prohibited
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

    // Reset if new day
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

    // Check if we should lock trading for the day
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
   * Unlike initDailyTracker, this always resets regardless of date
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
   * Check if max trades per day reached
   */
  maxTradesReached(): boolean {
    return this.dailyTracker.tradesCount >= this.config.maxTradesPerDay;
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

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { API_ENDPOINTS } from '../../client/src/config/api';
import { exchangeRateAPI } from './exchangerate-api';

/**
 * Outcome Validator Service
 * Runs every 5 minutes to check if pending signals hit TP1 or Stop Loss
 */

interface PendingSignal {
  id: string;
  signal_id: string;
  user_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  created_at: Date;
  expires_at: Date;
}

interface ForexQuote {
  symbol: string;
  price: number;
  timestamp: string;
}

export class OutcomeValidator {
  private isRunning = false;
  private lastRunTime = 0;

  /**
   * Get the timestamp of the last successful run
   */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  /**
   * Main validation loop - checks all pending signals
   */
  async validatePendingSignals(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️  Validator already running, skipping...');
      return;
    }

    this.isRunning = true;
    this.lastRunTime = Date.now();
    console.log('🔍 [Outcome Validator] Starting validation cycle...');

    try {
      // 1. Fetch all PENDING signals
      const pendingSignals = await this.fetchPendingSignals();

      if (!pendingSignals || !Array.isArray(pendingSignals)) {
        console.log('⚠️  No pending signals data returned');
        return;
      }

      console.log(`📊 Found ${pendingSignals.length} pending signals`);

      if (pendingSignals.length === 0) {
        console.log('✅ No pending signals to validate');
        return;
      }

      // 2. Get current prices for all unique symbols
      const uniqueSymbols = Array.from(new Set(pendingSignals.map(s => s.symbol)));
      const currentPrices = await this.fetchCurrentPrices(uniqueSymbols);

      // 3. Check each signal
      let updated = 0;
      let expired = 0;

      for (const signal of pendingSignals) {
        const currentPrice = currentPrices.get(signal.symbol);

        if (!currentPrice) {
          console.warn(`⚠️  No price data for ${signal.symbol}, skipping signal ${signal.signal_id}`);
          continue;
        }

        // Check if signal expired (48 hours)
        if (new Date() > new Date(signal.expires_at)) {
          await this.markAsExpired(signal);
          expired++;
          continue;
        }

        // Check if TP or SL hit
        const outcome = this.checkOutcome(signal, currentPrice);

        if (outcome) {
          await this.updateSignalOutcome(signal, outcome, currentPrice);
          updated++;
        }
      }

      console.log(`✅ Validation complete: ${updated} updated, ${expired} expired`);

    } catch (error) {
      console.error('❌ [Outcome Validator] Error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch all signals with PENDING outcome
   */
  private async fetchPendingSignals(): Promise<PendingSignal[]> {
    const result = await db.execute(sql`
      SELECT
        id, signal_id, user_id, symbol, type,
        entry_price, stop_loss, tp1, tp2, tp3,
        created_at, expires_at
      FROM signal_history
      WHERE outcome = 'PENDING'
      ORDER BY created_at DESC
    `);

    return result as any[];
  }

  /**
   * Fetch current prices from Forex API
   */
  private async fetchCurrentPrices(symbols: string[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    try {
      console.log('📡 Fetching current prices from ExchangeRate-API...');

      // Use the existing exchangeRateAPI service (has 15-min caching!)
      const quotes = await exchangeRateAPI.fetchAllQuotes();

      // Map quotes to price map
      for (const quote of quotes) {
        priceMap.set(quote.symbol, quote.exchangeRate);
      }

      console.log(`✅ Fetched prices for ${priceMap.size} currency pairs`);

    } catch (error) {
      console.error('❌ Error fetching forex prices:', error);
    }

    return priceMap;
  }

  /**
   * Check if signal hit TP1 or Stop Loss
   */
  private checkOutcome(
    signal: PendingSignal,
    currentPrice: number
  ): 'TP1_HIT' | 'STOP_HIT' | null {

    if (signal.type === 'LONG') {
      // LONG: TP1 is above entry, SL is below entry
      if (currentPrice >= signal.tp1) {
        return 'TP1_HIT';
      }
      if (currentPrice <= signal.stop_loss) {
        return 'STOP_HIT';
      }
    } else {
      // SHORT: TP1 is below entry, SL is above entry
      if (currentPrice <= signal.tp1) {
        return 'TP1_HIT';
      }
      if (currentPrice >= signal.stop_loss) {
        return 'STOP_HIT';
      }
    }

    return null;
  }

  /**
   * Update signal with outcome
   */
  private async updateSignalOutcome(
    signal: PendingSignal,
    outcome: 'TP1_HIT' | 'STOP_HIT',
    outcomePrice: number
  ): Promise<void> {
    // Calculate profit/loss in pips
    const pipValue = 0.0001; // Standard for most forex pairs
    let profitLossPips: number;

    if (signal.type === 'LONG') {
      profitLossPips = (outcomePrice - signal.entry_price) / pipValue;
    } else {
      profitLossPips = (signal.entry_price - outcomePrice) / pipValue;
    }

    await db.execute(sql`
      UPDATE signal_history
      SET
        outcome = ${outcome},
        outcome_price = ${outcomePrice},
        outcome_time = NOW(),
        profit_loss_pips = ${profitLossPips},
        updated_at = NOW()
      WHERE signal_id = ${signal.signal_id}
    `);

    console.log(`✅ Signal ${signal.signal_id} → ${outcome} at ${outcomePrice} (${profitLossPips.toFixed(1)} pips)`);

    // Update performance metrics
    await this.updatePerformanceMetrics(signal);
  }

  /**
   * Mark signal as expired
   */
  private async markAsExpired(signal: PendingSignal): Promise<void> {
    await db.execute(sql`
      UPDATE signal_history
      SET
        outcome = 'EXPIRED',
        outcome_time = NOW(),
        updated_at = NOW()
      WHERE signal_id = ${signal.signal_id}
    `);

    console.log(`⏰ Signal ${signal.signal_id} expired (48 hours passed)`);

    // Update performance metrics
    await this.updatePerformanceMetrics(signal);
  }

  /**
   * Update aggregated performance metrics
   */
  private async updatePerformanceMetrics(signal: PendingSignal): Promise<void> {
    try {
      // Determine confidence bracket
      const indicators = await this.getSignalIndicators(signal.signal_id);
      const confidence = indicators?.confidence || 70;

      let confidenceBracket: string;
      if (confidence >= 90) {
        confidenceBracket = '90-100';
      } else if (confidence >= 80) {
        confidenceBracket = '80-89';
      } else {
        confidenceBracket = '70-79';
      }

      // Get strategy version
      const strategyVersion = indicators?.strategy_version || '1.0.0';

      // Call calculate_strategy_performance function for this specific bracket
      await db.execute(sql`
        SELECT calculate_strategy_performance(
          ${signal.user_id},
          ${signal.symbol},
          ${confidenceBracket},
          ${strategyVersion}
        )
      `);

      // Also update 'ALL' bracket
      await db.execute(sql`
        SELECT calculate_strategy_performance(
          ${signal.user_id},
          ${signal.symbol},
          'ALL',
          ${strategyVersion}
        )
      `);

    } catch (error) {
      console.error('❌ Error updating performance metrics:', error);
    }
  }

  /**
   * Get signal indicators (confidence, strategy version)
   */
  private async getSignalIndicators(signalId: string): Promise<any> {
    const result = await db.execute(sql`
      SELECT indicators->>'confidence' as confidence,
             strategy_version
      FROM signal_history
      WHERE signal_id = ${signalId}
      LIMIT 1
    `);

    return (result as any)[0];
  }

  /**
   * REMOVED: start() method no longer needed
   * Outcome validation is now triggered via HTTP endpoint /api/cron/validate-outcomes
   * This allows the service to work on Render free tier (which sleeps after 15 min)
   * UptimeRobot pings the endpoint every 5 minutes to trigger validation
   */
}

// Export singleton instance
export const outcomeValidator = new OutcomeValidator();

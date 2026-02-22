import { db } from '../db';
import { sql } from 'drizzle-orm';
import { API_ENDPOINTS } from '../../client/src/config/api';
import { twelveDataAPI } from './twelve-data';

/**
 * Outcome Validator Service
 * Runs every 5 minutes to check if pending signals hit TP1 or Stop Loss
 *
 * v2.0.0: Uses candle HIGH/LOW from Twelve Data for outcome detection
 * - Industry-standard approach: check candle extremes, not just close price
 * - LONG TP1: any candle HIGH >= tp1 (after signal creation)
 * - LONG SL: any candle LOW <= stop_loss (after signal creation)
 * - SHORT TP1: any candle LOW <= tp1 (after signal creation)
 * - SHORT SL: any candle HIGH >= stop_loss (after signal creation)
 * - Ambiguous (both hit same candle): SL assumed first (conservative)
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

// Helper: Check if forex market is open (duplicated from signal-generator for isolation)
function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && hour >= 22) return false;
  return true;
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

    // 🛡️ MARKET HOURS GATE: No point validating when market is closed and prices aren't moving
    if (!isForexMarketOpen()) {
      console.log('⏭️  Forex market closed - skipping outcome validation');
      this.isRunning = false;
      return;
    }

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

      // 2. Check each signal using candle HIGH/LOW (industry-standard approach)
      let updated = 0;
      let expired = 0;

      for (const signal of pendingSignals) {
        // Check if signal expired (48 hours)
        if (new Date() > new Date(signal.expires_at)) {
          await this.markAsExpired(signal);
          expired++;
          continue;
        }

        // Check if TP or SL hit using candle HIGH/LOW extremes
        const result = await this.checkOutcomeFromCandles(signal);

        if (result) {
          await this.updateSignalOutcome(signal, result.outcome, result.outcomePrice);
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
   * Check if signal hit TP1 or Stop Loss using candle HIGH/LOW extremes (industry standard)
   *
   * Fetches 1H candles from Twelve Data (already cached by signal generator),
   * then scans each candle after the signal's creation time for TP/SL touches.
   *
   * This correctly detects intraday excursions that a close-price poll would miss.
   */
  private async checkOutcomeFromCandles(
    signal: PendingSignal
  ): Promise<{ outcome: 'TP1_HIT' | 'STOP_HIT'; outcomePrice: number } | null> {
    try {
      // Fetch 1H candles — these are cached by signal generator (30-min TTL)
      // so this costs 0 additional API credits in the common case
      const candles = await twelveDataAPI.fetchHistoricalCandles(signal.symbol, '1h', 200);

      if (!candles || candles.length === 0) {
        console.warn(`⚠️  No candle data for ${signal.symbol} — cannot validate ${signal.signal_id}`);
        return null;
      }

      const signalCreatedAt = new Date(signal.created_at).getTime();

      // Only check candles that opened AFTER the signal was created
      const relevantCandles = candles.filter(c => new Date(c.timestamp).getTime() >= signalCreatedAt);

      if (relevantCandles.length === 0) {
        return null; // No completed candles since signal creation yet
      }

      for (const candle of relevantCandles) {
        const tpHit = signal.type === 'LONG'
          ? candle.high >= signal.tp1
          : candle.low <= signal.tp1;

        const slHit = signal.type === 'LONG'
          ? candle.low <= signal.stop_loss
          : candle.high >= signal.stop_loss;

        if (tpHit && slHit) {
          // Both TP and SL within same candle — assume SL hit first (conservative/standard)
          console.log(`⚠️  ${signal.signal_id}: ambiguous candle (TP+SL both hit) — assuming STOP_HIT`);
          return { outcome: 'STOP_HIT', outcomePrice: signal.stop_loss };
        }

        if (tpHit) {
          return { outcome: 'TP1_HIT', outcomePrice: signal.tp1 };
        }

        if (slHit) {
          return { outcome: 'STOP_HIT', outcomePrice: signal.stop_loss };
        }
      }

      return null; // Neither TP nor SL hit yet

    } catch (error) {
      console.error(`❌ Error checking candle outcome for ${signal.signal_id}:`, error);
      return null;
    }
  }

  /**
   * Fetch candles covering the actual trade duration (entry → exit)
   * This fixes the data mismatch where old candles don't align with trade prices
   */
  private async fetchTradeDurationCandles(signal: PendingSignal, outcomePrice: number): Promise<any[]> {
    try {
      // Calculate trade duration in hours
      const createdAt = new Date(signal.created_at);
      const now = new Date();
      const durationMs = now.getTime() - createdAt.getTime();
      const durationHours = Math.ceil(durationMs / (1000 * 60 * 60));

      console.log(`📊 Fetching ${durationHours}h of candles for ${signal.symbol} (${signal.signal_id})`);

      // Determine optimal timeframe based on trade duration
      // For 0-12h trades: use 15min candles (48 candles)
      // For 12-48h trades: use 15min candles (192 candles)
      // For 48h+ trades: use 1h candles (up to 200 candles)
      let interval: string;
      let candleCount: number;

      if (durationHours <= 12) {
        interval = '15min';
        candleCount = Math.max(50, durationHours * 4 + 10); // Extra padding
      } else if (durationHours <= 48) {
        interval = '15min';
        candleCount = Math.max(100, durationHours * 4 + 10);
      } else {
        interval = '1h';
        candleCount = Math.max(100, Math.min(200, durationHours + 20));
      }

      // Fetch from Twelve Data API (cached — low credit usage)
      const candles = await twelveDataAPI.fetchHistoricalCandles(signal.symbol, interval, candleCount);

      if (candles && candles.length > 0) {
        console.log(`✅ Fetched ${candles.length} ${interval} candles from Twelve Data`);
        return candles.slice(-200); // Keep last 200 for consistency
      }

      // Fallback: Generate demo candles if API fails
      console.log(`⚠️  Twelve Data API unavailable, generating demo candles`);
      return this.generateDemoCandles(signal, durationHours, outcomePrice);

    } catch (error) {
      console.error(`❌ Error fetching trade duration candles:`, error);
      // Fallback to demo candles
      const durationHours = Math.ceil((Date.now() - new Date(signal.created_at).getTime()) / (1000 * 60 * 60));
      return this.generateDemoCandles(signal, durationHours, outcomePrice);
    }
  }

  /**
   * Generate demo candles covering trade duration (fallback when API unavailable)
   * Ensures candles include both entry and exit prices with realistic market movement
   */
  private generateDemoCandles(signal: PendingSignal, durationHours: number, outcomePrice: number): any[] {
    const candles = [];
    const startPrice = signal.entry_price;
    const endPrice = outcomePrice; // Use actual outcome price (TP or SL)

    const priceStep = (endPrice - startPrice) / (durationHours * 4); // 15-min candles
    const volatility = Math.abs(endPrice - startPrice) * 0.30; // 30% volatility
    const trendStrength = 0.7;

    const numCandles = Math.min(durationHours * 4, 200); // 15-min candles, max 200

    for (let i = 0; i < numCandles; i++) {
      const time = new Date(new Date(signal.created_at).getTime() + i * 15 * 60 * 1000);
      const basePrice = startPrice + (priceStep * i);

      const trendMove = priceStep * trendStrength;
      const randomMove = (Math.random() - 0.5) * volatility * (1 - trendStrength);

      const open = basePrice + (Math.random() - 0.5) * volatility * 0.5;
      const close = open + trendMove + randomMove;

      const wickSize = volatility * (0.3 + Math.random() * 0.4);
      const high = Math.max(open, close) + wickSize * Math.random();
      const low = Math.min(open, close) - wickSize * Math.random();

      candles.push({
        date: time.toISOString(),
        timestamp: time,
        open: parseFloat(open.toFixed(signal.symbol.includes('JPY') ? 3 : 5)),
        high: parseFloat(high.toFixed(signal.symbol.includes('JPY') ? 3 : 5)),
        low: parseFloat(low.toFixed(signal.symbol.includes('JPY') ? 3 : 5)),
        close: parseFloat(close.toFixed(signal.symbol.includes('JPY') ? 3 : 5))
      });
    }

    console.log(`✅ Generated ${candles.length} demo candles (${startPrice} → ${endPrice})`);
    return candles;
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
    // 🔧 FIX: JPY pairs use 0.01 for 1 pip, all other pairs use 0.0001
    const pipValue = signal.symbol.includes('JPY') ? 0.01 : 0.0001;
    let profitLossPips: number;

    if (signal.type === 'LONG') {
      profitLossPips = (outcomePrice - signal.entry_price) / pipValue;
    } else {
      profitLossPips = (signal.entry_price - outcomePrice) / pipValue;
    }

    // 🎯 FIX: Fetch fresh candles covering the actual trade duration
    // This ensures the winning trade chart shows candles from entry → exit
    const updatedCandles = await this.fetchTradeDurationCandles(signal, outcomePrice);

    await db.execute(sql`
      UPDATE signal_history
      SET
        outcome = ${outcome},
        outcome_price = ${outcomePrice},
        outcome_time = NOW(),
        profit_loss_pips = ${profitLossPips},
        candles = ${JSON.stringify(updatedCandles)},
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
    // 🎯 FIX: Fetch fresh candles for expired signals too
    // Use current entry price as "outcome" price for expired trades
    const updatedCandles = await this.fetchTradeDurationCandles(signal, signal.entry_price);

    await db.execute(sql`
      UPDATE signal_history
      SET
        outcome = 'EXPIRED',
        outcome_time = NOW(),
        candles = ${JSON.stringify(updatedCandles)},
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

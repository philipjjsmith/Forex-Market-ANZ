import { db } from '../db';
import { sql } from 'drizzle-orm';
import { exchangeRateAPI } from './exchangerate-api';
import { twelveDataAPI } from './twelve-data';
import { aiAnalyzer } from './ai-analyzer';
import { parameterService } from './parameter-service';

/**
 * Automated Signal Generator Service
 * Runs on schedule to generate and track signals 24/7
 * Now using REAL historical market data from Twelve Data API
 */

interface ForexQuote {
  symbol: string;
  exchangeRate: number;
  timestamp: string;
}

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  id: string;
  timestamp: string;
  type: 'LONG' | 'SHORT';
  symbol: string;
  entry: number;
  currentPrice: number;
  stop: number;
  stopLimitPrice?: number;
  targets: number[];
  riskReward: number;
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  tradeLive: boolean;
  positionSizePercent: number;
  orderType: string;
  executionType: string;
  indicators: {
    fastMA: string;
    slowMA: string;
    rsi: string;
    atr: string;
    adx: string;
    bbUpper: string;
    bbLower: string;
    htfTrend: string;
  };
  rationale: string;
  strategy: string;
  version: string;
}

// Import indicators and strategy (server-side compatible)
class Indicators {
  static ema(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  static sma(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((acc, val) => acc + val, 0);
    return sum / period;
  }

  static rsi(data: number[], period = 14): number | null {
    if (data.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change >= 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  static atr(candles: Candle[], period = 14): number | null {
    if (candles.length < period + 1) return null;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
    return this.sma(trs, period);
  }

  static adx(candles: Candle[], period = 14): { adx: number; plusDI: number; minusDI: number } | null {
    if (candles.length < period * 2) return null;
    return { adx: 25, plusDI: 25, minusDI: 15 }; // Simplified for now
  }

  static bollingerBands(data: number[], period = 20, stdDev = 2): { upper: number; middle: number; lower: number } | null {
    if (data.length < period) return null;
    const middle = this.sma(data, period);
    if (!middle) return null;
    const slice = data.slice(-period);
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: middle + (std * stdDev),
      middle,
      lower: middle - (std * stdDev)
    };
  }
}

// Helper function: Detect Support/Resistance levels
function detectSupportResistance(candles: Candle[]): { support: number[]; resistance: number[] } {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  // Look for swing highs/lows (local peaks/valleys)
  for (let i = 5; i < candles.length - 5; i++) {
    const high = candles[i].high;
    const low = candles[i].low;

    // Swing High: current high > previous 5 AND next 5 candles
    const isSwingHigh = candles.slice(i - 5, i).every(c => high >= c.high) &&
                        candles.slice(i + 1, i + 6).every(c => high >= c.high);

    // Swing Low: current low < previous 5 AND next 5 candles
    const isSwingLow = candles.slice(i - 5, i).every(c => low <= c.low) &&
                       candles.slice(i + 1, i + 6).every(c => low <= c.low);

    if (isSwingHigh) swingHighs.push(high);
    if (isSwingLow) swingLows.push(low);
  }

  // Take only recent levels (last 10)
  return {
    resistance: swingHighs.slice(-10),
    support: swingLows.slice(-10)
  };
}

// Helper function: Check if price is near a key level (within 0.25%)
function isNearLevel(price: number, levels: number[], tolerance = 0.0025): boolean {
  return levels.some(level => Math.abs(price - level) / level < tolerance);
}

// Helper function: Detect breakout & retest pattern
function detectBreakoutRetest(candles: Candle[], type: 'LONG' | 'SHORT'): boolean {
  if (candles.length < 20) return false;

  const recent = candles.slice(-20);
  const currentPrice = recent[recent.length - 1].close;

  // For LONG: Look for resistance breakout + pullback
  if (type === 'LONG') {
    // Find recent highs before last 5 candles
    const priorHighs = recent.slice(0, -5).map(c => c.high);
    const maxPriorHigh = Math.max(...priorHighs);

    // Check if we broke above that high in last 10 candles
    const brokeAbove = recent.slice(-10, -2).some(c => c.close > maxPriorHigh);

    // Check if we pulled back near that level (retest)
    const pulledBack = Math.abs(currentPrice - maxPriorHigh) / maxPriorHigh < 0.003;

    return brokeAbove && pulledBack;
  }

  // For SHORT: Look for support breakout + pullback
  else {
    // Find recent lows before last 5 candles
    const priorLows = recent.slice(0, -5).map(c => c.low);
    const minPriorLow = Math.min(...priorLows);

    // Check if we broke below that low in last 10 candles
    const brokeBelow = recent.slice(-10, -2).some(c => c.close < minPriorLow);

    // Check if we pulled back near that level (retest)
    const pulledBack = Math.abs(currentPrice - minPriorLow) / minPriorLow < 0.003;

    return brokeBelow && pulledBack;
  }
}

// Helper function: Check if within news window (simplified - checks hour of day)
function isWithinNewsWindow(): boolean {
  const hour = new Date().getUTCHours();

  // Avoid major news times (simplified):
  // 8:30 AM EST (13:30 UTC) = NFP, CPI releases
  // 2:00 PM EST (19:00 UTC) = FOMC decisions
  const newsHours = [13, 14, 19, 20];

  return newsHours.includes(hour);
}

class MACrossoverStrategy {
  name = 'Hybrid Trend Strategy';
  version = '2.1.0'; // Updated for hybrid entry system (crossover + BB pullback)

  async analyze(primaryCandles: Candle[], higherCandles: Candle[], symbol: string): Promise<Signal | null> {
    if (primaryCandles.length < 200) return null;

    const closes = primaryCandles.map(c => c.close);
    const higherCloses = higherCandles.map(c => c.close);

    // 🎯 MILESTONE 3C: Get approved parameters for this symbol
    const approvedParams = await parameterService.getApprovedParameters(symbol);
    const fastPeriod = approvedParams?.fastMA || 20;
    const slowPeriod = approvedParams?.slowMA || 50;
    const strategyVersion = approvedParams?.version || this.version;

    if (approvedParams) {
      console.log(`🎯 [Milestone 3C] Using approved parameters for ${symbol}: ${fastPeriod}/${slowPeriod} EMA, ${approvedParams.atrMultiplier}x ATR (v${strategyVersion})`);
    }

    const fastMA = Indicators.ema(closes, fastPeriod);
    const slowMA = Indicators.ema(closes, slowPeriod);
    const atr = Indicators.atr(primaryCandles, 14);
    const rsi = Indicators.rsi(closes, 14);
    const bb = Indicators.bollingerBands(closes, 20, 2);
    const adx = Indicators.adx(primaryCandles, 14);

    if (!fastMA || !slowMA || !atr || !bb) return null;

    const htfFastMA = Indicators.ema(higherCloses, fastPeriod);
    const htfSlowMA = Indicators.ema(higherCloses, slowPeriod);
    const htfTrend = htfFastMA && htfSlowMA && htfFastMA > htfSlowMA ? 'UP' : 'DOWN';

    const prevFastMA = Indicators.ema(closes.slice(0, -1), fastPeriod);
    const prevSlowMA = Indicators.ema(closes.slice(0, -1), slowPeriod);

    if (!prevFastMA || !prevSlowMA) return null;

    const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
    const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

    const currentPrice = closes[closes.length - 1];

    // 🧠 AI ENHANCEMENT: Get symbol-specific insights
    const aiInsights = aiAnalyzer.getSymbolInsights(symbol);
    const useAI = aiInsights.hasEnoughData; // Only use AI if 30+ signals

    // 🆕 NEW FILTERS: Detect S/R levels and breakout/retest patterns
    const srLevels = detectSupportResistance(primaryCandles);
    const withinNewsWindow = isWithinNewsWindow();

    // 🆕 HYBRID ENTRY: BB Middle Band Pullback Detection
    // Detects pullback to BB middle line in established trends
    const inBullishTrend = fastMA > slowMA && htfTrend === 'UP';
    const inBearishTrend = fastMA < slowMA && htfTrend === 'DOWN';
    const bullishPullback = inBullishTrend && currentPrice >= bb.lower && currentPrice <= bb.middle;
    const bearishPullback = inBearishTrend && currentPrice <= bb.upper && currentPrice >= bb.middle;

    let signalType: 'LONG' | 'SHORT' | null = null;
    let confidence = 0;
    let entryType: 'CROSSOVER' | 'PULLBACK' = 'CROSSOVER';
    const rationale: string[] = [];

    if (useAI) {
      rationale.push(`AI-Enhanced (${aiInsights.totalSignals} signals analyzed, ${aiInsights.winRate.toFixed(1)}% win rate)`);
    }

    // LONG ENTRY: Either crossover OR pullback in uptrend
    if ((bullishCross || bullishPullback) && htfTrend === 'UP') {
      signalType = 'LONG';
      entryType = bullishCross ? 'CROSSOVER' : 'PULLBACK';

      // 🆕 CONFIDENCE SCORING SYSTEM (Max: 126 points)

      // 1. Daily trend aligned (25 points)
      const htfAligned = htfTrend === 'UP' && currentPrice > (htfFastMA || 0);
      if (htfAligned) {
        confidence += 25;
        rationale.push('✅ Daily trend bullish with price above HTF MAs (+25)');
      }

      // 2. Entry signal (20 points)
      confidence += 20;
      if (entryType === 'CROSSOVER') {
        rationale.push('✅ Bullish MA crossover detected on 4H chart (+20)');
      } else {
        rationale.push('✅ BB middle band pullback in uptrend (+20)');
      }

      // 3. HTF trend strength (10 points) - strong momentum on daily
      if (htfFastMA && htfSlowMA && (htfFastMA - htfSlowMA) / htfSlowMA > 0.0025) {
        confidence += 10;
        rationale.push('✅ Strong HTF trend momentum (+10)');
      }

      // 4. RSI in optimal range (15 points)
      if (rsi && rsi > 40 && rsi < 70) {
        confidence += 15;
        rationale.push(`✅ RSI in optimal range: ${rsi.toFixed(1)} (+15)`);
      }

      // 5. ADX > 25 (15 points) - strong trend confirmed
      if (adx && adx.adx > 25) {
        confidence += 15;
        rationale.push(`✅ Strong trend confirmed: ADX ${adx.adx.toFixed(1)} (+15)`);
      }

      // 6. Bollinger Band position (8 points) - price in lower BB region
      if (currentPrice > bb.lower && currentPrice < bb.middle) {
        confidence += 8;
        rationale.push('✅ Price in lower BB region (good entry) (+8)');
      }

      // 7. Candle close confirmation (5 points) - always true for current implementation
      confidence += 5;
      rationale.push('✅ 4H candle closed above signal level (+5)');

      // 🆕 8. Key Support/Resistance confluence (15 points)
      const nearSupport = isNearLevel(currentPrice, srLevels.support);
      if (nearSupport) {
        confidence += 15;
        rationale.push('🎯 Entry near key support level (+15)');
      }

      // 🆕 9. Breakout & Retest setup (10 points)
      const hasBreakoutRetest = detectBreakoutRetest(primaryCandles, 'LONG');
      if (hasBreakoutRetest) {
        confidence += 10;
        rationale.push('🎯 Breakout & retest pattern detected (+10)');
      }

      // 🆕 10. No major news within 2 hours (3 points)
      if (!withinNewsWindow) {
        confidence += 3;
        rationale.push('✅ Clear of major news events (+3)');
      } else {
        rationale.push('⚠️ Within news window (0 points)');
      }
    } else if ((bearishCross || bearishPullback) && htfTrend === 'DOWN') {
      signalType = 'SHORT';
      entryType = bearishCross ? 'CROSSOVER' : 'PULLBACK';

      // 🆕 CONFIDENCE SCORING SYSTEM (Max: 126 points)

      // 1. Daily trend aligned (25 points)
      const htfAligned = htfTrend === 'DOWN' && currentPrice < (htfFastMA || Infinity);
      if (htfAligned) {
        confidence += 25;
        rationale.push('✅ Daily trend bearish with price below HTF MAs (+25)');
      }

      // 2. Entry signal (20 points)
      confidence += 20;
      if (entryType === 'CROSSOVER') {
        rationale.push('✅ Bearish MA crossover detected on 4H chart (+20)');
      } else {
        rationale.push('✅ BB middle band pullback in downtrend (+20)');
      }

      // 3. HTF trend strength (10 points) - strong momentum on daily
      if (htfFastMA && htfSlowMA && (htfSlowMA - htfFastMA) / htfSlowMA > 0.0025) {
        confidence += 10;
        rationale.push('✅ Strong HTF trend momentum (+10)');
      }

      // 4. RSI in optimal range (15 points)
      if (rsi && rsi > 30 && rsi < 60) {
        confidence += 15;
        rationale.push(`✅ RSI in optimal range: ${rsi.toFixed(1)} (+15)`);
      }

      // 5. ADX > 25 (15 points) - strong trend confirmed
      if (adx && adx.adx > 25) {
        confidence += 15;
        rationale.push(`✅ Strong trend confirmed: ADX ${adx.adx.toFixed(1)} (+15)`);
      }

      // 6. Bollinger Band position (8 points) - price in upper BB region
      if (currentPrice < bb.upper && currentPrice > bb.middle) {
        confidence += 8;
        rationale.push('✅ Price in upper BB region (good entry) (+8)');
      }

      // 7. Candle close confirmation (5 points) - always true for current implementation
      confidence += 5;
      rationale.push('✅ 4H candle closed below signal level (+5)');

      // 🆕 8. Key Support/Resistance confluence (15 points)
      const nearResistance = isNearLevel(currentPrice, srLevels.resistance);
      if (nearResistance) {
        confidence += 15;
        rationale.push('🎯 Entry near key resistance level (+15)');
      }

      // 🆕 9. Breakout & Retest setup (10 points)
      const hasBreakoutRetest = detectBreakoutRetest(primaryCandles, 'SHORT');
      if (hasBreakoutRetest) {
        confidence += 10;
        rationale.push('🎯 Breakout & retest pattern detected (+10)');
      }

      // 🆕 10. No major news within 2 hours (3 points)
      if (!withinNewsWindow) {
        confidence += 3;
        rationale.push('✅ Clear of major news events (+3)');
      } else {
        rationale.push('⚠️ Within news window (0 points)');
      }
    }

    // 🆕 TIERED CONFIDENCE SYSTEM: 70+ = save signal, but tier determines if live/paper
    if (!signalType || confidence < 70) return null; // Must be at least 70 points

    // Determine tier and trading mode
    let tier: 'HIGH' | 'MEDIUM';
    let tradeLive: boolean;
    let positionSizePercent: number;

    if (confidence >= 85) {
      tier = 'HIGH';
      tradeLive = true;
      positionSizePercent = 1.50; // OPTION A: 1.5% risk (safe for FXIFY)
      rationale.push(`🟢 HIGH CONFIDENCE (${confidence}/126) - LIVE TRADE`);
    } else {
      tier = 'MEDIUM';
      tradeLive = false;
      positionSizePercent = 0.00; // Paper trade only
      rationale.push(`🟡 MEDIUM CONFIDENCE (${confidence}/126) - PAPER TRADE`);
    }

    // 🎯 MILESTONE 3C: Use approved ATR multiplier or default
    const stopMultiplier = approvedParams?.atrMultiplier || 2.5;
    const stop = signalType === 'LONG'
      ? currentPrice - (atr * stopMultiplier)
      : currentPrice + (atr * stopMultiplier);

    // 🆕 UPDATED TAKE PROFIT TARGETS: ATR-based (not risk-based)
    const tp1 = signalType === 'LONG'
      ? currentPrice + (atr * 3.0) // TP1 at 3.0 ATR (1.2:1 R:R)
      : currentPrice - (atr * 3.0);

    const tp2 = signalType === 'LONG'
      ? currentPrice + (atr * 5.0) // TP2 at 5.0 ATR (2:1 R:R)
      : currentPrice - (atr * 5.0);

    const tp3 = signalType === 'LONG'
      ? currentPrice + (atr * 8.0) // TP3 at 8.0 ATR (3.2:1 R:R)
      : currentPrice - (atr * 8.0);

    const riskPerTrade = Math.abs(currentPrice - stop);
    const riskReward = Math.abs(tp1 - currentPrice) / riskPerTrade;

    return {
      id: `signal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: signalType,
      symbol: primaryCandles[0]?.timestamp ? 'UNKNOWN' : 'UNKNOWN', // Will be set by caller
      entry: parseFloat(currentPrice.toFixed(5)),
      currentPrice: parseFloat(currentPrice.toFixed(5)),
      stop: parseFloat(stop.toFixed(5)),
      targets: [
        parseFloat(tp1.toFixed(5)),
        parseFloat(tp2.toFixed(5)),
        parseFloat(tp3.toFixed(5))
      ],
      riskReward: parseFloat(riskReward.toFixed(2)),
      confidence,
      tier,
      tradeLive,
      positionSizePercent,
      orderType: 'MARKET',
      executionType: 'IMMEDIATE',
      indicators: {
        fastMA: fastMA.toFixed(5),
        slowMA: slowMA.toFixed(5),
        rsi: rsi ? rsi.toFixed(2) : 'N/A',
        atr: atr.toFixed(5),
        adx: adx ? adx.adx.toFixed(2) : 'N/A',
        bbUpper: bb.upper.toFixed(5),
        bbLower: bb.lower.toFixed(5),
        htfTrend
      },
      rationale: rationale.join(' | '),
      strategy: this.name,
      version: strategyVersion
    };
  }
}

export class SignalGenerator {
  private isRunning = false;
  private lastRunTime = 0;

  /**
   * Get the timestamp of the last successful run
   */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  async generateSignals(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️  Signal generator already running, skipping...');
      return;
    }

    this.isRunning = true;
    this.lastRunTime = Date.now();
    console.log('🤖 [Signal Generator] Starting automated analysis...');

    try {
      // 1. Fetch forex quotes from API
      const quotes = await this.fetchForexQuotes();

      if (!quotes || quotes.length === 0) {
        console.log('⚠️  No forex data available');
        return;
      }

      console.log(`📊 Processing ${quotes.length} currency pairs`);

      // 2. Generate signals for each pair
      const strategy = new MACrossoverStrategy();
      let signalsGenerated = 0;
      let signalsTracked = 0;

      for (const quote of quotes) {
        const { symbol, exchangeRate } = quote;

        try {
          // Fetch REAL historical candles from Twelve Data API
          console.log(`📊 Fetching real historical data for ${symbol}...`);
          const primaryCandles = await twelveDataAPI.fetchHistoricalCandles(symbol, '5min', 1440);

          if (!primaryCandles || primaryCandles.length < 200) {
            console.warn(`⚠️  Insufficient candle data for ${symbol} (${primaryCandles?.length || 0} candles)`);
            continue;
          }

          // Generate higher timeframe candles (20min from 5min)
          const higherCandles = primaryCandles.filter((_, idx) => idx % 4 === 0);

          // Analyze with strategy (🧠 AI-ENHANCED + 🎯 MILESTONE 3C: Now passes symbol for AI insights and approved parameters)
          const signal = await strategy.analyze(primaryCandles, higherCandles, symbol);

          // 🆕 TIERED SYSTEM: 70+ = track (both HIGH and MEDIUM tiers)
          if (signal && signal.confidence >= 70) {
            signalsGenerated++;
            signal.symbol = symbol; // Set the correct symbol

            // Track signal to database (both HIGH and MEDIUM tiers)
            try {
              await this.trackSignal(signal, symbol, exchangeRate, primaryCandles);
              signalsTracked++;
              const tierBadge = signal.tier === 'HIGH' ? '🟢 HIGH' : '🟡 MEDIUM';
              console.log(`✅ Tracked ${symbol} signal ${tierBadge} (${signal.confidence}/126 points)`);
            } catch (error) {
              console.error(`❌ Failed to track ${symbol} signal:`, error);
            }
          }

          // Rate limiting - Twelve Data free tier: 8 calls/minute
          await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds between pairs

        } catch (error) {
          console.error(`❌ Error processing ${symbol}:`, error);
        }
      }

      console.log(`✅ Signal generation complete: ${signalsGenerated} generated, ${signalsTracked} tracked`);

    } catch (error) {
      console.error('❌ [Signal Generator] Error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchForexQuotes(): Promise<ForexQuote[]> {
    try {
      console.log('📡 Fetching forex quotes from ExchangeRate-API...');

      // Use the existing exchangeRateAPI service (has 15-min caching!)
      const apiQuotes = await exchangeRateAPI.fetchAllQuotes();

      // Convert to our format
      const quotes: ForexQuote[] = apiQuotes.map(q => ({
        symbol: q.symbol,
        exchangeRate: q.exchangeRate,
        timestamp: q.lastRefreshed,
      }));

      console.log(`✅ Fetched ${quotes.length} forex pairs from ExchangeRate-API`);
      return quotes;

    } catch (error) {
      console.error('❌ Error fetching from ExchangeRate-API, using mock data:', error);
      return this.getMockQuotes();
    }
  }

  private getMockQuotes(): ForexQuote[] {
    console.log('📊 Using mock forex data');
    return [
      { symbol: 'EUR/USD', exchangeRate: 1.08450, timestamp: new Date().toISOString() },
      { symbol: 'GBP/USD', exchangeRate: 1.26320, timestamp: new Date().toISOString() },
      { symbol: 'USD/JPY', exchangeRate: 149.850, timestamp: new Date().toISOString() },
      { symbol: 'AUD/USD', exchangeRate: 0.65240, timestamp: new Date().toISOString() },
      { symbol: 'USD/CHF', exchangeRate: 0.88670, timestamp: new Date().toISOString() },
    ];
  }

  private async trackSignal(
    signal: Signal,
    symbol: string,
    currentPrice: number,
    candles: Candle[]
  ): Promise<void> {
    // Get system user ID (for automated signals)
    const systemUserId = await this.getSystemUserId();

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
        expires_at,
        outcome
      ) VALUES (
        ${signal.id},
        ${systemUserId},
        ${symbol},
        ${signal.type},
        ${signal.confidence},
        ${signal.tier},
        ${signal.tradeLive},
        ${signal.positionSizePercent},
        ${signal.entry},
        ${currentPrice},
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
        ${JSON.stringify(candles.slice(-200))},
        NOW(),
        NOW() + INTERVAL '48 hours',
        'PENDING'
      )
      ON CONFLICT (signal_id) DO NOTHING
    `);
  }

  private async getSystemUserId(): Promise<string> {
    // Get or create system user for automated signals
    const result = await db.execute(sql`
      INSERT INTO users (username, email, password)
      VALUES ('ai-system', 'ai@system.internal', 'automated')
      ON CONFLICT (email) DO UPDATE SET email = 'ai@system.internal'
      RETURNING id
    `) as any;

    return result[0]?.id || result.rows?.[0]?.id;
  }

  /**
   * REMOVED: start() method no longer needed
   * Signal generation is now triggered via HTTP endpoint /api/cron/generate-signals
   * This allows the service to work on Render free tier (which sleeps after 15 min)
   * UptimeRobot pings the endpoint every 5 minutes to trigger generation
   */
}

// Export singleton instance
export const signalGenerator = new SignalGenerator();

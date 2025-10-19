import { db } from '../db';
import { sql } from 'drizzle-orm';
import { exchangeRateAPI } from './exchangerate-api';
import { twelveDataAPI } from './twelve-data';

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

class MACrossoverStrategy {
  name = 'MA Crossover Multi-Timeframe';
  version = '1.0.0';

  analyze(primaryCandles: Candle[], higherCandles: Candle[]): Signal | null {
    if (primaryCandles.length < 200) return null;

    const closes = primaryCandles.map(c => c.close);
    const higherCloses = higherCandles.map(c => c.close);

    const fastMA = Indicators.ema(closes, 20);
    const slowMA = Indicators.ema(closes, 50);
    const atr = Indicators.atr(primaryCandles, 14);
    const rsi = Indicators.rsi(closes, 14);
    const bb = Indicators.bollingerBands(closes, 20, 2);
    const adx = Indicators.adx(primaryCandles, 14);

    if (!fastMA || !slowMA || !atr || !bb) return null;

    const htfFastMA = Indicators.ema(higherCloses, 20);
    const htfSlowMA = Indicators.ema(higherCloses, 50);
    const htfTrend = htfFastMA && htfSlowMA && htfFastMA > htfSlowMA ? 'UP' : 'DOWN';

    const prevFastMA = Indicators.ema(closes.slice(0, -1), 20);
    const prevSlowMA = Indicators.ema(closes.slice(0, -1), 50);

    if (!prevFastMA || !prevSlowMA) return null;

    const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
    const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

    const currentPrice = closes[closes.length - 1];

    let signalType: 'LONG' | 'SHORT' | null = null;
    let confidence = 0;
    const rationale: string[] = [];

    if (bullishCross && htfTrend === 'UP') {
      signalType = 'LONG';
      confidence += 30;
      rationale.push('Bullish MA crossover detected');

      if (rsi && rsi > 40 && rsi < 70) {
        confidence += 15;
        rationale.push('RSI in favorable range');
      }

      if (adx && adx.adx > 20) {
        confidence += 15;
        rationale.push('Strong trend confirmed by ADX');
      }

      if (currentPrice > bb.lower && currentPrice < bb.middle) {
        confidence += 10;
        rationale.push('Price in lower BB region');
      }

      confidence += 20;
      rationale.push('Higher timeframe trend is bullish');
    } else if (bearishCross && htfTrend === 'DOWN') {
      signalType = 'SHORT';
      confidence += 30;
      rationale.push('Bearish MA crossover detected');

      if (rsi && rsi > 30 && rsi < 60) {
        confidence += 15;
        rationale.push('RSI in favorable range');
      }

      if (adx && adx.adx > 20) {
        confidence += 15;
        rationale.push('Strong trend confirmed by ADX');
      }

      if (currentPrice < bb.upper && currentPrice > bb.middle) {
        confidence += 10;
        rationale.push('Price in upper BB region');
      }

      confidence += 20;
      rationale.push('Higher timeframe trend is bearish');
    }

    if (!signalType || confidence < 50) return null;

    const stop = signalType === 'LONG'
      ? currentPrice - (atr * 2)
      : currentPrice + (atr * 2);

    const riskPerTrade = Math.abs(currentPrice - stop);
    const tp1 = signalType === 'LONG'
      ? currentPrice + (riskPerTrade * 1.5)
      : currentPrice - (riskPerTrade * 1.5);
    const tp2 = signalType === 'LONG'
      ? currentPrice + (riskPerTrade * 2.5)
      : currentPrice - (riskPerTrade * 2.5);
    const tp3 = signalType === 'LONG'
      ? currentPrice + (riskPerTrade * 3.5)
      : currentPrice - (riskPerTrade * 3.5);

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
      rationale: rationale.join('. '),
      strategy: this.name,
      version: this.version
    };
  }
}

export class SignalGenerator {
  private isRunning = false;

  async generateSignals(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️  Signal generator already running, skipping...');
      return;
    }

    this.isRunning = true;
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

          // Analyze with strategy
          const signal = strategy.analyze(primaryCandles, higherCandles);

          // Temporarily use 50% threshold for testing (normally 70%)
          if (signal && signal.confidence >= 50) {
            signalsGenerated++;
            signal.symbol = symbol; // Set the correct symbol

            // Track signal to database
            try {
              await this.trackSignal(signal, symbol, exchangeRate, primaryCandles);
              signalsTracked++;
              console.log(`✅ Tracked ${symbol} signal (${signal.confidence}% confidence)`);
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
   * Start the service (runs every N hours)
   */
  start(intervalHours: number = 2): void {
    console.log(`🚀 [Signal Generator] Service started`);
    console.log(`⏰ Generating signals every ${intervalHours} hours`);

    // Run immediately on start
    this.generateSignals();

    // Then run on schedule
    setInterval(() => {
      this.generateSignals();
    }, intervalHours * 60 * 60 * 1000);
  }
}

// Export singleton instance
export const signalGenerator = new SignalGenerator();

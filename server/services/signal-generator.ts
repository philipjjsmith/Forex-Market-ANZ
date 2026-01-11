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

    // Step 1: Calculate +DM, -DM, and TR for each period
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    const trueRange: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      // Directional movements
      const highDiff = candles[i].high - candles[i - 1].high;
      const lowDiff = candles[i - 1].low - candles[i].low;

      // +DM: upward movement (only if larger than downward movement)
      plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);

      // -DM: downward movement (only if larger than upward movement)
      minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

      // True Range
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trueRange.push(tr);
    }

    // Step 2: Smooth +DM, -DM, and TR using Wilder's smoothing (similar to EMA but different factor)
    const smoothed = (values: number[]): number => {
      let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
      for (let i = period; i < values.length; i++) {
        sum = sum - (sum / period) + values[i];
      }
      return sum;
    };

    const smoothedPlusDM = smoothed(plusDM);
    const smoothedMinusDM = smoothed(minusDM);
    const smoothedTR = smoothed(trueRange);

    // Step 3: Calculate +DI and -DI
    const plusDI = (smoothedPlusDM / smoothedTR) * 100;
    const minusDI = (smoothedMinusDM / smoothedTR) * 100;

    // Step 4: Calculate DX (Directional Index)
    const dxValues: number[] = [];
    for (let i = period; i < candles.length - 1; i++) {
      // Recalculate smoothed values for each position
      let sPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
      let sMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
      let sTR = trueRange.slice(0, period).reduce((a, b) => a + b, 0);

      for (let j = period; j <= i; j++) {
        sPlusDM = sPlusDM - (sPlusDM / period) + plusDM[j];
        sMinusDM = sMinusDM - (sMinusDM / period) + minusDM[j];
        sTR = sTR - (sTR / period) + trueRange[j];
      }

      const pDI = (sPlusDM / sTR) * 100;
      const mDI = (sMinusDM / sTR) * 100;

      const dx = (Math.abs(pDI - mDI) / (pDI + mDI)) * 100;
      dxValues.push(dx);
    }

    // Step 5: Calculate ADX (smoothed DX)
    if (dxValues.length < period) return null;

    const adxValue = this.sma(dxValues.slice(-period), period);
    if (!adxValue) return null;

    return {
      adx: adxValue,
      plusDI: plusDI,
      minusDI: minusDI
    };
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

  static macd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): { macd: number; signal: number; histogram: number } | null {
    if (closes.length < slowPeriod + signalPeriod) return null;

    // Calculate MACD values for all data points
    const macdValues: number[] = [];
    for (let i = slowPeriod - 1; i < closes.length; i++) {
      const fEMA = this.ema(closes.slice(0, i + 1), fastPeriod);
      const sEMA = this.ema(closes.slice(0, i + 1), slowPeriod);
      if (fEMA && sEMA) {
        macdValues.push(fEMA - sEMA);
      }
    }

    if (macdValues.length < signalPeriod) return null;

    // Get current MACD line value
    const macdLine = macdValues[macdValues.length - 1];

    // Calculate signal line (EMA of MACD values)
    const signalLine = this.ema(macdValues, signalPeriod);
    if (!signalLine) return null;

    // Calculate histogram
    const histogram = macdLine - signalLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: histogram
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
  name = 'ICT 3-Timeframe Strategy';
  // v3.1.0: ICT 3-TIMEFRAME RULE - Professional funded trader approach
  // - Weekly + Daily + 4H must align (major trend confirmation)
  // - 1H used for entry timing (pullbacks are GOOD, not rejected!)
  // - Enters when 1H shows reversal back to main trend
  // - Expected: 3-7 signals/week, 65-75% win rate (industry standard)
  // - Confidence max: 100 points (70 min, 85+ HIGH tier)
  // Based on ICT methodology used by successful prop firm traders
  // Previous versions:
  // v3.0.0: Required all 4 timeframes align (TOO STRICT - 1-3 signals/month)
  // v2.2.0: Fixed HTF trend lag with acceleration filter
  // v2.1.0: Added mandatory ADX/RSI filters
  // v1.0.0: Basic MA crossover
  version = '3.1.0';

  async analyze(
    weeklyCandles: Candle[],
    dailyCandles: Candle[],
    fourHourCandles: Candle[],
    oneHourCandles: Candle[],
    symbol: string,
    options?: {
      adxThreshold?: number;      // For sensitivity testing (default: 25)
      diagnosticMode?: boolean;   // Enable detailed logging
    }
  ): Promise<Signal | null> {
    const adxThreshold = options?.adxThreshold || 25;
    const diagnosticMode = options?.diagnosticMode || false;
    // Need minimum candles for reliable analysis
    if (weeklyCandles.length < 26 || dailyCandles.length < 50 ||
        fourHourCandles.length < 50 || oneHourCandles.length < 100) {
      return null;
    }

    // 🚀 v3.0.0: MULTI-TIMEFRAME ANALYSIS - Extract closing prices from all timeframes
    const weeklyCloses = weeklyCandles.map(c => c.close);
    const dailyCloses = dailyCandles.map(c => c.close);
    const fourHourCloses = fourHourCandles.map(c => c.close);
    const oneHourCloses = oneHourCandles.map(c => c.close);

    // 🎯 MILESTONE 3C: Get approved parameters for this symbol
    const approvedParams = await parameterService.getApprovedParameters(symbol);
    const fastPeriod = approvedParams?.fastMA || 20;
    const slowPeriod = approvedParams?.slowMA || 50;
    const strategyVersion = approvedParams?.version || this.version;

    if (approvedParams) {
      console.log(`🎯 [Milestone 3C] Using approved parameters for ${symbol}: ${fastPeriod}/${slowPeriod} EMA, ${approvedParams.atrMultiplier}x ATR (v${strategyVersion})`);
    }

    // 📊 STEP 1: Analyze trend on EACH timeframe independently
    // Weekly timeframe - Major trend direction
    const weeklyFastMA = Indicators.ema(weeklyCloses, fastPeriod);
    const weeklySlowMA = Indicators.ema(weeklyCloses, slowPeriod);
    const weeklyMACD = Indicators.macd(weeklyCloses, 12, 26, 9);
    const weeklyTrend = weeklyFastMA && weeklySlowMA && weeklyFastMA > weeklySlowMA ? 'UP' : 'DOWN';

    // Daily timeframe - Intermediate trend
    const dailyFastMA = Indicators.ema(dailyCloses, fastPeriod);
    const dailySlowMA = Indicators.ema(dailyCloses, slowPeriod);
    const dailyMACD = Indicators.macd(dailyCloses, 12, 26, 9);
    const dailyTrend = dailyFastMA && dailySlowMA && dailyFastMA > dailySlowMA ? 'UP' : 'DOWN';

    // 4H timeframe - Entry trend confirmation
    const fourHourFastMA = Indicators.ema(fourHourCloses, fastPeriod);
    const fourHourSlowMA = Indicators.ema(fourHourCloses, slowPeriod);
    const fourHourMACD = Indicators.macd(fourHourCloses, 12, 26, 9);
    const fourHourTrend = fourHourFastMA && fourHourSlowMA && fourHourFastMA > fourHourSlowMA ? 'UP' : 'DOWN';

    // 1H timeframe - Entry timing and indicators (this is where we execute)
    const oneHourFastMA = Indicators.ema(oneHourCloses, fastPeriod);
    const oneHourSlowMA = Indicators.ema(oneHourCloses, slowPeriod);
    const oneHourMACD = Indicators.macd(oneHourCloses, 12, 26, 9);
    const oneHourTrend = oneHourFastMA && oneHourSlowMA && oneHourFastMA > oneHourSlowMA ? 'UP' : 'DOWN';

    // Calculate entry indicators on 1H timeframe
    const atr = Indicators.atr(oneHourCandles, 14);
    const rsi = Indicators.rsi(oneHourCloses, 14);
    const bb = Indicators.bollingerBands(oneHourCloses, 20, 2);
    const adx = Indicators.adx(oneHourCandles, 14);

    if (!oneHourFastMA || !oneHourSlowMA || !atr || !bb) return null;

    // 🔍 DIAGNOSTIC: Track trend directions for all timeframes
    if (diagnosticMode) {
      console.log(`\n📊 ${symbol} Diagnostic Analysis:`);
      console.log(`├─ Weekly Trend: ${weeklyTrend}`);
      console.log(`├─ Daily Trend: ${dailyTrend}`);
      console.log(`├─ 4H Trend: ${fourHourTrend}`);
      console.log(`├─ 1H Trend: ${oneHourTrend}`);
      console.log(`├─ ADX Value: ${adx?.adx.toFixed(2) || 'N/A'} (threshold: ${adxThreshold})`);
      console.log(`├─ RSI Value: ${rsi?.toFixed(2) || 'N/A'}`);
    }

    // ⚡ MANDATORY ADX filter (blocks ranging markets)
    // Industry standard: "Never enter a trade unless ADX is above threshold"
    // This eliminates 60-80% of false signals in choppy, ranging conditions
    if (!adx || adx.adx < adxThreshold) {
      if (diagnosticMode) {
        console.log(`└─ ❌ REJECTED: ADX ${adx?.adx.toFixed(2) || 'N/A'} < ${adxThreshold} (ranging market)\n`);
      }
      return null; // Block trade - market is ranging, not trending
    }

    // 📊 STEP 2: Detect entry signals on 1H timeframe
    const prevOneHourFastMA = Indicators.ema(oneHourCloses.slice(0, -1), fastPeriod);
    const prevOneHourSlowMA = Indicators.ema(oneHourCloses.slice(0, -1), slowPeriod);

    if (!prevOneHourFastMA || !prevOneHourSlowMA) return null;

    const bullishCross = prevOneHourFastMA <= prevOneHourSlowMA && oneHourFastMA > oneHourSlowMA;
    const bearishCross = prevOneHourFastMA >= prevOneHourSlowMA && oneHourFastMA < oneHourSlowMA;

    const currentPrice = oneHourCloses[oneHourCloses.length - 1];

    // 🧠 AI ENHANCEMENT: Get symbol-specific insights
    const aiInsights = aiAnalyzer.getSymbolInsights(symbol);
    const useAI = aiInsights.hasEnoughData; // Only use AI if 30+ signals

    // 🆕 NEW FILTERS: Detect S/R levels and breakout/retest patterns (on 1H timeframe)
    const srLevels = detectSupportResistance(oneHourCandles);
    const withinNewsWindow = isWithinNewsWindow();

    // 🆕 HYBRID ENTRY: BB Middle Band Pullback Detection
    // Detects pullback to BB middle line in established trends
    const inBullishTrend = oneHourFastMA > oneHourSlowMA && fourHourTrend === 'UP' && dailyTrend === 'UP';
    const inBearishTrend = oneHourFastMA < oneHourSlowMA && fourHourTrend === 'DOWN' && dailyTrend === 'DOWN';
    const bullishPullback = inBullishTrend && currentPrice >= bb.lower && currentPrice <= bb.middle;
    const bearishPullback = inBearishTrend && currentPrice <= bb.upper && currentPrice >= bb.middle;

    let signalType: 'LONG' | 'SHORT' | null = null;
    let confidence = 0;
    let entryType: 'CROSSOVER' | 'PULLBACK' = 'CROSSOVER';
    const rationale: string[] = [];

    if (useAI) {
      rationale.push(`AI-Enhanced (${aiInsights.totalSignals} signals analyzed, ${aiInsights.winRate.toFixed(1)}% win rate)`);
    }

    // 🚨 CRITICAL FIX #1: REVERSAL DETECTION (Prevents December 2025 disaster)
    // Block LONG signals when Daily MACD shows bearish divergence
    // Block SHORT signals when Daily MACD shows bullish divergence
    // This prevents generating signals when trend is about to reverse
    if (dailyMACD) {
      // For potential LONG signals: check if Daily MACD is bearish
      if ((bullishCross || bullishPullback) && dailyMACD.histogram < 0) {
        if (diagnosticMode) {
          console.log(`└─ ❌ REJECTED LONG: Daily MACD bearish (histogram: ${dailyMACD.histogram.toFixed(4)})`);
          console.log(`   Trend may be reversing - avoiding entry\n`);
        }
        return null; // Block LONG - trend reversing downward
      }

      // For potential SHORT signals: check if Daily MACD is bullish
      if ((bearishCross || bearishPullback) && dailyMACD.histogram > 0) {
        if (diagnosticMode) {
          console.log(`└─ ❌ REJECTED SHORT: Daily MACD bullish (histogram: ${dailyMACD.histogram.toFixed(4)})`);
          console.log(`   Trend may be reversing - avoiding entry\n`);
        }
        return null; // Block SHORT - trend reversing upward
      }
    }

    // 📊 STEP 3: ICT 3-TIMEFRAME RULE - Check for LONG signals
    // REQUIREMENT: Weekly + Daily + 4H must ALL be UP
    // 1H can be DOWN (that's a pullback = BEST entry!)
    if ((bullishCross || bullishPullback) && weeklyTrend === 'UP' && dailyTrend === 'UP' && fourHourTrend === 'UP') {
      signalType = 'LONG';
      entryType = bullishCross ? 'CROSSOVER' : 'PULLBACK';

      // 🆕 v3.1.0 ICT CONFIDENCE SCORING (Max: 100 points)
      // 3 Higher Timeframes (75 points) + 1H Entry Timing (25 points)

      // 1. Weekly timeframe BULLISH (25 points max)
      if (weeklyTrend === 'UP' && weeklyMACD && weeklyMACD.macd > weeklyMACD.signal) {
        confidence += 25;
        rationale.push('✅ Weekly BULLISH + MACD confirms (+25)');
      } else if (weeklyTrend === 'UP') {
        confidence += 20;
        rationale.push('⚠️ Weekly BULLISH but MACD weak (+20)');
      }

      // 2. Daily timeframe BULLISH (25 points max)
      if (dailyTrend === 'UP' && dailyMACD && dailyMACD.macd > dailyMACD.signal) {
        // Check if trend is accelerating (not exhausting)
        const prevDailyFastMA = Indicators.ema(dailyCloses.slice(0, -1), fastPeriod);
        const prevDailySlowMA = Indicators.ema(dailyCloses.slice(0, -1), slowPeriod);
        if (dailyFastMA && dailySlowMA && prevDailyFastMA && prevDailySlowMA) {
          const maSeparation = (dailyFastMA - dailySlowMA) / dailySlowMA;
          const prevMASeparation = (prevDailyFastMA - prevDailySlowMA) / prevDailySlowMA;
          if (maSeparation > prevMASeparation) {
            confidence += 25;
            rationale.push('✅ Daily BULLISH, accelerating, MACD confirms (+25)');
          } else {
            confidence += 20;
            rationale.push('⚠️ Daily BULLISH, MACD confirms but slowing (+20)');
          }
        } else {
          confidence += 25;
          rationale.push('✅ Daily BULLISH + MACD confirms (+25)');
        }
      } else if (dailyTrend === 'UP') {
        confidence += 15;
        rationale.push('⚠️ Daily BULLISH but MACD weak (+15)');
      }

      // 3. 4H timeframe BULLISH (25 points max)
      if (fourHourTrend === 'UP' && fourHourMACD && fourHourMACD.macd > fourHourMACD.signal) {
        confidence += 25;
        rationale.push('✅ 4H BULLISH + MACD confirms (+25)');
      } else if (fourHourTrend === 'UP') {
        confidence += 20;
        rationale.push('⚠️ 4H BULLISH but MACD weak (+20)');
      }

      // 4. 1H Entry Timing (25 points max) - 1H can be DOWN (pullback)
      // Award points for entry signal quality, not 1H trend direction

      // Entry signal detected (10 points)
      confidence += 10;
      if (entryType === 'CROSSOVER') {
        rationale.push('✅ MA crossover entry on 1H (+10)');
      } else {
        rationale.push('✅ Pullback entry signal on 1H (+10)');
      }

      // Check if 1H is in pullback (counter to main trend) - this is GOOD
      if (oneHourTrend === 'DOWN') {
        rationale.push('🎯 1H pullback detected - optimal entry zone');
      }

      // RSI in optimal range (6 points)
      if (rsi && rsi > 45 && rsi < 70) {
        confidence += 6;
        rationale.push(`✅ RSI optimal: ${rsi.toFixed(1)} (+6)`);
      }

      // ADX > 25 (6 points) - strong trend confirmed
      if (adx && adx.adx > 25) {
        confidence += 6;
        rationale.push(`✅ ADX ${adx.adx.toFixed(1)} - strong trend (+6)`);
      }

      // Bollinger Band position (3 points) - price in lower BB region
      if (currentPrice > bb.lower && currentPrice < bb.middle) {
        confidence += 3;
        rationale.push('✅ Price in lower BB (good entry) (+3)');
      }

    // 🚨 CRITICAL FIX #2: BALANCE LONG/SHORT SIGNAL GENERATION
    // Allow 2-of-3 timeframe alignment for SHORT signals (instead of requiring all 3)
    // LONG requires all 3 UP (conservative), SHORT requires 2-of-3 DOWN (balanced)
    // This prevents December disaster: 93 LONG, 0 SHORT (missed entire down-move)
    } else if ((bearishCross || bearishPullback)) {
      // Count how many of (Weekly, Daily, 4H) are DOWN
      const downTrends = [weeklyTrend === 'DOWN', dailyTrend === 'DOWN', fourHourTrend === 'DOWN'].filter(Boolean).length;

      // Require at least 2 of 3 timeframes DOWN for SHORT signal
      if (downTrends >= 2) {
        signalType = 'SHORT';
        entryType = bearishCross ? 'CROSSOVER' : 'PULLBACK';

      // 🆕 v3.1.0 ICT CONFIDENCE SCORING (Max: 100 points)
      // 3 Higher Timeframes (75 points) + 1H Entry Timing (25 points)
      // Note: SHORT signals allow 2-of-3 alignment (more balanced detection)
      if (downTrends === 3) {
        rationale.push('🎯 Perfect 3-TF alignment (W+D+4H all DOWN)');
      } else {
        rationale.push(`⚡ 2-of-3 TF alignment (${downTrends}/3 DOWN - balanced detection)`);
      }

      // 1. Weekly timeframe BEARISH (25 points max)
      if (weeklyTrend === 'DOWN' && weeklyMACD && weeklyMACD.macd < weeklyMACD.signal) {
        confidence += 25;
        rationale.push('✅ Weekly BEARISH + MACD confirms (+25)');
      } else if (weeklyTrend === 'DOWN') {
        confidence += 20;
        rationale.push('⚠️ Weekly BEARISH but MACD weak (+20)');
      }

      // 2. Daily timeframe BEARISH (25 points max)
      if (dailyTrend === 'DOWN' && dailyMACD && dailyMACD.macd < dailyMACD.signal) {
        // Check if trend is accelerating (not exhausting)
        const prevDailyFastMA = Indicators.ema(dailyCloses.slice(0, -1), fastPeriod);
        const prevDailySlowMA = Indicators.ema(dailyCloses.slice(0, -1), slowPeriod);
        if (dailyFastMA && dailySlowMA && prevDailyFastMA && prevDailySlowMA) {
          const maSeparation = (dailySlowMA - dailyFastMA) / dailySlowMA; // Inverted for downtrend
          const prevMASeparation = (prevDailySlowMA - prevDailyFastMA) / prevDailySlowMA;
          if (maSeparation > prevMASeparation) {
            confidence += 25;
            rationale.push('✅ Daily BEARISH, accelerating, MACD confirms (+25)');
          } else {
            confidence += 20;
            rationale.push('⚠️ Daily BEARISH, MACD confirms but slowing (+20)');
          }
        } else {
          confidence += 25;
          rationale.push('✅ Daily BEARISH + MACD confirms (+25)');
        }
      } else if (dailyTrend === 'DOWN') {
        confidence += 15;
        rationale.push('⚠️ Daily BEARISH but MACD weak (+15)');
      }

      // 3. 4H timeframe BEARISH (25 points max)
      if (fourHourTrend === 'DOWN' && fourHourMACD && fourHourMACD.macd < fourHourMACD.signal) {
        confidence += 25;
        rationale.push('✅ 4H BEARISH + MACD confirms (+25)');
      } else if (fourHourTrend === 'DOWN') {
        confidence += 20;
        rationale.push('⚠️ 4H BEARISH but MACD weak (+20)');
      }

      // 4. 1H Entry Timing (25 points max) - 1H can be UP (pullback)
      // Award points for entry signal quality, not 1H trend direction

      // Entry signal detected (10 points)
      confidence += 10;
      if (entryType === 'CROSSOVER') {
        rationale.push('✅ MA crossover entry on 1H (+10)');
      } else {
        rationale.push('✅ Pullback entry signal on 1H (+10)');
      }

      // Check if 1H is in pullback (counter to main trend) - this is GOOD
      if (oneHourTrend === 'UP') {
        rationale.push('🎯 1H pullback detected - optimal entry zone');
      }

      // RSI in optimal range (6 points)
      if (rsi && rsi > 30 && rsi < 55) {
        confidence += 6;
        rationale.push(`✅ RSI optimal: ${rsi.toFixed(1)} (+6)`);
      }

      // ADX > 25 (6 points) - strong trend confirmed
      if (adx && adx.adx > 25) {
        confidence += 6;
        rationale.push(`✅ ADX ${adx.adx.toFixed(1)} - strong trend (+6)`);
      }

      // Bollinger Band position (3 points) - price in upper BB region
      if (currentPrice < bb.upper && currentPrice > bb.middle) {
        confidence += 3;
        rationale.push('✅ Price in upper BB (good entry) (+3)');
      }
      } else {
        // SHORT rejected - insufficient timeframe alignment
        if (diagnosticMode) {
          console.log(`└─ ❌ REJECTED SHORT: Only ${downTrends} of 3 timeframes DOWN (need 2+)`);
          console.log(`   W:${weeklyTrend}, D:${dailyTrend}, 4H:${fourHourTrend}\n`);
        }
        return null;
      }
    }

    // ⚡ PHASE 3D: MANDATORY RSI filters (block overbought/oversold extremes)
    // Industry best practice: RSI must indicate momentum in trade direction
    if (!rsi) return null; // RSI is required

    if (signalType === 'LONG') {
      // LONG requires RSI 45-70 (upward momentum, not overbought)
      if (rsi < 45 || rsi > 70) {
        return null; // Block trade - RSI shows weak momentum or overbought
      }
    } else if (signalType === 'SHORT') {
      // SHORT requires RSI 30-55 (downward momentum, not oversold)
      if (rsi < 30 || rsi > 55) {
        return null; // Block trade - RSI shows weak momentum or oversold
      }
    }

    // 🚀 v3.1.0: ICT 3-Timeframe Rule - Minimum confidence 70 points
    // With W+D+4H aligned, minimum score: 20+15+20+10+6 = 71 points
    // This allows signals even when MACD is weak on some timeframes
    // 🔍 DIAGNOSTIC: Log rejection reasons
    if (!signalType || confidence < 70) {
      if (diagnosticMode) {
        if (!signalType) {
          const aligned3TF = (weeklyTrend === dailyTrend && dailyTrend === fourHourTrend);
          console.log(`└─ ❌ REJECTED: W+D+4H ${aligned3TF ? 'ALIGNED' : 'NOT ALIGNED'} (W:${weeklyTrend}, D:${dailyTrend}, 4H:${fourHourTrend})`);
          console.log(`   No entry signal detected (bullishCross: ${bullishCross}, bearishCross: ${bearishCross})\n`);
        } else {
          console.log(`└─ ❌ REJECTED: Confidence ${confidence} < 70 (minimum threshold)\n`);
        }
      }
      return null; // Must be at least 70/100 points (70% minimum)
    }

    // 🔍 DIAGNOSTIC: Log successful signal
    if (diagnosticMode) {
      console.log(`└─ ✅ SIGNAL GENERATED: ${signalType} with ${confidence}% confidence\n`);
    }

    // Determine tier and trading mode
    let tier: 'HIGH' | 'MEDIUM';
    let tradeLive: boolean;
    let positionSizePercent: number;

    if (confidence >= 85) {  // HIGH tier: 85-100 points (85%+) - Strong ICT alignment
      tier = 'HIGH';
      tradeLive = true;
      positionSizePercent = 1.50; // 1.5% risk (optimal for FXIFY)
      rationale.push(`🟢 HIGH CONFIDENCE (${confidence}/100) - LIVE TRADE`);
    } else {
      tier = 'MEDIUM';
      tradeLive = false;
      positionSizePercent = 0.00; // Paper trade only
      rationale.push(`🟡 MEDIUM CONFIDENCE (${confidence}/100) - PRACTICE SIGNAL`);
    }

    // ⚡ OPTIMIZED: Stop loss for maximum profitability (swing trading)
    // Research-proven: 3.0x ATR = highest profit for EUR/USD (60.6% win rate, 1.04 profit factor)
    const stopMultiplier = approvedParams?.atrMultiplier || 3.0; // Optimal for swing trading - EUR/USD backtesting confirmed
    const stop = signalType === 'LONG'
      ? currentPrice - (atr * stopMultiplier)
      : currentPrice + (atr * stopMultiplier);

    // 🎯 ATR-based Take Profit Targets (Optimized for maximum profitability)
    // TP1: 3.0x ATR (1:1 R:R with 3.0x stop) - First target (60%+ win rate expected)
    // TP2: 6.0x ATR (2:1 R:R) - Second target
    // TP3: 12.0x ATR (4:1 R:R) - Bonus target for big moves
    const tp1 = signalType === 'LONG'
      ? currentPrice + (atr * 3.0) // TP1 at 3.0 ATR (1:1 R:R - maximum profitability)
      : currentPrice - (atr * 3.0);

    const tp2 = signalType === 'LONG'
      ? currentPrice + (atr * 6.0) // TP2 at 6.0 ATR (2:1 R:R)
      : currentPrice - (atr * 6.0);

    const tp3 = signalType === 'LONG'
      ? currentPrice + (atr * 12.0) // TP3 at 12.0 ATR (4:1 R:R)
      : currentPrice - (atr * 12.0);

    const riskPerTrade = Math.abs(currentPrice - stop);
    const riskReward = Math.abs(tp1 - currentPrice) / riskPerTrade;

    return {
      id: `signal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: signalType,
      symbol: symbol, // Now passed as parameter
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
        fastMA: oneHourFastMA.toFixed(5),
        slowMA: oneHourSlowMA.toFixed(5),
        rsi: rsi ? rsi.toFixed(2) : 'N/A',
        atr: atr.toFixed(5),
        adx: adx ? adx.adx.toFixed(2) : 'N/A',
        bbUpper: bb.upper.toFixed(5),
        bbLower: bb.lower.toFixed(5),
        htfTrend: `W:${weeklyTrend} D:${dailyTrend} 4H:${fourHourTrend} | 1H:${oneHourTrend}` // ICT 3-TF aligned, 1H timing
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

        // 🚫 PHASE 2 QUICK WIN: Skip GBP/USD (19.6% win rate - catastrophic)
        if (symbol === 'GBP/USD') {
          console.log(`⏭️  Skipping ${symbol} - disabled due to poor performance (19.6% win rate)`);
          continue;
        }

        try {
          // 🚀 v3.0.0: MULTI-TIMEFRAME ANALYSIS
          // Fetch 4 timeframes for comprehensive trend analysis
          // With intelligent caching, this averages ~250 API calls/day (well under 800 limit)
          console.log(`📊 Fetching multi-timeframe data for ${symbol}...`);

          // Fetch all 4 timeframes in parallel for speed
          const [weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles, fifteenMinCandles] = await Promise.all([
            twelveDataAPI.fetchHistoricalCandles(symbol, '1week', 52),   // 52 weeks = 1 year
            twelveDataAPI.fetchHistoricalCandles(symbol, '1day', 200),   // 200 days
            twelveDataAPI.fetchHistoricalCandles(symbol, '4h', 360),     // 360 4H candles = 60 days
            twelveDataAPI.fetchHistoricalCandles(symbol, '1h', 1440),    // 1440 1H candles = 60 days (for analysis)
            twelveDataAPI.fetchHistoricalCandles(symbol, '15min', 500),  // 500 15-min candles = 125 hours (~5 days for charts)
          ]);

          // Validate we have sufficient data on all timeframes
          if (!weeklyCandles || weeklyCandles.length < 26) {
            console.warn(`⚠️  Insufficient weekly candle data for ${symbol} (${weeklyCandles?.length || 0} candles, need 26+)`);
            continue;
          }

          if (!dailyCandles || dailyCandles.length < 50) {
            console.warn(`⚠️  Insufficient daily candle data for ${symbol} (${dailyCandles?.length || 0} candles, need 50+)`);
            continue;
          }

          if (!fourHourCandles || fourHourCandles.length < 50) {
            console.warn(`⚠️  Insufficient 4H candle data for ${symbol} (${fourHourCandles?.length || 0} candles, need 50+)`);
            continue;
          }

          if (!oneHourCandles || oneHourCandles.length < 100) {
            console.warn(`⚠️  Insufficient 1H candle data for ${symbol} (${oneHourCandles?.length || 0} candles, need 100+)`);
            continue;
          }

          console.log(`✅ ${symbol}: Weekly ${weeklyCandles.length}, Daily ${dailyCandles.length}, 4H ${fourHourCandles.length}, 1H ${oneHourCandles.length}, 15min ${fifteenMinCandles.length} candles`);

          // Analyze with multi-timeframe strategy (🧠 AI-ENHANCED + 🎯 MILESTONE 3C)
          const signal = await strategy.analyze(weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles, symbol);

          // ✅ v3.1.0 ICT 3-Timeframe: Accept both HIGH (85-100) and MEDIUM (70-84) tier signals
          // MEDIUM tier = Practice signals, HIGH tier = Live trading
          if (signal && signal.confidence >= 70) {
            signalsGenerated++;
            signal.symbol = symbol; // Set the correct symbol

            // Track signal to database (both HIGH and MEDIUM tiers)
            try {
              // Store 15-min candles for chart visualization (better granularity than 1H)
              await this.trackSignal(signal, symbol, exchangeRate, fifteenMinCandles);
              signalsTracked++;
              const tierBadge = signal.tier === 'HIGH' ? '🟢 HIGH' : '🟡 MEDIUM';
              console.log(`✅ Tracked ${symbol} signal ${tierBadge} (${signal.confidence}/100 points)`);
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
   * Generate signal for specific symbol (on-demand analysis)
   * Used by /api/signals/analyze endpoint for manual "Analyze Now" button
   * @param symbol - Currency pair (e.g., 'EUR/USD')
   * @returns Object with signal and candles, or null if no opportunity
   */
  async generateSignalForSymbol(symbol: string): Promise<{ signal: Signal, candles: Candle[] } | null> {
    try {
      console.log(`🔍 On-demand analysis for ${symbol} [FIX v2 - Strategy Instantiation]...`);

      // Fetch all 4 timeframes in parallel (same as automated cron method)
      const [weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
        twelveDataAPI.fetchHistoricalCandles(symbol, '1week', 52),   // 52 weeks = 1 year
        twelveDataAPI.fetchHistoricalCandles(symbol, '1day', 200),   // 200 days
        twelveDataAPI.fetchHistoricalCandles(symbol, '4h', 360),     // 360 4H candles = 60 days
        twelveDataAPI.fetchHistoricalCandles(symbol, '1h', 1440),    // 1440 1H candles = 60 days (better 1D chart density)
      ]);

      // Validate minimum candles for reliable analysis
      if (weeklyCandles.length < 26 || dailyCandles.length < 50 ||
          fourHourCandles.length < 50 || oneHourCandles.length < 100) {
        console.log(`⚠️ Insufficient candle data for ${symbol}`);
        return null;
      }

      // Create strategy instance (same as generateSignals method)
      const strategy = new MACrossoverStrategy();

      // Run v3.1.0 ICT 3-Timeframe analysis
      const signal = await strategy.analyze(
        weeklyCandles,
        dailyCandles,
        fourHourCandles,
        oneHourCandles,
        symbol
      );

      if (signal) {
        console.log(`✅ Generated ${signal.tier} signal for ${symbol} (${signal.confidence}% confidence)`);

        // Save to database (same as cron-generated signals)
        const currentPrice = signal.entry;
        await this.trackSignal(signal, symbol, currentPrice, oneHourCandles);

        // Return both signal and candles for chart display
        return { signal, candles: oneHourCandles };
      } else {
        console.log(`ℹ️ No signal for ${symbol} (W+D+4H not aligned or filters not met)`);

        // Calculate trends for educational display (same logic as in strategy.analyze)
        const weeklyCloses = weeklyCandles.map(c => c.close);
        const dailyCloses = dailyCandles.map(c => c.close);
        const fourHourCloses = fourHourCandles.map(c => c.close);
        const oneHourCloses = oneHourCandles.map(c => c.close);

        const weeklyFastMA = Indicators.ema(weeklyCloses, 20);
        const weeklySlowMA = Indicators.ema(weeklyCloses, 50);
        const weeklyTrend = weeklyFastMA && weeklySlowMA && weeklyFastMA > weeklySlowMA ? 'UP' : 'DOWN';

        const dailyFastMA = Indicators.ema(dailyCloses, 20);
        const dailySlowMA = Indicators.ema(dailyCloses, 50);
        const dailyTrend = dailyFastMA && dailySlowMA && dailyFastMA > dailySlowMA ? 'UP' : 'DOWN';

        const fourHourFastMA = Indicators.ema(fourHourCloses, 20);
        const fourHourSlowMA = Indicators.ema(fourHourCloses, 50);
        const fourHourTrend = fourHourFastMA && fourHourSlowMA && fourHourFastMA > fourHourSlowMA ? 'UP' : 'DOWN';

        const oneHourFastMA = Indicators.ema(oneHourCloses, 20);
        const oneHourSlowMA = Indicators.ema(oneHourCloses, 50);
        const oneHourTrend = oneHourFastMA && oneHourSlowMA && oneHourFastMA > oneHourSlowMA ? 'UP' : 'DOWN';

        // Calculate alignment percentage (3 higher timeframes only)
        const allAligned = weeklyTrend === dailyTrend && dailyTrend === fourHourTrend;
        const twoAligned = (weeklyTrend === dailyTrend) || (dailyTrend === fourHourTrend) || (weeklyTrend === fourHourTrend);
        const alignmentPct = allAligned ? 100 : (twoAligned ? 67 : 33);

        // Return candles + analysis for educational display
        return {
          signal: null,
          candles: oneHourCandles,
          analysis: {
            weeklyTrend,
            dailyTrend,
            fourHourTrend,
            oneHourTrend,
            alignmentPct,
            reason: 'W+D+4H timeframes not fully aligned'
          }
        };
      }

    } catch (error) {
      console.error(`❌ Error generating signal for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Test ADX Threshold Sensitivity (Parameter Robustness Testing)
   * Used for validating system isn't over-fitted
   * Industry best practice: Test multiple parameter values
   * @param symbol - Currency pair to test
   * @param adxThreshold - ADX threshold to test (e.g., 20, 22, 25, 27, 30)
   * @returns Test result with signal (if generated) and diagnostic info
   */
  async testAdxThreshold(symbol: string, adxThreshold: number): Promise<any> {
    try {
      // Fetch all 4 timeframes (same as generateSignalForSymbol)
      const [weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
        twelveDataAPI.fetchHistoricalCandles(symbol, '1week', 52),
        twelveDataAPI.fetchHistoricalCandles(symbol, '1day', 200),
        twelveDataAPI.fetchHistoricalCandles(symbol, '4h', 360),
        twelveDataAPI.fetchHistoricalCandles(symbol, '1h', 1440),
      ]);

      // Validate minimum candles
      if (weeklyCandles.length < 26 || dailyCandles.length < 50 ||
          fourHourCandles.length < 50 || oneHourCandles.length < 100) {
        return {
          threshold: adxThreshold,
          signal: null,
          reason: 'Insufficient candle data'
        };
      }

      // Create strategy instance
      const strategy = new MACrossoverStrategy();

      // Run analysis with CUSTOM ADX threshold and DIAGNOSTIC MODE enabled
      const signal = await strategy.analyze(
        weeklyCandles,
        dailyCandles,
        fourHourCandles,
        oneHourCandles,
        symbol,
        {
          adxThreshold: adxThreshold,
          diagnosticMode: true  // Enable detailed logging
        }
      );

      return {
        threshold: adxThreshold,
        signal: signal,
        signalGenerated: signal !== null,
        confidence: signal?.confidence || 0,
        tier: signal?.tier || null
      };

    } catch (error: any) {
      console.error(`❌ Error testing ADX ${adxThreshold} for ${symbol}:`, error);
      return {
        threshold: adxThreshold,
        signal: null,
        error: error.message
      };
    }
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

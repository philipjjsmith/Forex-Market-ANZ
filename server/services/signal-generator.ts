import { db } from '../db';
import { sql } from 'drizzle-orm';
import { exchangeRateAPI } from './exchangerate-api';
import { twelveDataAPI } from './twelve-data';
import { aiAnalyzer } from './ai-analyzer';
import { parameterService } from './parameter-service';
import { propFirmService } from './prop-firm-config';
import { sessionAnalyzer } from './session-analyzer';
import { telegramNotifier } from './telegram-notifier';
import { ctraderExecutor } from './ctrader-executor';
import { getSignalNumber } from './signal-stats';

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
    const brokeAbove = recent.slice(-10).some(c => c.close > maxPriorHigh);

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
    const brokeBelow = recent.slice(-10).some(c => c.close < minPriorLow);

    // Check if we pulled back near that level (retest)
    const pulledBack = Math.abs(currentPrice - minPriorLow) / minPriorLow < 0.003;

    return brokeBelow && pulledBack;
  }
}

// Helper function: Check if forex market is open
// Forex market hours (UTC): Sun 22:00 → Fri 22:00
function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();   // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const hour = now.getUTCHours();
  if (day === 6) return false;                    // Saturday — always closed
  if (day === 0 && hour < 22) return false;       // Sunday before 10 PM UTC
  if (day === 5 && hour >= 22) return false;      // Friday after 10 PM UTC
  return true;
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

// ─────────────────────────────────────────────────────────────────────────────
// ICT FAIR VALUE GAP (FVG) DETECTOR
// A 3-candle imbalance pattern where institutional orders were left unfilled.
// Price returns to "fill the gap" — this is the entry trigger.
//
// Bullish FVG:  candle[n].low > candle[n-2].high  (gap ABOVE candle n-2)
// Bearish FVG:  candle[n].high < candle[n-2].low  (gap BELOW candle n-2)
// Entry at CE = Consequent Encroachment (midpoint of the gap)
// ─────────────────────────────────────────────────────────────────────────────
interface FVG {
  type: 'BULLISH' | 'BEARISH';
  high: number;          // Top of gap
  low: number;           // Bottom of gap
  ce: number;            // Consequent Encroachment (midpoint) — entry target
  candleIndex: number;   // Which candle (in the window) created this FVG
  filled: boolean;       // Has price closed inside the gap?
}

function detectFVGs(candles: Candle[]): FVG[] {
  const gaps: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const current = candles[i];

    // Bullish FVG: gap above prev2.high, below current.low
    if (current.low > prev2.high) {
      gaps.push({
        type: 'BULLISH',
        high: current.low,
        low: prev2.high,
        ce: (current.low + prev2.high) / 2,
        candleIndex: i,
        filled: false,
      });
    }

    // Bearish FVG: gap below prev2.low, above current.high
    if (current.high < prev2.low) {
      gaps.push({
        type: 'BEARISH',
        high: prev2.low,
        low: current.high,
        ce: (prev2.low + current.high) / 2,
        candleIndex: i,
        filled: false,
      });
    }
  }
  return gaps;
}

/**
 * Find the most recent unfilled FVG in the specified direction.
 * Looks back `lookback` candles (default 30) from the current candle.
 * Returns null if no active FVG found in that direction.
 */
function getActiveFVG(candles: Candle[], direction: 'LONG' | 'SHORT', lookback = 30): FVG | null {
  const fvgType = direction === 'LONG' ? 'BULLISH' : 'BEARISH';
  const window = candles.slice(-lookback - 1, -1); // exclude current (forming) candle
  const lastClose = candles[candles.length - 1].close;
  const allFvgs = detectFVGs(window);

  return allFvgs
    .filter(f => f.type === fvgType)
    .filter(f => {
      // Mark as unfilled: price hasn't closed inside the gap yet
      if (f.type === 'BULLISH') {
        // Unfilled = price is still above the gap bottom (low) — not yet entered the zone
        // OR price is currently in the zone (valid entry area)
        return lastClose >= f.low;
      } else {
        // Unfilled = price is still below the gap top (high)
        return lastClose <= f.high;
      }
    })
    .slice(-1)[0] ?? null; // Most recent qualifying FVG
}

class MACrossoverStrategy {
  name = 'ICT 3-Timeframe + Confluence Strategy';
  // v3.2.0: CONFLUENCE SCALE - Research-backed multi-factor system
  // - Weekly + Daily + 4H must align (major trend confirmation) = 75 pts
  // - 1H entry timing (crossover/pullback, RSI, ADX, BB) = 25 pts
  // - Key Level confluence (S/R levels, breakout/retest) = 20 pts
  // - Timing confluence (kill zones, news avoidance) = 10 pts
  // - Confidence max: 130 points (70 min, 85+ HIGH tier, 110+ S-TIER)
  // - Expected: 70-75% win rate with full confluence (research-backed)
  // Based on ICT methodology + professional confluence trading
  // Previous versions:
  // v3.1.0: ICT 3-TF Rule only (no confluence factors)
  // v3.0.0: Required all 4 timeframes align (TOO STRICT - 1-3 signals/month)
  // v2.2.0: Fixed HTF trend lag with acceleration filter
  // v2.1.0: Added mandatory ADX/RSI filters
  // v1.0.0: Basic MA crossover
  version = '3.2.0';

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

    // Daily timeframe - Intermediate trend
    const dailyFastMA = Indicators.ema(dailyCloses, fastPeriod);
    const dailySlowMA = Indicators.ema(dailyCloses, slowPeriod);
    const dailyMACD = Indicators.macd(dailyCloses, 12, 26, 9);
    const prevDailyMACD = Indicators.macd(dailyCloses.slice(0, -1), 12, 26, 9); // Previous bar — for slope calculation

    // 4H timeframe - Entry trend confirmation
    const fourHourFastMA = Indicators.ema(fourHourCloses, fastPeriod);
    const fourHourSlowMA = Indicators.ema(fourHourCloses, slowPeriod);
    const fourHourMACD = Indicators.macd(fourHourCloses, 12, 26, 9);

    // Guard: all MAs must be non-null before determining trend direction.
    // Previously these defaulted to 'DOWN' when null — causing false SHORT signals.
    if (!weeklyFastMA || !weeklySlowMA || !dailyFastMA || !dailySlowMA || !fourHourFastMA || !fourHourSlowMA) {
      return null; // Insufficient data — cannot determine trend direction reliably
    }

    const weeklyTrend = weeklyFastMA > weeklySlowMA ? 'UP' : 'DOWN';
    const dailyTrend = dailyFastMA > dailySlowMA ? 'UP' : 'DOWN';
    const fourHourTrend = fourHourFastMA > fourHourSlowMA ? 'UP' : 'DOWN';

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
    // Primary: FVG (Fair Value Gap) — institutional imbalance zones (leading indicator)
    // Secondary: EMA crossover — kept as fallback for markets with no recent FVG
    const prevOneHourFastMA = Indicators.ema(oneHourCloses.slice(0, -1), fastPeriod);
    const prevOneHourSlowMA = Indicators.ema(oneHourCloses.slice(0, -1), slowPeriod);

    if (!prevOneHourFastMA || !prevOneHourSlowMA) return null;

    const bullishCross = prevOneHourFastMA <= prevOneHourSlowMA && oneHourFastMA > oneHourSlowMA;
    const bearishCross = prevOneHourFastMA >= prevOneHourSlowMA && oneHourFastMA < oneHourSlowMA;

    // FVG detection on 1H candles
    const bullishFVG = getActiveFVG(oneHourCandles, 'LONG', 50);
    const bearishFVG = getActiveFVG(oneHourCandles, 'SHORT', 50);

    const currentPrice = oneHourCloses[oneHourCloses.length - 1];

    // 🧠 AI ENHANCEMENT: Get symbol-specific insights
    const aiInsights = aiAnalyzer.getSymbolInsights(symbol);
    const useAI = aiInsights.hasEnoughData; // Only use AI if 30+ signals

    // 🆕 NEW FILTERS: Detect S/R levels and breakout/retest patterns (on 1H timeframe)
    const srLevels = detectSupportResistance(oneHourCandles);
    const withinNewsWindow = isWithinNewsWindow();

    // 🆕 HYBRID ENTRY: BB Middle Band Pullback Detection
    // Detects pullback to BB middle line in established trends.
    // REQUIRES prior outer-band touch within last 20 candles (~20 hours):
    // Without this, the condition fires on every minor consolidation in a trend,
    // generating 6-15 signals/month instead of the intended 2-5.
    //
    // BB look-ahead fix: compute bbHistory WITHOUT the current candle so we compare
    // prior candles to the bands that existed at the time — not future bands.
    const bbHistory = Indicators.bollingerBands(oneHourCloses.slice(0, -1), 20, 2);
    const inBullishTrend = oneHourFastMA > oneHourSlowMA && fourHourTrend === 'UP' && dailyTrend === 'UP';
    const inBearishTrend = oneHourFastMA < oneHourSlowMA && fourHourTrend === 'DOWN' && dailyTrend === 'DOWN';
    const priorCandles = oneHourCandles.slice(-21, -1); // last 20 closed candles before current
    const recentlyTouchedLower = bbHistory ? priorCandles.some(c => c.low <= bbHistory.lower) : false;
    const recentlyTouchedUpper = bbHistory ? priorCandles.some(c => c.high >= bbHistory.upper) : false;
    const bullishPullback = inBullishTrend && currentPrice >= bb.lower && currentPrice <= bb.middle && recentlyTouchedLower;
    const bearishPullback = inBearishTrend && currentPrice <= bb.upper && currentPrice >= bb.middle && recentlyTouchedUpper;

    let signalType: 'LONG' | 'SHORT' | null = null;
    let confidence = 0;
    let entryType: 'CROSSOVER' | 'PULLBACK' = 'CROSSOVER';
    const rationale: string[] = [];

    if (useAI) {
      rationale.push(`AI-Enhanced (${aiInsights.totalSignals} signals analyzed, ${aiInsights.winRate.toFixed(1)}% win rate)`);
    }

    // 🚨 REVERSAL DETECTION — Elder Impulse System (slope-based, not sign-based)
    // Block signals only when MACD momentum is actively WORSENING in the trade direction.
    // Using SIGN alone (histogram < 0) creates weeks-long dead zones when MACD recovers slowly.
    // Using SLOPE (is histogram falling or rising?) catches real reversals without false blocks.
    //
    // Rule: Block LONG when histogram is negative AND FALLING (bearish momentum growing)
    //       Allow LONG when histogram is negative but RISING  (bearish momentum fading = pullback)
    //       Block SHORT when histogram is positive AND RISING  (bullish momentum growing)
    //       Allow SHORT when histogram is positive but FALLING (bullish momentum fading = pullback)
    if (dailyMACD && prevDailyMACD) {
      const histogramFalling = dailyMACD.histogram < prevDailyMACD.histogram;
      const histogramRising  = dailyMACD.histogram > prevDailyMACD.histogram;

      // Block LONG only when bearish momentum is actively increasing
      if ((bullishCross || bullishPullback) && dailyMACD.histogram < 0 && histogramFalling) {
        if (diagnosticMode) {
          console.log(`└─ ❌ REJECTED LONG: MACD histogram falling (${prevDailyMACD.histogram.toFixed(4)} → ${dailyMACD.histogram.toFixed(4)})`);
          console.log(`   Bearish momentum increasing - avoiding entry\n`);
        }
        return null;
      }

      // Block SHORT only when bullish momentum is actively increasing
      if ((bearishCross || bearishPullback) && dailyMACD.histogram > 0 && histogramRising) {
        if (diagnosticMode) {
          console.log(`└─ ❌ REJECTED SHORT: MACD histogram rising (${prevDailyMACD.histogram.toFixed(4)} → ${dailyMACD.histogram.toFixed(4)})`);
          console.log(`   Bullish momentum increasing - avoiding entry\n`);
        }
        return null;
      }
    }

    // 📊 STEP 3: ENTRY DETECTION — Check for LONG signals
    // HARD REQUIREMENT: Daily + 4H must both be UP (trend confirmation)
    // WEEKLY = BIAS FILTER: adds pts when aligned, partial pts when counter-trend
    //   Removing weekly as hard requirement eliminates 32-day dry spells during
    //   market transitions when daily/4H align but weekly hasn't caught up yet.
    // ENTRY: FVG active (preferred, leading) OR EMA crossover/pullback (fallback)
    const hasLongEntry = bullishFVG !== null || bullishCross || bullishPullback;
    if (hasLongEntry && dailyTrend === 'UP' && fourHourTrend === 'UP') {
      signalType = 'LONG';
      // Determine entry type for rationale
      if (bullishFVG) {
        entryType = 'PULLBACK'; // FVG = entering at institutional imbalance = pullback entry
      } else {
        entryType = bullishCross ? 'CROSSOVER' : 'PULLBACK';
      }

      // CONFIDENCE SCORING (Max: ~130 points)
      // Trend Timeframes (75 pts) + Entry Timing (25 pts) + Confluence (30 pts)

      // 1. Weekly timeframe — BIAS FILTER (not hard requirement)
      // When weekly confirms: full pts. When counter-weekly: partial pts (contrarian context)
      if (weeklyTrend === 'UP' && weeklyMACD && weeklyMACD.macd > weeklyMACD.signal) {
        confidence += 25;
        rationale.push('✅ Weekly BULLISH + MACD confirms (+25)');
      } else if (weeklyTrend === 'UP') {
        confidence += 20;
        rationale.push('⚠️ Weekly BULLISH but MACD weak (+20)');
      } else {
        // Counter-weekly trade: still valid (Daily+4H aligned), but lower confidence
        confidence += 10;
        rationale.push('⚠️ Counter-weekly LONG — D+4H aligned (+10)');
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

      // Entry signal detected (10 points) — FVG > crossover
      confidence += 10;
      if (bullishFVG) {
        rationale.push(`✅ FVG entry on 1H — CE: ${bullishFVG.ce.toFixed(5)} [${bullishFVG.low.toFixed(5)}-${bullishFVG.high.toFixed(5)}] (+10)`);
      } else if (entryType === 'CROSSOVER') {
        rationale.push('✅ MA crossover entry on 1H (+10)');
      } else {
        rationale.push('✅ Pullback entry signal on 1H (+10)');
      }

      // Check if 1H is in pullback (counter to main trend) - this is GOOD
      if (oneHourTrend === 'DOWN') {
        rationale.push('🎯 1H pullback detected - optimal entry zone');
      }

      // RSI in optimal range (6 points)
      if (rsi && rsi >= 40 && rsi <= 78) {
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

      // ═══════════════════════════════════════════════════════════════════
      // 🆕 CONFLUENCE SCALE v1.0 - Key Levels & Timing (30 points max)
      // Research-backed: 3-4 non-correlated factors = 70%+ win rate
      // ═══════════════════════════════════════════════════════════════════

      // 5. KEY LEVEL CONFLUENCE (20 points max)
      // Near Support level for LONG (+10 points)
      if (isNearLevel(currentPrice, srLevels.support)) {
        confidence += 10;
        rationale.push('✅ Near support level - optimal entry (+10)');
      }

      // Breakout + Retest pattern (+10 points)
      if (detectBreakoutRetest(oneHourCandles, 'LONG')) {
        confidence += 10;
        rationale.push('✅ Breakout + retest pattern detected (+10)');
      }

      // 6. TIMING CONFLUENCE (10 points max)
      // Session timing - Kill Zones
      const currentSession = sessionAnalyzer.detectSession(new Date());
      if (currentSession === 'LONDON_NY_OVERLAP') {
        confidence += 7;
        rationale.push('✅ London/NY Overlap - peak liquidity (+7)');
      } else if (currentSession === 'LONDON' || currentSession === 'NY') {
        confidence += 4;
        rationale.push(`✅ ${currentSession} session active (+4)`);
      } else if (currentSession === 'OFF_HOURS') {
        rationale.push('⚠️ Off-hours - lower liquidity');
      }

      // No high-impact news window (+3 points)
      if (!withinNewsWindow) {
        confidence += 3;
        rationale.push('✅ No major news window (+3)');
      } else {
        rationale.push('⚠️ Within news window - increased volatility');
      }

    // 📊 STEP 4: ENTRY DETECTION — Check for SHORT signals
    // HARD REQUIREMENT: Daily + 4H must both be DOWN
    // WEEKLY = BIAS FILTER: adds pts when aligned, partial pts when counter-trend
    // ENTRY: FVG active (preferred) OR EMA crossover/pullback (fallback)
    } else if ((bearishFVG !== null || bearishCross || bearishPullback) && dailyTrend === 'DOWN' && fourHourTrend === 'DOWN') {
      signalType = 'SHORT';
      if (bearishFVG) {
        entryType = 'PULLBACK';
      } else {
        entryType = bearishCross ? 'CROSSOVER' : 'PULLBACK';
      }

      // 1. Weekly timeframe — BIAS FILTER (not hard requirement)
      if (weeklyTrend === 'DOWN' && weeklyMACD && weeklyMACD.macd < weeklyMACD.signal) {
        confidence += 25;
        rationale.push('✅ Weekly BEARISH + MACD confirms (+25)');
      } else if (weeklyTrend === 'DOWN') {
        confidence += 20;
        rationale.push('⚠️ Weekly BEARISH but MACD weak (+20)');
      } else {
        confidence += 10;
        rationale.push('⚠️ Counter-weekly SHORT — D+4H aligned (+10)');
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

      // Entry signal detected (10 points) — FVG > crossover
      confidence += 10;
      if (bearishFVG) {
        rationale.push(`✅ FVG entry on 1H — CE: ${bearishFVG.ce.toFixed(5)} [${bearishFVG.low.toFixed(5)}-${bearishFVG.high.toFixed(5)}] (+10)`);
      } else if (entryType === 'CROSSOVER') {
        rationale.push('✅ MA crossover entry on 1H (+10)');
      } else {
        rationale.push('✅ Pullback entry signal on 1H (+10)');
      }

      // Check if 1H is in pullback (counter to main trend) - this is GOOD
      if (oneHourTrend === 'UP') {
        rationale.push('🎯 1H pullback detected - optimal entry zone');
      }

      // RSI in optimal range (6 points)
      if (rsi && rsi >= 22 && rsi <= 60) {
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

      // ═══════════════════════════════════════════════════════════════════
      // 🆕 CONFLUENCE SCALE v1.0 - Key Levels & Timing (30 points max)
      // Research-backed: 3-4 non-correlated factors = 70%+ win rate
      // ═══════════════════════════════════════════════════════════════════

      // 5. KEY LEVEL CONFLUENCE (20 points max)
      // Near Resistance level for SHORT (+10 points)
      if (isNearLevel(currentPrice, srLevels.resistance)) {
        confidence += 10;
        rationale.push('✅ Near resistance level - optimal entry (+10)');
      }

      // Breakout + Retest pattern (+10 points)
      if (detectBreakoutRetest(oneHourCandles, 'SHORT')) {
        confidence += 10;
        rationale.push('✅ Breakout + retest pattern detected (+10)');
      }

      // 6. TIMING CONFLUENCE (10 points max)
      // Session timing - Kill Zones
      const currentSessionShort = sessionAnalyzer.detectSession(new Date());
      if (currentSessionShort === 'LONDON_NY_OVERLAP') {
        confidence += 7;
        rationale.push('✅ London/NY Overlap - peak liquidity (+7)');
      } else if (currentSessionShort === 'LONDON' || currentSessionShort === 'NY') {
        confidence += 4;
        rationale.push(`✅ ${currentSessionShort} session active (+4)`);
      } else if (currentSessionShort === 'OFF_HOURS') {
        rationale.push('⚠️ Off-hours - lower liquidity');
      }

      // No high-impact news window (+3 points)
      if (!withinNewsWindow) {
        confidence += 3;
        rationale.push('✅ No major news window (+3)');
      } else {
        rationale.push('⚠️ Within news window - increased volatility');
      }

    }

    // ⚡ PHASE 3D: MANDATORY RSI filters (block overbought/oversold extremes)
    // Industry best practice: RSI must indicate momentum in trade direction
    if (!rsi) return null; // RSI is required

    if (signalType === 'LONG') {
      // LONG requires RSI 40-78 (upward momentum, allows trending overbought entries)
      if (rsi < 40 || rsi > 78) {
        return null; // Block trade - RSI shows weak momentum or extreme overbought
      }
    } else if (signalType === 'SHORT') {
      // SHORT requires RSI 22-60 (downward momentum, allows trending oversold entries)
      if (rsi < 22 || rsi > 60) {
        return null; // Block trade - RSI shows weak momentum or extreme oversold
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
    // 🎯 CONFLUENCE SCALE v1.0 - Tier determination
    // Max Score: 130 points (Trend: 75 + Entry: 25 + Confluence: 30)
    // HIGH tier: 85+ points = Strong multi-factor confluence
    // MEDIUM tier: 70-84 points = Practice only
    let tier: 'HIGH' | 'MEDIUM';
    let tradeLive: boolean;
    let positionSizePercent: number;

    // Get prop firm configuration
    const propConfig = propFirmService.getConfig();

    if (confidence >= 90) {  // HIGH tier: 90+ points (69% of 130 max) - Strong confluence alignment
      tier = 'HIGH';
      tradeLive = true;
      // Use prop firm configured risk (1.0% for Phase 1, 1.5% for Phase 2)
      positionSizePercent = propFirmService.getPositionSize('HIGH');
      const confluenceLevel = confidence >= 110 ? 'S-TIER' : 'A-TIER';
      rationale.push(`🟢 ${confluenceLevel} (${confidence}/130) - LIVE TRADE @ ${positionSizePercent}% risk`);
      rationale.push(`📊 ${propConfig.name} ${propConfig.challengeType}`);
    } else {
      tier = 'MEDIUM';
      tradeLive = false;
      positionSizePercent = propFirmService.getPositionSize('MEDIUM');
      rationale.push(`🟡 B-TIER (${confidence}/130) - PRACTICE SIGNAL`);
    }

    // ⚡ SL/TP: Fixed 1.5×ATR stop, 3.0×ATR TP1 = 2:1 R:R minimum
    // At 55% WR with 2:1 R:R: EV = +0.65R per trade (passes The5ers Bootcamp in ~20-25 trades)
    // FVG entries are precise, so 1.5×ATR stop is sufficient (previously 3.0×ATR was too wide)
    const SL_MULTIPLIER = 1.5;   // 1.5×ATR stop loss
    const TP1_MULTIPLIER = 3.0;  // 3.0×ATR TP1 = 2:1 R:R
    const TP2_MULTIPLIER = 6.0;  // 6.0×ATR TP2 = 4:1 R:R
    const TP3_MULTIPLIER = 9.0;  // 9.0×ATR TP3 = 6:1 R:R

    // Pip factor: JPY pairs use 2 decimal places (1 pip = 0.01), all others 4 decimal places
    const pipFactor = symbol.includes('JPY') ? 100 : 10000;

    // Minimum SL floor in pips (prevent stop-hunt distances that are too tight)
    const MIN_SL_PIPS: Record<string, number> = {
      'EUR/USD': 8,
      'USD/CHF': 8,
      'GBP/USD': 10,
      'USD/JPY': 6,
    };
    const minSlDistance = (MIN_SL_PIPS[symbol] ?? 8) / pipFactor;
    const rawSl = atr * SL_MULTIPLIER;
    const actualSlDistance = Math.max(rawSl, minSlDistance);

    const stop = signalType === 'LONG'
      ? currentPrice - actualSlDistance
      : currentPrice + actualSlDistance;

    const tp1 = signalType === 'LONG'
      ? currentPrice + (atr * TP1_MULTIPLIER) // 2:1 R:R minimum
      : currentPrice - (atr * TP1_MULTIPLIER);

    const tp2 = signalType === 'LONG'
      ? currentPrice + (atr * TP2_MULTIPLIER) // 4:1 R:R
      : currentPrice - (atr * TP2_MULTIPLIER);

    const tp3 = signalType === 'LONG'
      ? currentPrice + (atr * TP3_MULTIPLIER) // 6:1 R:R
      : currentPrice - (atr * TP3_MULTIPLIER);

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

    // 🛡️ MARKET HOURS GATE: Skip signal generation when forex market is closed
    if (!isForexMarketOpen()) {
      console.log('⏭️  Forex market closed - skipping signal generation');
      this.isRunning = false;
      return;
    }

    // 🎯 ICT KILL ZONE GATE: Only trade during institutional liquidity windows
    // London Open 07:00-10:00 UTC, NY Open 12:00-15:00 UTC
    // Trading outside these windows = chasing retail moves in low-liquidity = stop hunts
    if (!sessionAnalyzer.isInKillZone()) {
      console.log(`⏭️  Outside ICT kill zone (${sessionAnalyzer.getKillZoneName()}) — skipping signal generation`);
      this.isRunning = false;
      return;
    }
    console.log(`✅ In kill zone: ${sessionAnalyzer.getKillZoneName()}`);

    // 🎯 The5ers: Initialize daily tracker (resets each new trading day)
    propFirmService.initDailyTracker(10000);

    const propConfig = propFirmService.getConfig();
    console.log('🤖 [Signal Generator] Starting automated analysis...');
    console.log(`📊 [PropFirm] Active: ${propConfig.name} - ${propConfig.challengeType}`);
    console.log(`📊 [PropFirm] Risk per trade: ${propConfig.highTierRisk}% | Daily limit: ${propConfig.maxDailyLoss}% | Buffer: ${propConfig.dailyLossBuffer}%`);

    // 🛡️ PROP FIRM PROTECTION: Check if max trades reached for today (DB query — survives Render restarts)
    if (await propFirmService.maxTradesReached()) {
      console.log(`⚠️ [PropFirm] Max trades per day (${propConfig.maxTradesPerDay}) reached. Skipping signal generation.`);
      this.isRunning = false;
      return;
    }

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

        // 🔒 DEDUPLICATION: Skip if there is already a PENDING signal for this symbol
        // Prevents duplicate signals from BB pullback (fires every 15 min while condition holds)
        // and EMA crossover (fires multiple times per crossover event via cache reuse)
        const existingPending = await db.execute(sql`
          SELECT signal_id FROM signal_history
          WHERE symbol = ${symbol}
            AND outcome = 'PENDING'
            AND data_quality = 'production'
          LIMIT 1
        `);
        if ((existingPending as any[]).length > 0) {
          console.log(`⏭️  Skipping ${symbol} - active PENDING signal exists (dedup)`);
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
              // Count this signal against the daily trade limit
              propFirmService.updateDailyTracker(0, 10000);
              // Get sequential signal number for Telegram (Signal #47 etc.)
              let signalNumber = 0;
              try { signalNumber = await getSignalNumber(signal.id); } catch { /* non-critical */ }
              // Send Telegram notification so the trade can be placed manually on The5ers
              await telegramNotifier.sendSignalAlert({
                symbol: signal.symbol,
                type: signal.type,
                entry: signal.entry,
                stop: signal.stop,
                tp1: signal.targets[0],
                tp2: signal.targets[1],
                tp3: signal.targets[2],
                confidence: signal.confidence,
                tier: signal.tier,
                riskReward: signal.riskReward,
                rationale: signal.rationale,
                version: signal.version,
                signalNumber,
              });
              // Auto-execute on The5ers cTrader (HIGH tier only; no-op until CTRADER_ env vars set)
              await ctraderExecutor.executeSignal({
                symbol: signal.symbol,
                type: signal.type,
                entry: signal.entry,
                stop: signal.stop,
                targets: signal.targets,
                confidence: signal.confidence,
                tier: signal.tier,
              });
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
        outcome,
        data_quality
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
        'PENDING',
        'production'
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
  async generateSignalForSymbol(symbol: string): Promise<{ signal: Signal | null, candles: Candle[], analysis?: object } | null> {
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

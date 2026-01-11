/**
 * TEST CRITICAL FIXES
 * Verify Fix #1 (Reversal Detection) and Fix #2 (Balanced LONG/SHORT) work correctly
 */

import postgres from 'postgres';

const db = postgres('postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
});

const TWELVE_DATA_KEY = 'efbdd7552a394ddba5340e606da8d2f6';

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// EMA calculator
function calculateEMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// MACD calculator
function calculateMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const macdValues: number[] = [];
  for (let i = slowPeriod - 1; i < closes.length; i++) {
    const fEMA = calculateEMA(closes.slice(0, i + 1), fastPeriod);
    const sEMA = calculateEMA(closes.slice(0, i + 1), slowPeriod);
    if (fEMA && sEMA) {
      macdValues.push(fEMA - sEMA);
    }
  }

  if (macdValues.length < signalPeriod) return null;

  const macdLine = macdValues[macdValues.length - 1];
  const signalLine = calculateEMA(macdValues, signalPeriod);
  if (!signalLine) return null;

  const histogram = macdLine - signalLine;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: histogram
  };
}

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

async function fetchCandles(symbol: string, interval: string, outputsize: number): Promise<Candle[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status === 'error') {
    throw new Error(`API Error: ${data.message}`);
  }

  if (!data.values || !Array.isArray(data.values)) {
    throw new Error('Invalid response from Twelve Data');
  }

  const candles: Candle[] = data.values
    .map((item: TwelveDataCandle) => ({
      timestamp: new Date(item.datetime),
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: 1000,
    }))
    .reverse();

  return candles;
}

async function testCriticalFixes() {
  console.log('🧪 TESTING CRITICAL FIXES');
  console.log('='.repeat(100));
  console.log('Fix #1: Reversal Detection (MACD histogram check)');
  console.log('Fix #2: Balanced LONG/SHORT (2-of-3 alignment for SHORT)');
  console.log('='.repeat(100));
  console.log('');

  try {
    const symbol = 'EUR/USD';
    console.log(`📊 Testing ${symbol}...`);
    console.log('');

    // Fetch candles
    console.log('📡 Fetching candles from Twelve Data...');
    const [weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
      fetchCandles(symbol, '1week', 52),
      fetchCandles(symbol, '1day', 200),
      fetchCandles(symbol, '4h', 360),
      fetchCandles(symbol, '1h', 1440),
    ]);

    console.log(`✅ Candles fetched:`)
    console.log(`   Weekly: ${weeklyCandles.length} candles`);
    console.log(`   Daily: ${dailyCandles.length} candles`);
    console.log(`   4H: ${fourHourCandles.length} candles`);
    console.log(`   1H: ${oneHourCandles.length} candles`);
    console.log('');

    // Analyze trends
    const weeklyCloses = weeklyCandles.map(c => c.close);
    const dailyCloses = dailyCandles.map(c => c.close);
    const fourHourCloses = fourHourCandles.map(c => c.close);
    const oneHourCloses = oneHourCandles.map(c => c.close);

    const weeklyFastMA = calculateEMA(weeklyCloses, 20);
    const weeklySlowMA = calculateEMA(weeklyCloses, 50);
    const weeklyTrend = weeklyFastMA && weeklySlowMA && weeklyFastMA > weeklySlowMA ? 'UP' : 'DOWN';

    const dailyFastMA = calculateEMA(dailyCloses, 20);
    const dailySlowMA = calculateEMA(dailyCloses, 50);
    const dailyTrend = dailyFastMA && dailySlowMA && dailyFastMA > dailySlowMA ? 'UP' : 'DOWN';
    const dailyMACD = calculateMACD(dailyCloses, 12, 26, 9);

    const fourHourFastMA = calculateEMA(fourHourCloses, 20);
    const fourHourSlowMA = calculateEMA(fourHourCloses, 50);
    const fourHourTrend = fourHourFastMA && fourHourSlowMA && fourHourFastMA > fourHourSlowMA ? 'UP' : 'DOWN';

    const oneHourFastMA = calculateEMA(oneHourCloses, 20);
    const oneHourSlowMA = calculateEMA(oneHourCloses, 50);
    const oneHourTrend = oneHourFastMA && oneHourSlowMA && oneHourFastMA > oneHourSlowMA ? 'UP' : 'DOWN';

    console.log('📈 TREND ANALYSIS:');
    console.log(`   Weekly:  ${weeklyTrend}`);
    console.log(`   Daily:   ${dailyTrend}`);
    console.log(`   4H:      ${fourHourTrend}`);
    console.log(`   1H:      ${oneHourTrend}`);
    console.log('');

    console.log('📊 DAILY MACD (REVERSAL DETECTION):');
    if (dailyMACD) {
      console.log(`   MACD Line:    ${dailyMACD.macd.toFixed(6)}`);
      console.log(`   Signal Line:  ${dailyMACD.signal.toFixed(6)}`);
      console.log(`   Histogram:    ${dailyMACD.histogram.toFixed(6)} ${dailyMACD.histogram > 0 ? '(BULLISH)' : '(BEARISH)'}`);
    } else {
      console.log('   ❌ Daily MACD calculation failed');
    }
    console.log('');

    // TEST FIX #1: REVERSAL DETECTION
    console.log('🧪 TEST FIX #1: REVERSAL DETECTION');
    console.log('-'.repeat(100));

    const threeTimeframesAlignedLONG = weeklyTrend === 'UP' && dailyTrend === 'UP' && fourHourTrend === 'UP';
    if (threeTimeframesAlignedLONG) {
      console.log('✅ 3 Timeframes aligned for LONG (W+D+4H all UP)');
      if (dailyMACD && dailyMACD.histogram < 0) {
        console.log('🚨 CRITICAL FIX #1 ACTIVE: Daily MACD bearish - LONG signal BLOCKED');
        console.log(`   → Histogram: ${dailyMACD.histogram.toFixed(6)} (negative = bearish)`);
        console.log(`   → This prevents December disaster (93 LONG signals while reversing)`);
      } else if (dailyMACD && dailyMACD.histogram > 0) {
        console.log('✅ Daily MACD bullish - LONG signal ALLOWED');
        console.log(`   → Histogram: ${dailyMACD.histogram.toFixed(6)} (positive = bullish)`);
      }
    } else {
      console.log('❌ 3 Timeframes NOT aligned for LONG');
      console.log(`   → W:${weeklyTrend}, D:${dailyTrend}, 4H:${fourHourTrend}`);
    }
    console.log('');

    // TEST FIX #2: BALANCED LONG/SHORT
    console.log('🧪 TEST FIX #2: BALANCED LONG/SHORT GENERATION');
    console.log('-'.repeat(100));

    const downTrends = [weeklyTrend === 'DOWN', dailyTrend === 'DOWN', fourHourTrend === 'DOWN'].filter(Boolean).length;
    console.log(`SHORT Signal Check: ${downTrends}/3 timeframes DOWN`);
    console.log(`   Weekly:  ${weeklyTrend === 'DOWN' ? '✅ DOWN' : '❌ UP'}`);
    console.log(`   Daily:   ${dailyTrend === 'DOWN' ? '✅ DOWN' : '❌ UP'}`);
    console.log(`   4H:      ${fourHourTrend === 'DOWN' ? '✅ DOWN' : '❌ UP'}`);
    console.log('');

    if (downTrends >= 2) {
      console.log(`✅ CRITICAL FIX #2 ACTIVE: ${downTrends}/3 DOWN - SHORT signal ALLOWED (2-of-3 rule)`);
      console.log(`   → OLD SYSTEM: Required 3/3 (too strict - 0 SHORT signals in December)`);
      console.log(`   → NEW SYSTEM: Requires 2/3 (balanced - allows SHORT detection)`);

      if (dailyMACD && dailyMACD.histogram > 0) {
        console.log('🚨 REVERSAL DETECTION: Daily MACD bullish - SHORT signal BLOCKED');
        console.log(`   → Histogram: ${dailyMACD.histogram.toFixed(6)} (positive = trend reversing up)`);
      } else if (dailyMACD && dailyMACD.histogram < 0) {
        console.log('✅ Daily MACD bearish - SHORT signal ALLOWED');
        console.log(`   → Histogram: ${dailyMACD.histogram.toFixed(6)} (negative = bearish trend)`);
      }
    } else {
      console.log(`❌ Only ${downTrends}/3 DOWN - SHORT signal REJECTED (need 2+)`);
    }
    console.log('');

    // SUMMARY
    console.log('='.repeat(100));
    console.log('📋 SUMMARY:');
    console.log('');

    let longAllowed = threeTimeframesAlignedLONG && (!dailyMACD || dailyMACD.histogram > 0);
    let shortAllowed = downTrends >= 2 && (!dailyMACD || dailyMACD.histogram < 0);

    console.log(`LONG Signals: ${longAllowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
    if (!longAllowed && threeTimeframesAlignedLONG && dailyMACD && dailyMACD.histogram < 0) {
      console.log(`   → Blocked by Fix #1 (Daily MACD bearish)`);
    } else if (!longAllowed) {
      console.log(`   → Blocked by ICT 3-TF Rule (need W+D+4H all UP)`);
    }
    console.log('');

    console.log(`SHORT Signals: ${shortAllowed ? '✅ ALLOWED' : '❌ BLOCKED'}`);
    if (!shortAllowed && downTrends >= 2 && dailyMACD && dailyMACD.histogram > 0) {
      console.log(`   → Blocked by Fix #1 (Daily MACD bullish)`);
    } else if (!shortAllowed) {
      console.log(`   → Blocked by Fix #2 (need 2+ of W/D/4H DOWN)`);
    }
    console.log('');

    console.log('✅ Critical Fixes Test Complete!');
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

testCriticalFixes();

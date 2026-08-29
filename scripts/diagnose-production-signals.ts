/**
 * DIAGNOSTIC SCRIPT - Test Signal Generation with Production Settings
 * This will tell us EXACTLY why no signals are being generated
 */

import postgres from 'postgres';

// Use CORRECT connection string
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

// Simple EMA calculator
function calculateEMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// Simple ADX calculator
function calculateADX(candles: Candle[], period: number = 14): number | null {
  if (candles.length < period + 1) return null;

  const trueRanges: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  if (trueRanges.length < period) return null;

  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothedMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  for (let i = period; i < trueRanges.length; i++) {
    smoothedTR = smoothedTR - (smoothedTR / period) + trueRanges[i];
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDM[i];
  }

  const plusDI = (smoothedPlusDM / smoothedTR) * 100;
  const minusDI = (smoothedMinusDM / smoothedTR) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;

  return dx;
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

async function testSignalGeneration() {
  console.log('🔬 DIAGNOSTIC: Testing Signal Generation');
  console.log('='.repeat(100));
  console.log('');

  try {
    // Test EUR/USD (our main pair)
    const symbol = 'EUR/USD';
    console.log(`📊 Testing ${symbol}...`);
    console.log('');

    // Fetch candles (simulating what production does)
    console.log('📡 Fetching candles from Twelve Data...');
    const [weeklyCandles, dailyCandles, fourHourCandles, oneHourCandles] = await Promise.all([
      fetchCandles(symbol, '1week', 52),
      fetchCandles(symbol, '1day', 200),
      fetchCandles(symbol, '4h', 360),
      fetchCandles(symbol, '1h', 1440),
    ]);

    console.log(`✅ Candles fetched:`);
    console.log(`   Weekly: ${weeklyCandles.length} candles`);
    console.log(`   Daily: ${dailyCandles.length} candles`);
    console.log(`   4H: ${fourHourCandles.length} candles`);
    console.log(`   1H: ${oneHourCandles.length} candles`);
    console.log('');

    // Check if we have minimum candles
    if (weeklyCandles.length < 26) {
      console.error(`❌ BLOCKER: Insufficient weekly candles (${weeklyCandles.length} < 26)`);
      return;
    }
    if (dailyCandles.length < 50) {
      console.error(`❌ BLOCKER: Insufficient daily candles (${dailyCandles.length} < 50)`);
      return;
    }
    if (fourHourCandles.length < 50) {
      console.error(`❌ BLOCKER: Insufficient 4H candles (${fourHourCandles.length} < 50)`);
      return;
    }
    if (oneHourCandles.length < 100) {
      console.error(`❌ BLOCKER: Insufficient 1H candles (${oneHourCandles.length} < 100)`);
      return;
    }

    // Analyze trends on each timeframe
    console.log('📈 Analyzing trends on each timeframe...');
    console.log('');

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

    const fourHourFastMA = calculateEMA(fourHourCloses, 20);
    const fourHourSlowMA = calculateEMA(fourHourCloses, 50);
    const fourHourTrend = fourHourFastMA && fourHourSlowMA && fourHourFastMA > fourHourSlowMA ? 'UP' : 'DOWN';

    const oneHourFastMA = calculateEMA(oneHourCloses, 20);
    const oneHourSlowMA = calculateEMA(oneHourCloses, 50);
    const oneHourTrend = oneHourFastMA && oneHourSlowMA && oneHourFastMA > oneHourSlowMA ? 'UP' : 'DOWN';

    const adx = calculateADX(oneHourCandles, 14);
    const rsi = null; // Not needed for this diagnostic

    console.log(`🔍 Trend Analysis:`);
    console.log(`   Weekly:  ${weeklyTrend}`);
    console.log(`   Daily:   ${dailyTrend}`);
    console.log(`   4H:      ${fourHourTrend}`);
    console.log(`   1H:      ${oneHourTrend}`);
    console.log('');
    console.log(`📊 Entry Indicators (1H):`);
    console.log(`   ADX:     ${adx?.toFixed(2) || 'N/A'} (need >= 25)`);
    console.log('');

    // Check ICT 3-Timeframe Rule
    const threeTimeframesAlign = (weeklyTrend === dailyTrend && dailyTrend === fourHourTrend);
    console.log(`🎯 ICT 3-Timeframe Rule:`);
    console.log(`   Weekly + Daily + 4H aligned? ${threeTimeframesAlign ? '✅ YES' : '❌ NO'}`);
    console.log('');

    // Check ADX filter
    if (!adx || adx < 25) {
      console.log(`❌ BLOCKER: ADX ${adx?.toFixed(2) || 'N/A'} < 25 (ranging market)`);
      console.log(`   → Signal generation blocked because market is ranging, not trending`);
      console.log('');
    } else {
      console.log(`✅ ADX Filter Passed: ${adx.toFixed(2)} >= 25 (trending market)`);
      console.log('');
    }

    if (!threeTimeframesAlign) {
      console.log(`❌ BLOCKER: 3 timeframes not aligned`);
      console.log(`   → For LONG: need Weekly=UP, Daily=UP, 4H=UP`);
      console.log(`   → For SHORT: need Weekly=DOWN, Daily=DOWN, 4H=DOWN`);
      console.log(`   → Current: W=${weeklyTrend}, D=${dailyTrend}, 4H=${fourHourTrend}`);
      console.log('');
    } else {
      console.log(`✅ 3-Timeframe Alignment: All ${weeklyTrend}`);
      console.log('');
    }

    // Test database connection
    console.log('📊 Testing Database Connection...');
    try {
      const testQuery = await db`SELECT NOW() as time, COUNT(*) as total FROM signal_history`;
      console.log(`✅ Database Connected: ${testQuery[0].total} signals in history`);
      console.log('');
    } catch (dbError) {
      console.error(`❌ DATABASE CONNECTION FAILED:`);
      console.error(dbError);
      console.log('');
      console.log(`🎯 THIS IS THE PROBLEM: Production can't save signals to database!`);
      console.log('');
    }

    // Summary
    console.log('='.repeat(100));
    console.log('📋 SUMMARY:');
    console.log('');

    if (!adx || adx < 25) {
      console.log(`❌ ROOT CAUSE: Market is RANGING (ADX ${adx?.toFixed(2) || 'N/A'} < 25)`);
      console.log(`   → No signals generated because ADX filter blocks ranging markets`);
      console.log(`   → This is WORKING AS INTENDED to avoid false signals`);
    } else if (!threeTimeframesAlign) {
      console.log(`❌ ROOT CAUSE: 3 Timeframes NOT ALIGNED`);
      console.log(`   → W=${weeklyTrend}, D=${dailyTrend}, 4H=${fourHourTrend}`);
      console.log(`   → ICT rule requires all 3 aligned for signal generation`);
      console.log(`   → This is WORKING AS INTENDED - waiting for proper setup`);
    } else {
      console.log(`✅ Market conditions MET for signal generation!`);
      console.log(`   → If production still has 0 signals, database connection is the issue`);
    }
    console.log('='.repeat(100));

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await db.end();
    process.exit(0);
  }
}

testSignalGeneration();

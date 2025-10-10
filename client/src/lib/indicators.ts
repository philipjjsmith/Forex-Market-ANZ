// Technical Indicators Implementation
export class Indicators {
  static sma(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  static ema(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = this.sma(data.slice(0, period), period);
    if (!ema) return null;
    
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  static rsi(closes: number[], period = 14): number | null {
    if (closes.length < period + 1) return null;
    
    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
    
    let avgGain = this.sma(gains.slice(0, period), period);
    let avgLoss = this.sma(losses.slice(0, period), period);
    
    if (!avgGain || !avgLoss) return null;
    
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  static atr(candles: Array<{high: number, low: number, close: number}>, period = 14): number | null {
    if (candles.length < period + 1) return null;
    
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    return this.sma(trueRanges.slice(-period), period);
  }

  static bollingerBands(closes: number[], period = 20, stdDev = 2) {
    if (closes.length < period) return null;
    
    const sma = this.sma(closes.slice(-period), period);
    if (!sma) return null;
    
    const squaredDiffs = closes.slice(-period).map(c => Math.pow(c - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      middle: sma,
      upper: sma + (std * stdDev),
      lower: sma - (std * stdDev),
      bandwidth: (std * stdDev * 2) / sma
    };
  }

  static adx(candles: Array<{high: number, low: number, close: number}>, period = 14) {
    if (candles.length < period * 2) return null;
    
    const dmPlus: number[] = [];
    const dmMinus: number[] = [];
    const tr: number[] = [];
    
    for (let i = 1; i < candles.length; i++) {
      const highDiff = candles[i].high - candles[i - 1].high;
      const lowDiff = candles[i - 1].low - candles[i].low;
      
      dmPlus.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
      dmMinus.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
      
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      
      tr.push(Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      ));
    }
    
    const atr = this.sma(tr.slice(-period), period);
    if (!atr) return null;

    const diPlus = ((this.sma(dmPlus.slice(-period), period) || 0) / atr) * 100;
    const diMinus = ((this.sma(dmMinus.slice(-period), period) || 0) / atr) * 100;
    
    const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
    
    return { adx: dx, diPlus, diMinus };
  }
}

// Mock Data Generator
export const generateMockCandles = (count = 200) => {
  const candles = [];
  let basePrice = 1.1000;
  const now = Date.now();
  
  for (let i = count; i > 0; i--) {
    const change = (Math.random() - 0.48) * 0.0015;
    basePrice += change;
    const high = basePrice + Math.random() * 0.0008;
    const low = basePrice - Math.random() * 0.0008;
    const open = basePrice - change / 2;
    
    candles.push({
      timestamp: new Date(now - i * 3600000),
      open: parseFloat(open.toFixed(5)),
      high: parseFloat(high.toFixed(5)),
      low: parseFloat(low.toFixed(5)),
      close: parseFloat(basePrice.toFixed(5)),
      volume: Math.floor(Math.random() * 10000)
    });
  }
  
  return candles;
};

import { Indicators } from './indicators';

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
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
  tier?: 'HIGH' | 'MEDIUM';
  tradeLive?: boolean;
  positionSizePercent?: number;
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
  status?: string;
}

export class MACrossoverStrategy {
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

      const avgPrice = Indicators.sma(closes.slice(-20), 20);
      if (avgPrice) {
        const volatilityRatio = atr / avgPrice;
        if (volatilityRatio > 0.003 && volatilityRatio < 0.015) {
          confidence += 10;
          rationale.push('Volatility is moderate');
        }
      }
    }

    if (bearishCross && htfTrend === 'DOWN') {
      signalType = 'SHORT';
      confidence += 30;
      rationale.push('Bearish MA crossover detected');

      if (rsi && rsi < 60 && rsi > 30) {
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

      const avgPrice = Indicators.sma(closes.slice(-20), 20);
      if (avgPrice) {
        const volatilityRatio = atr / avgPrice;
        if (volatilityRatio > 0.003 && volatilityRatio < 0.015) {
          confidence += 10;
          rationale.push('Volatility is moderate');
        }
      }
    }

    if (!signalType || confidence < 50) return null;

    const entry = currentPrice;
    const stopDistance = atr * 2;
    const stop = signalType === 'LONG' ? entry - stopDistance : entry + stopDistance;

    const target1 = signalType === 'LONG' ? entry + (stopDistance * 1.5) : entry - (stopDistance * 1.5);
    const target2 = signalType === 'LONG' ? entry + (stopDistance * 2.5) : entry - (stopDistance * 2.5);
    const target3 = signalType === 'LONG' ? entry + (stopDistance * 4) : entry - (stopDistance * 4);

    const riskReward = Math.abs((target2 - entry) / (stop - entry));

    // Determine order type
    const priceVariation = (Math.random() - 0.5) * 0.002;
    const adjustedEntry = parseFloat((currentPrice * (1 + priceVariation)).toFixed(5));
    
    let orderType: string;
    let executionType: string;
    
    if (Math.abs(adjustedEntry - currentPrice) < 0.00010) {
      orderType = 'MARKET';
      executionType = 'FILL_OR_KILL';
    } else if (signalType === 'LONG') {
      if (adjustedEntry < currentPrice) {
        orderType = 'BUY_LIMIT';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      } else {
        orderType = 'BUY_STOP';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      }
    } else {
      if (adjustedEntry > currentPrice) {
        orderType = 'SELL_LIMIT';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      } else {
        orderType = 'SELL_STOP';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      }
    }
    
    if (Math.random() > 0.7 && orderType !== 'MARKET') {
      orderType = signalType === 'LONG' ? 'BUY_STOP_LIMIT' : 'SELL_STOP_LIMIT';
    }

    const stopLimitPrice = (orderType === 'BUY_STOP_LIMIT' || orderType === 'SELL_STOP_LIMIT') 
      ? parseFloat((adjustedEntry + (signalType === 'LONG' ? 0.00015 : -0.00015)).toFixed(5))
      : undefined;

    return {
      id: `SIG_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      type: signalType,
      symbol: '',
      entry: parseFloat(adjustedEntry.toFixed(5)),
      currentPrice: parseFloat(currentPrice.toFixed(5)),
      stop: parseFloat(stop.toFixed(5)),
      stopLimitPrice,
      targets: [
        parseFloat(target1.toFixed(5)),
        parseFloat(target2.toFixed(5)),
        parseFloat(target3.toFixed(5))
      ],
      riskReward: parseFloat(riskReward.toFixed(2)),
      confidence,
      orderType,
      executionType,
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
      rationale: rationale.join('. ') + '.',
      strategy: this.name,
      version: this.version
    };
  }
}

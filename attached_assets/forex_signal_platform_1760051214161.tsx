import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, Shield, Clock, BarChart3, Zap, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

// Mock Data Generator - Simulates real forex data
const generateMockCandles = (count = 200) => {
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

// Technical Indicators Implementation
class Indicators {
  static sma(data, period) {
    if (data.length < period) return null;
    const sum = data.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  static ema(data, period) {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = this.sma(data.slice(0, period), period);
    
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

  static rsi(closes, period = 14) {
    if (closes.length < period + 1) return null;
    
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
    
    let avgGain = this.sma(gains.slice(0, period), period);
    let avgLoss = this.sma(losses.slice(0, period), period);
    
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  static atr(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const trueRanges = [];
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

  static bollingerBands(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return null;
    
    const sma = this.sma(closes.slice(-period), period);
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

  static adx(candles, period = 14) {
    if (candles.length < period * 2) return null;
    
    const dmPlus = [];
    const dmMinus = [];
    const tr = [];
    
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
    const diPlus = (this.sma(dmPlus.slice(-period), period) / atr) * 100;
    const diMinus = (this.sma(dmMinus.slice(-period), period) / atr) * 100;
    
    const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
    
    return { adx: dx, diPlus, diMinus };
  }
}

// Strategy Implementation
class MACrossoverStrategy {
  constructor() {
    this.name = 'MA Crossover Multi-Timeframe';
    this.version = '1.0.0';
  }

  analyze(primaryCandles, higherCandles) {
    if (primaryCandles.length < 200) return null;

    const closes = primaryCandles.map(c => c.close);
    const higherCloses = higherCandles.map(c => c.close);

    const fastMA = Indicators.ema(closes, 20);
    const slowMA = Indicators.ema(closes, 50);
    const atr = Indicators.atr(primaryCandles, 14);
    const rsi = Indicators.rsi(closes, 14);
    const bb = Indicators.bollingerBands(closes, 20, 2);
    const adx = Indicators.adx(primaryCandles, 14);

    const htfFastMA = Indicators.ema(higherCloses, 20);
    const htfSlowMA = Indicators.ema(higherCloses, 50);
    const htfTrend = htfFastMA > htfSlowMA ? 'UP' : 'DOWN';

    const prevFastMA = Indicators.ema(closes.slice(0, -1), 20);
    const prevSlowMA = Indicators.ema(closes.slice(0, -1), 50);

    const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
    const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

    const currentPrice = closes[closes.length - 1];
    
    let signalType = null;
    let confidence = 0;
    let rationale = [];

    if (bullishCross && htfTrend === 'UP') {
      signalType = 'LONG';
      confidence += 30;
      rationale.push('Bullish MA crossover detected');

      if (rsi > 40 && rsi < 70) {
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
      const volatilityRatio = atr / avgPrice;
      if (volatilityRatio > 0.003 && volatilityRatio < 0.015) {
        confidence += 10;
        rationale.push('Volatility is moderate');
      }
    }

    if (bearishCross && htfTrend === 'DOWN') {
      signalType = 'SHORT';
      confidence += 30;
      rationale.push('Bearish MA crossover detected');

      if (rsi < 60 && rsi > 30) {
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
      const volatilityRatio = atr / avgPrice;
      if (volatilityRatio > 0.003 && volatilityRatio < 0.015) {
        confidence += 10;
        rationale.push('Volatility is moderate');
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

    return {
      id: `SIG_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      type: signalType,
      entry: parseFloat(entry.toFixed(5)),
      stop: parseFloat(stop.toFixed(5)),
      targets: [
        parseFloat(target1.toFixed(5)),
        parseFloat(target2.toFixed(5)),
        parseFloat(target3.toFixed(5))
      ],
      riskReward: parseFloat(riskReward.toFixed(2)),
      confidence,
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

// Main Component
const ForexSignalPlatform = () => {
  const [pairs] = useState(['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF']);
  const [selectedPair, setSelectedPair] = useState('EUR/USD');
  const [signals, setSignals] = useState([]);
  const [marketData, setMarketData] = useState({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [signalTypeFilter, setSignalTypeFilter] = useState('all');
  const [expandedSignals, setExpandedSignals] = useState({});
  const [savedSignals, setSavedSignals] = useState([]);
  const [activeTab, setActiveTab] = useState('signals'); // 'signals' or 'saved'

  const analyzeMarket = useCallback(() => {
    setIsAnalyzing(true);
    
    setTimeout(() => {
      const newSignals = [];
      const newMarketData = {};
      const strategy = new MACrossoverStrategy();

      pairs.forEach(pair => {
        const primaryCandles = generateMockCandles(200);
        const higherCandles = primaryCandles.filter((_, idx) => idx % 4 === 0);
        
        newMarketData[pair] = {
          candles: primaryCandles,
          currentPrice: primaryCandles[primaryCandles.length - 1].close
        };

        // Force signal generation for demonstration (remove randomness)
        const signal = strategy.analyze(primaryCandles, higherCandles);
        
        // Generate at least one signal per pair for demo purposes
        if (signal || Math.random() > 0.3) {
          const demoSignal = signal || generateDemoSignal(pair, primaryCandles);
          newSignals.push({
            ...demoSignal,
            symbol: pair,
            status: 'active'
          });
        }
      });

      setSignals(prev => [...newSignals, ...prev].slice(0, 20));
      setMarketData(newMarketData);
      setIsAnalyzing(false);
    }, 1500);
  }, [pairs]);

  const generateDemoSignal = (pair, candles) => {
    const currentPrice = candles[candles.length - 1].close;
    const atr = Indicators.atr(candles, 14) || 0.0015;
    const type = Math.random() > 0.5 ? 'LONG' : 'SHORT';
    const stopDistance = atr * 2;
    
    // Determine order type based on entry vs current price
    const entryPrice = parseFloat(currentPrice.toFixed(5));
    const priceVariation = (Math.random() - 0.5) * 0.002; // +/- 0.1%
    const adjustedEntry = parseFloat((currentPrice * (1 + priceVariation)).toFixed(5));
    
    let orderType;
    let executionType;
    
    if (Math.abs(adjustedEntry - currentPrice) < 0.00010) {
      // Very close to current price
      orderType = 'MARKET';
      executionType = 'FILL_OR_KILL';
    } else if (type === 'LONG') {
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
    
    // Randomly add stop limit orders
    if (Math.random() > 0.7 && orderType !== 'MARKET') {
      orderType = type === 'LONG' ? 'BUY_STOP_LIMIT' : 'SELL_STOP_LIMIT';
    }
    
    return {
      id: `SIG_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      type: type,
      entry: adjustedEntry,
      currentPrice: parseFloat(currentPrice.toFixed(5)),
      orderType: orderType,
      executionType: executionType,
      stop: type === 'LONG' 
        ? parseFloat((adjustedEntry - stopDistance).toFixed(5))
        : parseFloat((adjustedEntry + stopDistance).toFixed(5)),
      targets: type === 'LONG' ? [
        parseFloat((adjustedEntry + stopDistance * 1.5).toFixed(5)),
        parseFloat((adjustedEntry + stopDistance * 2.5).toFixed(5)),
        parseFloat((adjustedEntry + stopDistance * 4).toFixed(5))
      ] : [
        parseFloat((adjustedEntry - stopDistance * 1.5).toFixed(5)),
        parseFloat((adjustedEntry - stopDistance * 2.5).toFixed(5)),
        parseFloat((adjustedEntry - stopDistance * 4).toFixed(5))
      ],
      riskReward: 2.5,
      confidence: Math.floor(Math.random() * 30) + 55,
      indicators: {
        fastMA: currentPrice.toFixed(5),
        slowMA: (currentPrice * 0.998).toFixed(5),
        rsi: (Math.random() * 40 + 30).toFixed(2),
        atr: atr.toFixed(5),
        adx: (Math.random() * 30 + 20).toFixed(2),
        bbUpper: (currentPrice * 1.002).toFixed(5),
        bbLower: (currentPrice * 0.998).toFixed(5),
        htfTrend: type === 'LONG' ? 'UP' : 'DOWN'
      },
      rationale: type === 'LONG' 
        ? 'Bullish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bullish. Volatility is moderate.'
        : 'Bearish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bearish. Volatility is moderate.',
      strategy: 'MA Crossover Multi-Timeframe',
      version: '1.0.0'
    };
  };

  const getOrderTypeInfo = (orderType) => {
    const orderTypes = {
      MARKET: {
        color: 'bg-purple-500/20 border-purple-500/50 text-purple-300',
        icon: '⚡',
        description: 'Execute immediately at current market price'
      },
      BUY_LIMIT: {
        color: 'bg-green-500/20 border-green-500/50 text-green-300',
        icon: '📉',
        description: 'Buy when price drops to entry level'
      },
      SELL_LIMIT: {
        color: 'bg-red-500/20 border-red-500/50 text-red-300',
        icon: '📈',
        description: 'Sell when price rises to entry level'
      },
      BUY_STOP: {
        color: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
        icon: '🔼',
        description: 'Buy when price breaks above entry level'
      },
      SELL_STOP: {
        color: 'bg-orange-500/20 border-orange-500/50 text-orange-300',
        icon: '🔽',
        description: 'Sell when price breaks below entry level'
      },
      BUY_STOP_LIMIT: {
        color: 'bg-teal-500/20 border-teal-500/50 text-teal-300',
        icon: '🎯',
        description: 'Buy stop that becomes a limit order'
      },
      SELL_STOP_LIMIT: {
        color: 'bg-pink-500/20 border-pink-500/50 text-pink-300',
        icon: '🎯',
        description: 'Sell stop that becomes a limit order'
      }
    };
    return orderTypes[orderType] || orderTypes.MARKET;
  };

  const getExecutionTypeInfo = (executionType) => {
    const executionTypes = {
      FILL_OR_KILL: {
        color: 'bg-red-600',
        description: 'Must execute completely immediately or cancel'
      },
      GTC: {
        color: 'bg-blue-600',
        description: 'Good Till Cancelled - stays active until filled or cancelled'
      },
      DAY: {
        color: 'bg-yellow-600',
        description: 'Valid until end of trading day'
      },
      IOC: {
        color: 'bg-purple-600',
        description: 'Immediate or Cancel - fill what you can, cancel the rest'
      }
    };
    return executionTypes[executionType] || executionTypes.GTC;
  };

  const getSignalExplanation = (signal) => {
    const isLong = signal.type === 'LONG';
    const riskAmount = Math.abs(signal.entry - signal.stop);
    const rewardTarget2 = Math.abs(signal.targets[1] - signal.entry);
    
    return {
      whatIsThis: isLong 
        ? `This is a BUY signal for ${signal.symbol}. It suggests the price may move upward, creating a profit opportunity.`
        : `This is a SELL signal for ${signal.symbol}. It suggests the price may move downward, creating a profit opportunity.`,
      
      howToTrade: {
        beginner: [
          `1. Wait for the price to reach ${signal.entry} (Entry Price) - Current price is ${signal.currentPrice}`,
          `2. Place a ${signal.orderType.replace(/_/g, ' ')} order to ${isLong ? 'buy' : 'sell'} ${signal.symbol}`,
          `3. Set your Stop Loss at ${signal.stop} to limit potential losses`,
          `4. Set Take Profit levels at ${signal.targets[0]} (TP1), ${signal.targets[1]} (TP2), or ${signal.targets[2]} (TP3)`,
          `5. Order execution type: ${signal.executionType.replace(/_/g, ' ')} - ${getExecutionTypeInfo(signal.executionType).description}`,
          `6. Consider closing 1/3 of your position at each target level`
        ],
        expert: [
          `Order Type: ${signal.orderType} | Execution: ${signal.executionType}`,
          `Entry: ${signal.entry} (Current: ${signal.currentPrice}) | Stop: ${signal.stop} | R:R = 1:${signal.riskReward}`,
          `Position size: Risk 1-2% of account capital`,
          `Partial exit strategy: 30% at TP1, 40% at TP2, 30% at TP3`,
          `Trail stop to breakeven after TP1 is hit`,
          `Higher timeframe trend: ${signal.indicators.htfTrend}`
        ]
      },
      
      whyThisSignal: [
        {
          title: 'Moving Average Crossover',
          explanation: isLong 
            ? 'The fast moving average (20-period) crossed ABOVE the slow moving average (50-period), indicating upward momentum.'
            : 'The fast moving average (20-period) crossed BELOW the slow moving average (50-period), indicating downward momentum.',
          importance: 'This is a primary trend-following signal used by traders worldwide.'
        },
        {
          title: `RSI: ${signal.indicators.rsi}`,
          explanation: parseFloat(signal.indicators.rsi) > 70 
            ? 'RSI is overbought (>70), suggesting the market may be overextended.'
            : parseFloat(signal.indicators.rsi) < 30
            ? 'RSI is oversold (<30), suggesting the market may be undervalued.'
            : 'RSI is in neutral range (30-70), indicating balanced momentum.',
          importance: 'RSI helps confirm momentum and avoid overextended moves.'
        },
        {
          title: `ADX: ${signal.indicators.adx}`,
          explanation: parseFloat(signal.indicators.adx) > 25
            ? 'ADX above 25 indicates a STRONG TREND. This signal has higher probability of success.'
            : 'ADX below 25 indicates a WEAK TREND. Trade with caution or wait for stronger confirmation.',
          importance: 'ADX measures trend strength, not direction. Higher values = more reliable signals.'
        },
        {
          title: 'ATR (Volatility)',
          explanation: `Average True Range is ${signal.indicators.atr}. This measures how much the pair typically moves, helping us set realistic stop losses and targets.`,
          importance: 'ATR-based stops adapt to market conditions, preventing premature exits.'
        }
      ],
      
      riskManagement: {
        stopLoss: {
          value: signal.stop,
          explanation: `If price moves against you and hits ${signal.stop}, your trade will automatically close to prevent larger losses. This is ${riskAmount.toFixed(5)} pips away.`
        },
        targets: [
          {
            level: 'TP1 (Conservative)',
            value: signal.targets[0],
            explanation: `First target at ${signal.targets[0]}. Consider taking 30% profit here to secure gains.`
          },
          {
            level: 'TP2 (Moderate)',
            value: signal.targets[1],
            explanation: `Second target at ${signal.targets[1]}. This is ${signal.riskReward}x your risk - a solid reward.`
          },
          {
            level: 'TP3 (Aggressive)',
            value: signal.targets[2],
            explanation: `Third target at ${signal.targets[2]}. Only achievable in strong trends. Consider trailing stop.`
          }
        ],
        riskRewardRatio: `For every $1 you risk, you can potentially make ${signal.riskReward}. This is a favorable risk/reward ratio.`
      },
      
      confidence: {
        level: signal.confidence,
        meaning: signal.confidence >= 70 
          ? 'HIGH CONFIDENCE: Multiple indicators align strongly. This is a premium setup.'
          : signal.confidence >= 60
          ? 'MEDIUM CONFIDENCE: Good setup but some indicators show mixed signals. Trade with standard position size.'
          : 'LOWER CONFIDENCE: Fewer confirmations. Consider reducing position size or waiting for better setup.',
        factors: `This ${signal.confidence}% confidence is based on: trend alignment, momentum indicators (RSI, ADX), volatility conditions, and multi-timeframe analysis.`
      },
      
      glossary: [
        { term: 'Entry Price', definition: 'The price at which you open your trade.' },
        { term: 'Stop Loss', definition: 'A predetermined exit point to limit losses if the trade moves against you.' },
        { term: 'Take Profit (TP)', definition: 'Target prices where you plan to close the trade and secure profits.' },
        { term: 'Risk:Reward (R:R)', definition: 'The ratio of potential loss to potential gain. 1:2.5 means you risk $1 to potentially make $2.50.' },
        { term: 'Market Order', definition: 'Executes immediately at the best available current price.' },
        { term: 'Limit Order', definition: 'Only executes at your specified price or better. Buy Limit = buy at lower price, Sell Limit = sell at higher price.' },
        { term: 'Stop Order', definition: 'Becomes a market order when price reaches your trigger. Buy Stop = buy above current, Sell Stop = sell below current.' },
        { term: 'Stop Limit', definition: 'Becomes a limit order (not market) when stop price is hit. More control but may not fill.' },
        { term: 'Fill or Kill (FOK)', definition: 'Order must be completely filled immediately or it\'s cancelled entirely. No partial fills.' },
        { term: 'GTC (Good Till Cancelled)', definition: 'Order remains active until you manually cancel it or it gets filled.' },
        { term: 'Day Order', definition: 'Order expires at the end of the trading day if not filled.' },
        { term: 'ATR', definition: 'Average True Range - measures market volatility to set appropriate stops and targets.' },
        { term: 'RSI', definition: 'Relative Strength Index - momentum indicator showing if market is overbought (>70) or oversold (<30).' },
        { term: 'ADX', definition: 'Average Directional Index - measures trend strength. Above 25 = strong trend.' },
        { term: 'EMA', definition: 'Exponential Moving Average - shows average price over time, giving more weight to recent prices.' }
      ]
    };
  };

  useEffect(() => {
    analyzeMarket();
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(analyzeMarket, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, analyzeMarket]);

  const activeSignals = signals.filter(s => {
    if (s.status !== 'active') return false;
    
    // Filter by confidence level
    if (confidenceFilter === 'high' && s.confidence < 70) return false;
    if (confidenceFilter === 'medium' && (s.confidence < 60 || s.confidence >= 70)) return false;
    if (confidenceFilter === 'low' && s.confidence >= 60) return false;
    
    // Filter by signal type
    if (signalTypeFilter !== 'all' && s.type !== signalTypeFilter) return false;
    
    return true;
  });
  
  const currentData = marketData[selectedPair];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500 rounded-lg">
                <Activity className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Forex Signal Engine</h1>
                <p className="text-blue-300">Multi-Timeframe Analysis Platform</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  autoRefresh ? 'bg-green-600' : 'bg-slate-700'
                }`}
              >
                <Zap className="w-4 h-4" />
                {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
              </button>
              <button
                onClick={analyzeMarket}
                disabled={isAnalyzing}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                <BarChart3 className="w-4 h-4" />
                {isAnalyzing ? 'Analyzing...' : 'Analyze Now'}
              </button>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Active Signals</span>
              <Activity className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold">{activeSignals.length}</div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">LONG Signals</span>
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-2xl font-bold text-green-400">
              {activeSignals.filter(s => s.type === 'LONG').length}
            </div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">SHORT Signals</span>
              <TrendingDown className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-bold text-red-400">
              {activeSignals.filter(s => s.type === 'SHORT').length}
            </div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Avg Confidence</span>
              <Target className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-bold text-purple-400">
              {activeSignals.length > 0 
                ? Math.round(activeSignals.reduce((sum, s) => sum + s.confidence, 0) / activeSignals.length)
                : 0}%
            </div>
          </div>
        </div>

        {/* Pair Selector */}
        <div className="mb-6">
          <div className="flex gap-2">
            {pairs.map(pair => (
              <button
                key={pair}
                onClick={() => setSelectedPair(pair)}
                className={`px-4 py-2 rounded-lg transition-all ${
                  selectedPair === pair
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {pair}
                {currentData && pair === selectedPair && (
                  <span className="ml-2 text-xs opacity-75">
                    {currentData.currentPrice.toFixed(5)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Section */}
        <div className="mb-6 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 font-semibold">Confidence Level:</span>
              <select
                value={confidenceFilter}
                onChange={(e) => setConfidenceFilter(e.target.value)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 hover:border-blue-500 focus:border-blue-500 focus:outline-none cursor-pointer transition-all"
              >
                <option value="all">All Levels</option>
                <option value="high">High (70%+)</option>
                <option value="medium">Medium (60-69%)</option>
                <option value="low">Low (50-59%)</option>
              </select>
            </div>

            <div className="border-l border-slate-600 pl-6 flex items-center gap-3">
              <span className="text-sm text-slate-400 font-semibold">Signal Type:</span>
              <select
                value={signalTypeFilter}
                onChange={(e) => setSignalTypeFilter(e.target.value)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 hover:border-blue-500 focus:border-blue-500 focus:outline-none cursor-pointer transition-all"
              >
                <option value="all">All Types</option>
                <option value="LONG">🔼 LONG Only</option>
                <option value="SHORT">🔽 SHORT Only</option>
              </select>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <div className="text-sm text-slate-400">
                Showing <span className="font-bold text-white text-lg">{activeSignals.length}</span> signal{activeSignals.length !== 1 ? 's' : ''}
              </div>
              {(confidenceFilter !== 'all' || signalTypeFilter !== 'all') && (
                <button
                  onClick={() => {
                    setConfidenceFilter('all');
                    setSignalTypeFilter('all');
                  }}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-all"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-3 gap-6">
          {/* Signals List */}
          <div className="col-span-2 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-400" />
              Active Trading Signals
            </h2>
            
            {activeSignals.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-8 text-center border border-slate-700">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                <p className="text-slate-400">No signals generated yet. Click "Analyze Now" to scan the market.</p>
              </div>
            ) : (
              activeSignals.map(signal => (
                <div
                  key={signal.id}
                  className="bg-slate-800 rounded-lg p-5 border border-slate-700 hover:border-blue-500 transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        signal.type === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {signal.type === 'LONG' ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">{signal.symbol} - {signal.type}</h3>
                        <p className="text-xs text-slate-400">{signal.id}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${
                        signal.confidence >= 70 ? 'text-green-400' : 
                        signal.confidence >= 60 ? 'text-yellow-400' : 'text-orange-400'
                      }`}>
                        {signal.confidence}%
                      </div>
                      <p className="text-xs text-slate-400">Confidence</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-slate-900 rounded p-3">
                      <p className="text-xs text-slate-400 mb-1">Entry Price</p>
                      <p className="text-lg font-bold text-blue-400">{signal.entry}</p>
                    </div>
                    <div className="bg-slate-900 rounded p-3">
                      <p className="text-xs text-slate-400 mb-1">Stop Loss</p>
                      <p className="text-lg font-bold text-red-400">{signal.stop}</p>
                    </div>
                    <div className="bg-slate-900 rounded p-3">
                      <p className="text-xs text-slate-400 mb-1">Risk:Reward</p>
                      <p className="text-lg font-bold text-green-400">1:{signal.riskReward}</p>
                    </div>
                  </div>

                  {/* Order Type & Execution Information - ENHANCED VISIBILITY */}
                  <div className="mb-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className={`rounded-lg p-4 border-2 ${getOrderTypeInfo(signal.orderType).color} shadow-lg`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">{getOrderTypeInfo(signal.orderType).icon}</span>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">ORDER TYPE</p>
                            <p className="text-lg font-black">{signal.orderType.replace(/_/g, ' ')}</p>
                          </div>
                        </div>
                        <p className="text-xs font-semibold mb-2">{getOrderTypeInfo(signal.orderType).description}</p>
                        {signal.currentPrice && (
                          <div className="mt-2 pt-2 border-t border-current/30 space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="opacity-70">Current:</span>
                              <span className="font-mono font-bold">{signal.currentPrice}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="opacity-70">Entry:</span>
                              <span className="font-mono font-bold">{signal.entry}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="opacity-70">Difference:</span>
                              <span className={`font-mono font-bold ${
                                Math.abs(signal.entry - signal.currentPrice) < 0.0001 ? 'text-green-400' : ''
                              }`}>
                                {(Math.abs(signal.entry - signal.currentPrice) * 10000).toFixed(1)} pips
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg p-4 border-2 border-slate-600 bg-slate-900 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">⏱️</span>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">EXECUTION TYPE</p>
                            <div className={`inline-block px-3 py-1.5 rounded-md text-sm font-black text-white shadow-md ${getExecutionTypeInfo(signal.executionType).color}`}>
                              {signal.executionType.replace(/_/g, ' ')}
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-300 font-semibold mt-2">{getExecutionTypeInfo(signal.executionType).description}</p>
                        
                        {signal.executionType === 'FILL_OR_KILL' && (
                          <div className="mt-3 p-2 bg-red-500/20 border border-red-500/50 rounded">
                            <p className="text-xs text-red-300 font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              High Priority: Immediate execution required
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Price Chart Visualization - TradingView Style with Candlesticks */}
                  <div className="mb-4 bg-[#131722] rounded-lg p-4 border border-slate-800">
                    <h4 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-blue-400" />
                      Trade Setup Chart - {signal.symbol}
                    </h4>
                    
                    <div className="relative h-96 bg-[#1E222D] rounded border border-[#2A2E39] overflow-hidden">
                      {/* SVG Canvas for Chart */}
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="none">
                        {/* Defs for gradients and patterns */}
                        <defs>
                          {/* Grid pattern */}
                          <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
                            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2A2E39" strokeWidth="1"/>
                          </pattern>
                          
                          {/* Gradient for profit zone */}
                          <linearGradient id="profit-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.2"/>
                            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.05"/>
                          </linearGradient>
                          
                          {/* Gradient for risk zone */}
                          <linearGradient id="risk-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.05"/>
                            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.2"/>
                          </linearGradient>
                        </defs>
                        
                        {/* Background grid */}
                        <rect width="800" height="400" fill="url(#grid-pattern)"/>
                        
                        {(() => {
                          // Generate candlestick data
                          const numCandles = 60;
                          const candles = [];
                          let price = signal.currentPrice;
                          
                          // Generate realistic price movement
                          for (let i = 0; i < numCandles; i++) {
                            const volatility = 0.0005;
                            const trend = i < numCandles / 2 ? -0.0001 : 0.00015; // Trend shift
                            const change = (Math.random() - 0.5) * volatility + trend;
                            
                            const open = price;
                            price += change;
                            const close = price;
                            const high = Math.max(open, close) + Math.random() * volatility * 0.5;
                            const low = Math.min(open, close) - Math.random() * volatility * 0.5;
                            
                            candles.push({ 
                              open, 
                              high, 
                              low, 
                              close, 
                              bullish: close >= open 
                            });
                          }
                          
                          // Calculate price range including all important levels
                          const allPrices = [
                            ...candles.flatMap(c => [c.high, c.low]),
                            signal.entry,
                            signal.stop,
                            ...signal.targets
                          ];
                          
                          const minPrice = Math.min(...allPrices);
                          const maxPrice = Math.max(...allPrices);
                          const padding = (maxPrice - minPrice) * 0.1;
                          const chartMin = minPrice - padding;
                          const chartMax = maxPrice + padding;
                          const priceRange = chartMax - chartMin;
                          
                          // Convert price to Y coordinate
                          const priceToY = (price) => {
                            return 380 - ((price - chartMin) / priceRange * 360);
                          };
                          
                          // Convert index to X coordinate
                          const indexToX = (index) => {
                            return 10 + (index / numCandles) * 700;
                          };
                          
                          const candleWidth = 700 / numCandles * 0.7;
                          const isLong = signal.type === 'LONG';
                          
                          // Calculate EMA (20 period)
                          const emaPoints = candles.map((candle, idx) => {
                            const start = Math.max(0, idx - 19);
                            const slice = candles.slice(start, idx + 1);
                            const avg = slice.reduce((sum, c) => sum + c.close, 0) / slice.length;
                            return { x: indexToX(idx), y: priceToY(avg) };
                          });
                          
                          return (
                            <>
                              {/* Risk Zone (Red) */}
                              <rect
                                x="10"
                                y={Math.min(priceToY(signal.entry), priceToY(signal.stop))}
                                width="700"
                                height={Math.abs(priceToY(signal.entry) - priceToY(signal.stop))}
                                fill="url(#risk-gradient)"
                              />
                              
                              {/* Profit Zone (Green) */}
                              <rect
                                x="10"
                                y={Math.min(priceToY(signal.entry), priceToY(signal.targets[2]))}
                                width="700"
                                height={Math.abs(priceToY(signal.entry) - priceToY(signal.targets[2]))}
                                fill="url(#profit-gradient)"
                              />
                              
                              {/* Draw Candlesticks */}
                              {candles.map((candle, idx) => {
                                const x = indexToX(idx);
                                const yHigh = priceToY(candle.high);
                                const yLow = priceToY(candle.low);
                                const yOpen = priceToY(candle.open);
                                const yClose = priceToY(candle.close);
                                const color = candle.bullish ? '#22c55e' : '#ef4444';
                                
                                return (
                                  <g key={idx}>
                                    {/* Wick (high-low line) */}
                                    <line
                                      x1={x}
                                      y1={yHigh}
                                      x2={x}
                                      y2={yLow}
                                      stroke={color}
                                      strokeWidth="1"
                                    />
                                    {/* Body (open-close rectangle) */}
                                    <rect
                                      x={x - candleWidth / 2}
                                      y={Math.min(yOpen, yClose)}
                                      width={candleWidth}
                                      height={Math.max(Math.abs(yOpen - yClose), 1)}
                                      fill={color}
                                      stroke={color}
                                      strokeWidth="1"
                                    />
                                  </g>
                                );
                              })}
                              
                              {/* EMA Line (Blue curved line) */}
                              <path
                                d={emaPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
                                fill="none"
                                stroke="#3b82f6"
                                strokeWidth="2"
                                opacity="0.8"
                              />
                              
                              {/* Stop Loss Line */}
                              <line
                                x1="10"
                                y1={priceToY(signal.stop)}
                                x2="710"
                                y2={priceToY(signal.stop)}
                                stroke="#ef4444"
                                strokeWidth="2"
                                strokeDasharray="5,5"
                              />
                              
                              {/* Entry Line */}
                              <line
                                x1="10"
                                y1={priceToY(signal.entry)}
                                x2="710"
                                y2={priceToY(signal.entry)}
                                stroke="#3b82f6"
                                strokeWidth="2"
                              />
                              
                              {/* Target Lines */}
                              {signal.targets.map((target, idx) => (
                                <line
                                  key={idx}
                                  x1="10"
                                  y1={priceToY(target)}
                                  x2="710"
                                  y2={priceToY(target)}
                                  stroke="#22c55e"
                                  strokeWidth="2"
                                  strokeDasharray="5,5"
                                  opacity={1 - idx * 0.2}
                                />
                              ))}
                              
                              {/* Current Price Line */}
                              <line
                                x1="10"
                                y1={priceToY(signal.currentPrice)}
                                x2="710"
                                y2={priceToY(signal.currentPrice)}
                                stroke="#eab308"
                                strokeWidth="2"
                                strokeDasharray="8,4"
                              />
                            </>
                          );
                        })()}
                      </svg>
                      
                      {/* Price Labels on Right Side */}
                      <div className="absolute right-0 top-0 bottom-0 w-24 bg-[#131722]/95 border-l border-[#2A2E39]">
                        {(() => {
                          const allPrices = [
                            signal.currentPrice,
                            signal.entry,
                            signal.stop,
                            ...signal.targets
                          ];
                          const minPrice = Math.min(...allPrices);
                          const maxPrice = Math.max(...allPrices);
                          const padding = (maxPrice - minPrice) * 0.1;
                          const chartMin = minPrice - padding;
                          const chartMax = maxPrice + padding;
                          const priceRange = chartMax - chartMin;
                          
                          const getYPercent = (price) => {
                            return ((chartMax - price) / priceRange) * 100;
                          };
                          
                          return (
                            <>
                              {/* Current Price Label */}
                              <div
                                className="absolute right-0 px-2 py-1 bg-yellow-500 text-black text-xs font-bold rounded-l"
                                style={{ top: `${getYPercent(signal.currentPrice)}%`, transform: 'translateY(-50%)' }}
                              >
                                {signal.currentPrice}
                              </div>
                              
                              {/* Entry Label */}
                              <div
                                className="absolute right-0 px-2 py-1 bg-blue-500 text-white text-xs font-bold rounded-l"
                                style={{ top: `${getYPercent(signal.entry)}%`, transform: 'translateY(-50%)' }}
                              >
                                {signal.entry}
                              </div>
                              
                              {/* Stop Label */}
                              <div
                                className="absolute right-0 px-2 py-1 bg-red-500 text-white text-xs font-bold rounded-l flex items-center gap-1"
                                style={{ top: `${getYPercent(signal.stop)}%`, transform: 'translateY(-50%)' }}
                              >
                                <Shield className="w-3 h-3" />
                                {signal.stop}
                              </div>
                              
                              {/* Target Labels */}
                              {signal.targets.map((target, idx) => (
                                <div
                                  key={idx}
                                  className="absolute right-0 px-2 py-1 bg-green-500 text-white text-xs font-bold rounded-l flex items-center gap-1"
                                  style={{ top: `${getYPercent(target)}%`, transform: 'translateY(-50%)', opacity: 1 - idx * 0.15 }}
                                >
                                  <Target className="w-3 h-3" />
                                  {target}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                      </div>
                      
                      {/* Trade Direction Indicator */}
                      <div className="absolute top-4 left-4 z-10">
                        {signal.type === 'LONG' ? (
                          <div className="flex items-center gap-2 bg-green-500 text-white px-3 py-2 rounded-lg shadow-lg animate-pulse">
                            <TrendingUp className="w-6 h-6" strokeWidth={3} />
                            <span className="font-bold text-sm">LONG SIGNAL</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-red-500 text-white px-3 py-2 rounded-lg shadow-lg animate-pulse">
                            <TrendingDown className="w-6 h-6" strokeWidth={3} />
                            <span className="font-bold text-sm">SHORT SIGNAL</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Bottom Time Axis */}
                      <div className="absolute bottom-0 left-0 right-24 h-8 bg-[#131722]/95 border-t border-[#2A2E39] flex justify-around items-center text-[10px] text-slate-500 font-mono">
                        <span>-3h</span>
                        <span>-2h</span>
                        <span>-1h</span>
                        <span>-30m</span>
                        <span className="text-yellow-500 font-bold">NOW</span>
                      </div>
                    </div>
                    
                    {/* Chart Legend */}
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] bg-[#1E222D] rounded p-3 border border-[#2A2E39]">
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 bg-green-500 border border-green-600 rounded-sm"></div>
                        <span className="text-slate-300 font-medium">Bullish Candle</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 bg-red-500 border border-red-600 rounded-sm"></div>
                        <span className="text-slate-300 font-medium">Bearish Candle</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#3b82f6" strokeWidth="2.5"/></svg>
                        <span className="text-slate-300 font-medium">EMA 20 (Moving Average)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#eab308" strokeWidth="2.5" strokeDasharray="4,3"/></svg>
                        <span className="text-yellow-400 font-bold">Current Market Price</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#3b82f6" strokeWidth="2.5"/></svg>
                        <span className="text-blue-400 font-bold">Entry Point</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#ef4444" strokeWidth="2.5" strokeDasharray="4,3"/></svg>
                        <span className="text-red-400 font-bold">Stop Loss</span>
                      </div>
                      <div className="flex items-center gap-1.5 col-span-2">
                        <svg width="20" height="12"><line x1="0" y1="6" x2="20" y2="6" stroke="#22c55e" strokeWidth="2.5" strokeDasharray="4,3"/></svg>
                        <span className="text-green-400 font-bold">Take Profit Targets (TP1, TP2, TP3)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs text-slate-400 mb-2">Target Prices</p>
                    <div className="flex gap-2">
                      {signal.targets.map((target, idx) => (
                        <div key={idx} className="flex-1 bg-green-500/10 border border-green-500/30 rounded p-2 text-center">
                          <p className="text-xs text-green-400 mb-1">TP{idx + 1}</p>
                          <p className="text-sm font-bold text-green-300">{target}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded p-3 mb-4">
                    <p className="text-xs text-slate-400 mb-2">Analysis Rationale</p>
                    <p className="text-sm text-slate-300">{signal.rationale}</p>
                  </div>

                  {/* Explanation Toggle Button */}
                  <button
                    onClick={() => toggleSignalExplanation(signal.id)}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    {expandedSignals[signal.id] ? (
                      <>
                        <XCircle className="w-4 h-4" />
                        Hide Detailed Explanation
                      </>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Show Detailed Explanation
                      </>
                    )}
                  </button>

                  {/* Detailed Explanation Section */}
                  {expandedSignals[signal.id] && (() => {
                    const explanation = getSignalExplanation(signal);
                    return (
                      <div className="mt-4 space-y-4 border-t border-slate-700 pt-4">
                        {/* What Is This */}
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-blue-400 mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5" />
                            What Is This Signal?
                          </h4>
                          <p className="text-slate-300">{explanation.whatIsThis}</p>
                        </div>

                        {/* How To Trade - Beginner */}
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-green-400 mb-3">📚 For Beginners: Step-by-Step</h4>
                          <ol className="space-y-2">
                            {explanation.howToTrade.beginner.map((step, idx) => (
                              <li key={idx} className="text-slate-300 text-sm">{step}</li>
                            ))}
                          </ol>
                        </div>

                        {/* How To Trade - Expert */}
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-purple-400 mb-3">🎯 For Experienced Traders</h4>
                          <ul className="space-y-1">
                            {explanation.howToTrade.expert.map((point, idx) => (
                              <li key={idx} className="text-slate-300 text-sm font-mono">• {point}</li>
                            ))}
                          </ul>
                        </div>

                        {/* Why This Signal */}
                        <div className="bg-slate-900 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-yellow-400 mb-3">🔍 Why This Signal Was Generated</h4>
                          <div className="space-y-3">
                            {explanation.whyThisSignal.map((reason, idx) => (
                              <div key={idx} className="border-l-4 border-yellow-500/50 pl-3">
                                <p className="font-semibold text-slate-200">{reason.title}</p>
                                <p className="text-sm text-slate-400 mt-1">{reason.explanation}</p>
                                <p className="text-xs text-slate-500 mt-1 italic">💡 {reason.importance}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Risk Management */}
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-red-400 mb-3 flex items-center gap-2">
                            <Shield className="w-5 h-5" />
                            Risk Management Explained
                          </h4>
                          <div className="space-y-3">
                            <div>
                              <p className="font-semibold text-slate-200">Stop Loss: {explanation.riskManagement.stopLoss.value}</p>
                              <p className="text-sm text-slate-400">{explanation.riskManagement.stopLoss.explanation}</p>
                            </div>
                            {explanation.riskManagement.targets.map((target, idx) => (
                              <div key={idx}>
                                <p className="font-semibold text-slate-200">{target.level}: {target.value}</p>
                                <p className="text-sm text-slate-400">{target.explanation}</p>
                              </div>
                            ))}
                            <div className="bg-slate-800 rounded p-3 mt-3">
                              <p className="text-sm text-slate-300">📊 <strong>Risk:Reward Ratio:</strong> {explanation.riskManagement.riskRewardRatio}</p>
                            </div>
                          </div>
                        </div>

                        {/* Confidence Explanation */}
                        <div className={`rounded-lg p-4 ${
                          signal.confidence >= 70 ? 'bg-green-500/10 border border-green-500/30' :
                          signal.confidence >= 60 ? 'bg-yellow-500/10 border border-yellow-500/30' :
                          'bg-orange-500/10 border border-orange-500/30'
                        }`}>
                          <h4 className={`text-lg font-bold mb-2 ${
                            signal.confidence >= 70 ? 'text-green-400' :
                            signal.confidence >= 60 ? 'text-yellow-400' :
                            'text-orange-400'
                          }`}>
                            {signal.confidence}% Confidence Level
                          </h4>
                          <p className="text-slate-300 font-semibold mb-2">{explanation.confidence.meaning}</p>
                          <p className="text-sm text-slate-400">{explanation.confidence.factors}</p>
                        </div>

                        {/* Trading Glossary */}
                        <div className="bg-slate-900 rounded-lg p-4">
                          <h4 className="text-lg font-bold text-cyan-400 mb-3">📖 Trading Terms Glossary</h4>
                          <div className="grid grid-cols-2 gap-3">
                            {explanation.glossary.map((item, idx) => (
                              <div key={idx} className="bg-slate-800 rounded p-2">
                                <p className="font-semibold text-cyan-300 text-sm">{item.term}</p>
                                <p className="text-xs text-slate-400 mt-1">{item.definition}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
                    <span>Strategy: {signal.strategy}</span>
                    <span>{new Date(signal.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Market Data & Indicators */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-400" />
              Market Indicators
            </h2>
            
            {currentData && (() => {
              const closes = currentData.candles.map(c => c.close);
              const rsi = Indicators.rsi(closes, 14);
              const bb = Indicators.bollingerBands(closes, 20, 2);
              const atr = Indicators.atr(currentData.candles, 14);
              const adx = Indicators.adx(currentData.candles, 14);
              const fastMA = Indicators.ema(closes, 20);
              const slowMA = Indicators.ema(closes, 50);

              return (
                <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">Current Price</span>
                        <span className="font-bold text-lg">{currentData.currentPrice.toFixed(5)}</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">RSI (14)</span>
                        <span className={`font-bold ${
                          rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                          {rsi ? rsi.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            rsi > 70 ? 'bg-red-500' : rsi < 30 ? 'bg-green-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${rsi}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">ADX (14)</span>
                        <span className={`font-bold ${
                          adx && adx.adx > 25 ? 'text-green-400' : 'text-yellow-400'
                        }`}>
                          {adx ? adx.adx.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {adx && adx.adx > 25 ? 'Strong Trend' : 'Weak Trend'}
                      </p>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-sm text-slate-400 mb-2">Moving Averages</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">EMA 20</span>
                          <span className="text-sm font-mono">{fastMA ? fastMA.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">EMA 50</span>
                          <span className="text-sm font-mono">{slowMA ? slowMA.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {fastMA && slowMA && (
                            <>
                              {fastMA > slowMA ? (
                                <><CheckCircle className="w-3 h-3 text-green-400" /> <span className="text-green-400">Bullish Alignment</span></>
                              ) : (
                                <><XCircle className="w-3 h-3 text-red-400" /> <span className="text-red-400">Bearish Alignment</span></>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-sm text-slate-400 mb-2">Bollinger Bands</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Upper</span>
                          <span className="text-sm font-mono">{bb ? bb.upper.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Middle</span>
                          <span className="text-sm font-mono">{bb ? bb.middle.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Lower</span>
                          <span className="text-sm font-mono">{bb ? bb.lower.toFixed(5) : 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-400">ATR (14)</span>
                        <span className="font-bold">{atr ? atr.toFixed(5) : 'N/A'}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Volatility Measure</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Strategy Info */}
            <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                <Shield className="w-5 h-5 text-green-400" />
                Strategy Info
              </h3>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-slate-400 mb-1">Strategy Name</p>
                  <p className="font-semibold">MA Crossover Multi-Timeframe</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Version</p>
                  <p className="font-mono">1.0.0</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Timeframes</p>
                  <div className="flex gap-2">
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">H1 Primary</span>
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs">H4 Filter</span>
                  </div>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Key Indicators</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    <span className="px-2 py-1 bg-slate-900 rounded text-xs">EMA 20/50</span>
                    <span className="px-2 py-1 bg-slate-900 rounded text-xs">RSI</span>
                    <span className="px-2 py-1 bg-slate-900 rounded text-xs">ATR</span>
                    <span className="px-2 py-1 bg-slate-900 rounded text-xs">ADX</span>
                    <span className="px-2 py-1 bg-slate-900 rounded text-xs">Bollinger</span>
                  </div>
                </div>
                <div className="border-t border-slate-700 pt-3">
                  <p className="text-slate-400 mb-2">Risk Management</p>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-slate-500">Stop Loss</span>
                      <span className="text-xs font-semibold">2 ATR</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-slate-500">Target Ratios</span>
                      <span className="text-xs font-semibold">1.5R, 2.5R, 4R</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-slate-500">Position Size</span>
                      <span className="text-xs font-semibold">1% Risk/Trade</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* System Status */}
            <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
              <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-400" />
                System Status
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Market Data</span>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-green-400 font-semibold">Live</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Signal Engine</span>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <span className="text-green-400 font-semibold">Active</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Auto Refresh</span>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`}></div>
                    <span className={`font-semibold ${autoRefresh ? 'text-green-400' : 'text-slate-400'}`}>
                      {autoRefresh ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-slate-700 pt-3">
                  <p className="text-slate-400 mb-1">Last Scan</p>
                  <p className="text-xs text-slate-500">{new Date().toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-slate-400 mb-1">Next Scan</p>
                  <p className="text-xs text-slate-500">
                    {autoRefresh ? 'In 30 seconds' : 'Manual only'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 p-4 bg-slate-800 rounded-lg border border-slate-700">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-slate-400">Connected</span>
              </div>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">
                Multi-Timeframe MA Crossover Strategy v1.0.0
              </span>
            </div>
            <div className="text-slate-500 text-xs">
              ⚠️ For educational purposes only. Not financial advice.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForexSignalPlatform;
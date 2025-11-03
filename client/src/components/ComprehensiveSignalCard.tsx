import { TrendingUp, TrendingDown, BarChart3, Target, Shield, AlertTriangle, CheckCircle, XCircle, Star, Copy, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Signal } from '@/lib/strategy';
import TradingChartWidget, { Position } from './TradingChartWidget';
import { TierBadge } from './TierBadge';
import { useToast } from '@/hooks/use-toast';

interface ComprehensiveSignalCardProps {
  signal: Signal;
  candles?: any[];
  onToggleSave?: (signalId: string) => void;
  isSaved?: boolean;
}

export function ComprehensiveSignalCard({ signal, candles, onToggleSave, isSaved }: ComprehensiveSignalCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [timeframe, setTimeframe] = useState<'1H' | '4H' | '1D'>('1H');
  const [showCopyPreview, setShowCopyPreview] = useState(false);
  const { toast } = useToast();

  // Aggregate candles based on timeframe (base candles are 5-minute intervals)
  const filteredCandles = candles ? (() => {
    if (timeframe === '1H') {
      // Aggregate 12 consecutive 5-min candles into 1 1H candle (12 × 5min = 60min)
      const aggregated = [];
      for (let i = 0; i < candles.length; i += 12) {
        const chunk = candles.slice(i, i + 12);
        if (chunk.length === 12) {
          aggregated.push({
            timestamp: chunk[11].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[11].close,
          });
        }
      }
      return aggregated;
    } else if (timeframe === '4H') {
      // Aggregate 48 consecutive 5-min candles into 1 4H candle (48 × 5min = 240min)
      const aggregated = [];
      for (let i = 0; i < candles.length; i += 48) {
        const chunk = candles.slice(i, i + 48);
        if (chunk.length === 48) {
          aggregated.push({
            timestamp: chunk[47].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[47].close,
          });
        }
      }
      return aggregated;
    } else {
      // Aggregate 288 consecutive 5-min candles into 1 1D candle (288 × 5min = 1440min = 24h)
      const aggregated = [];
      for (let i = 0; i < candles.length; i += 288) {
        const chunk = candles.slice(i, i + 288);
        if (chunk.length === 288) {
          aggregated.push({
            timestamp: chunk[287].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[287].close,
          });
        }
      }
      return aggregated;
    }
  })() : undefined;

  // Create position object for chart
  const position: Position | undefined = filteredCandles ? {
    entryPrice: signal.entry,
    entryTime: filteredCandles.length - 1,
    type: signal.type === 'LONG' ? 'long' : 'short',
    stopLoss: signal.stop,
    takeProfit: signal.targets[0], // Use first target
  } : undefined;

  const getOrderTypeInfo = (orderType: string) => {
    const orderTypes: Record<string, { color: string; icon: string; description: string }> = {
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

  const getExecutionTypeInfo = (executionType: string) => {
    const executionTypes: Record<string, { color: string; description: string }> = {
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

  const getSignalExplanation = (signal: Signal) => {
    const isLong = signal.type === 'LONG';
    const riskAmount = Math.abs(signal.entry - signal.stop);
    
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

  const explanation = getSignalExplanation(signal);

  // Copy signal details for MT5 (Format B - Compact)
  const copyForMT5 = async () => {
    const directionEmoji = signal.type === 'LONG' ? '📈' : '📉';
    const signalText = `${directionEmoji} ${signal.symbol} ${signal.orderType.replace(/_/g, ' ')}

Entry: ${signal.entry}
SL: ${signal.stop}
TP1: ${signal.targets[0]} (33%)
TP2: ${signal.targets[1]} (33%)
TP3: ${signal.targets[2]} (34%)
R:R: 1:${signal.riskReward}
Risk: 1-2%${signal.stopLimitPrice ? `\nStop Limit: ${signal.stopLimitPrice}` : ''}`;

    try {
      await navigator.clipboard.writeText(signalText);
      toast({
        title: "✅ Signal copied to clipboard!",
        description: "Ready to paste into MT5 or your trading journal",
      });
    } catch (err) {
      toast({
        title: "❌ Failed to copy",
        description: "Please try again or copy manually",
        variant: "destructive",
      });
    }
  };

  // Generate preview text (same as copy text)
  const getCopyPreviewText = () => {
    const directionEmoji = signal.type === 'LONG' ? '📈' : '📉';
    return `${directionEmoji} ${signal.symbol} ${signal.orderType.replace(/_/g, ' ')}

Entry: ${signal.entry}
SL: ${signal.stop}
TP1: ${signal.targets[0]} (33%)
TP2: ${signal.targets[1]} (33%)
TP3: ${signal.targets[2]} (34%)
R:R: 1:${signal.riskReward}
Risk: 1-2%${signal.stopLimitPrice ? `\nStop Limit: ${signal.stopLimitPrice}` : ''}`;
  };

  // Calculate tier from confidence if not provided (updated to 80% threshold, Oct 29 2025)
  const tier = signal.tier || (signal.confidence >= 80 ? 'HIGH' : 'MEDIUM');
  const tradeLive = signal.tradeLive !== undefined ? signal.tradeLive : (signal.confidence >= 80);
  const positionSizePercent = signal.positionSizePercent !== undefined ? signal.positionSizePercent : (signal.confidence >= 80 ? 1.50 : 0.00);

  return (
    <div className="bg-slate-800 rounded-lg p-5 border border-slate-700 hover:border-blue-500 transition-all">
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
        <div className="flex items-center gap-3">
          {/* Tier Badge */}
          <TierBadge
            tier={tier}
            confidence={signal.confidence}
            tradeLive={tradeLive}
            positionSizePercent={positionSizePercent}
            size="md"
            showLabel={true}
            showTooltip={true}
          />
          {onToggleSave && (
            <button
              onClick={() => onToggleSave(signal.id)}
              className={`p-2 rounded-lg transition-all ${
                isSaved ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
              data-testid={`button-save-${signal.id}`}
            >
              <Star className={`w-5 h-5 ${isSaved ? 'fill-current' : ''}`} />
            </button>
          )}
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

      {/* Order Type & Execution Information */}
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
            {signal.stopLimitPrice && (
              <div className="mt-2 pt-2 border-t border-current/30">
                <div className="flex justify-between text-xs">
                  <span className="opacity-70">Stop Limit:</span>
                  <span className="font-mono font-bold">{signal.stopLimitPrice}</span>
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

      {/* Target Prices */}
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

      {/* Price Chart */}
      {filteredCandles && filteredCandles.length > 0 && (
        <div className="mb-4 bg-slate-900 rounded-lg p-3 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Price Chart with Entry/SL/TP Levels</p>
            <div className="flex gap-1">
              <button
                onClick={() => setTimeframe('1H')}
                className={`px-2 py-1 text-xs rounded ${
                  timeframe === '1H' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                1H
              </button>
              <button
                onClick={() => setTimeframe('4H')}
                className={`px-2 py-1 text-xs rounded ${
                  timeframe === '4H' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                4H
              </button>
              <button
                onClick={() => setTimeframe('1D')}
                className={`px-2 py-1 text-xs rounded ${
                  timeframe === '1D' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                1D
              </button>
            </div>
          </div>
          <div className="rounded overflow-hidden">
            <TradingChartWidget
              candles={filteredCandles}
              height={300}
              position={position}
            />
          </div>
        </div>
      )}

      {/* Copy Format Preview Section */}
      <div className="mb-3">
        <button
          onClick={() => setShowCopyPreview(!showCopyPreview)}
          className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 font-semibold transition-all flex items-center justify-between"
          data-testid={`button-toggle-preview-${signal.id}`}
        >
          <span className="text-sm">Copy Format Preview</span>
          {showCopyPreview ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showCopyPreview && (
          <div className="mt-2 p-4 bg-slate-900 border border-slate-600 rounded-lg">
            <p className="text-xs text-slate-400 mb-2">This will be copied:</p>
            <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap">
              {getCopyPreviewText()}
            </pre>
          </div>
        )}
      </div>

      {/* Copy for MT5 Button */}
      <button
        onClick={copyForMT5}
        className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-lg text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg mb-3"
        data-testid={`button-copy-mt5-${signal.id}`}
      >
        <Copy className="w-5 h-5" />
        📋 Copy for MT5
      </button>

      {/* Explanation Toggle Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold transition-all flex items-center justify-center gap-2"
        data-testid={`button-toggle-explanation-${signal.id}`}
      >
        {isExpanded ? (
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
      {isExpanded && (
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
      )}

      <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between text-xs text-slate-400">
        <span>Strategy: {signal.strategy}</span>
        <span>{new Date(signal.timestamp).toLocaleString()}</span>
      </div>
    </div>
  );
}

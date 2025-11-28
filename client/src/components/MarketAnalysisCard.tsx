import { useState } from 'react';
import { TrendingUp, TrendingDown, BarChart3, AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import TradingChartWidget, { EMAData } from './TradingChartWidget';
import { Indicators } from '@/lib/indicators';
import { LineData, Time } from 'lightweight-charts';

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketAnalysisCardProps {
  symbol: string;
  candles: Candle[];
  currentPrice: number;
  analysis?: {
    weeklyTrend: 'UP' | 'DOWN';
    dailyTrend: 'UP' | 'DOWN';
    fourHourTrend: 'UP' | 'DOWN';
    oneHourTrend: 'UP' | 'DOWN';
    alignmentPct: number;
    reason: string;
  };
}

export function MarketAnalysisCard({ symbol, candles, currentPrice, analysis }: MarketAnalysisCardProps) {
  const [timeframe, setTimeframe] = useState<'1H' | '4H' | '1D'>('1H');
  // Aggregate candles based on timeframe (candles are 1H intervals)
  const filteredCandles = (() => {
    if (timeframe === '1H') {
      return candles; // Already 1H
    } else if (timeframe === '4H') {
      // Aggregate 4 consecutive 1H candles into 1 4H candle
      const aggregated = [];
      for (let i = 0; i < candles.length; i += 4) {
        const chunk = candles.slice(i, i + 4);
        if (chunk.length === 4) {
          aggregated.push({
            timestamp: chunk[3].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[3].close,
            volume: chunk.reduce((sum, c) => sum + c.volume, 0),
          });
        }
      }
      return aggregated;
    } else {
      // Aggregate 24 consecutive 1H candles into 1 1D candle
      const aggregated = [];
      for (let i = 0; i < candles.length; i += 24) {
        const chunk = candles.slice(i, i + 24);
        if (chunk.length === 24) {
          aggregated.push({
            timestamp: chunk[23].timestamp,
            open: chunk[0].open,
            high: Math.max(...chunk.map(c => c.high)),
            low: Math.min(...chunk.map(c => c.low)),
            close: chunk[23].close,
            volume: chunk.reduce((sum, c) => sum + c.volume, 0),
          });
        }
      }
      return aggregated;
    }
  })();

  // Calculate indicators from filtered candle data
  const closes = filteredCandles.map(c => c.close);
  const rsi = Indicators.rsi(closes, 14);
  const bb = Indicators.bollingerBands(closes, 20, 2);
  const atr = Indicators.atr(filteredCandles, 14);
  const adx = Indicators.adx(filteredCandles, 14);

  // Calculate EMAs for chart overlay (progressive calculation for each point)
  const calculateEMAArray = (data: number[], period: number): number[] => {
    if (data.length < period) return [];

    const k = 2 / (period + 1);
    const emaArray: number[] = [];

    // Start with SMA
    let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    emaArray.push(ema);

    // Calculate EMA for remaining points
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
      emaArray.push(ema);
    }

    return emaArray;
  };

  const ema20Array = calculateEMAArray(closes, 20);
  const ema50Array = calculateEMAArray(closes, 50);

  // Prepare EMA data for chart (convert to LineData format)
  const emaData: EMAData = {
    ema20: ema20Array.length > 0 ? filteredCandles.slice(20).map((candle, i) => ({
      time: (new Date(candle.timestamp).getTime() / 1000) as Time,
      value: ema20Array[i],
    })) : undefined,
    ema50: ema50Array.length > 0 ? filteredCandles.slice(50).map((candle, i) => ({
      time: (new Date(candle.timestamp).getTime() / 1000) as Time,
      value: ema50Array[i],
    })) : undefined,
  };

  const TimeframeBadge = ({ trend, points }: { trend: 'UP' | 'DOWN'; points?: number }) => (
    <div className="flex items-center gap-2">
      {trend === 'UP' ? (
        <TrendingUp className="w-4 h-4 text-green-500" />
      ) : (
        <TrendingDown className="w-4 h-4 text-red-500" />
      )}
      <span className={trend === 'UP' ? 'text-green-400' : 'text-red-400'}>
        {trend}
      </span>
      {points !== undefined && (
        <span className="text-slate-500 text-xs">+{points}pts</span>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Warning Alert - Waiting for Alignment */}
      <Alert variant="warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Market Analysis - {symbol}</AlertTitle>
        <AlertDescription>
          Waiting for timeframe alignment. The Philip Smith Strategy requires Weekly + Daily + 4H to all point the same direction.
          {analysis && ` Currently ${analysis.alignmentPct}% aligned (${Math.round(analysis.alignmentPct / 33)}/3 timeframes).`}
        </AlertDescription>
      </Alert>

      {/* Timeframe Alignment Status */}
      {analysis && (
        <div className="glass-card p-6 rounded-xl hover-lift transition-all duration-300">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            Current Timeframe States
          </h3>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded">
              <span className="text-slate-400 font-medium w-20">Weekly:</span>
              <TimeframeBadge trend={analysis.weeklyTrend} points={analysis.weeklyTrend === 'UP' || analysis.weeklyTrend === 'DOWN' ? 25 : 0} />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded">
              <span className="text-slate-400 font-medium w-20">Daily:</span>
              <TimeframeBadge trend={analysis.dailyTrend} points={analysis.dailyTrend === 'UP' || analysis.dailyTrend === 'DOWN' ? 25 : 0} />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded">
              <span className="text-slate-400 font-medium w-20">4-Hour:</span>
              <TimeframeBadge trend={analysis.fourHourTrend} points={analysis.fourHourTrend === 'UP' || analysis.fourHourTrend === 'DOWN' ? 25 : 0} />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded border border-slate-600">
              <span className="text-slate-400 font-medium w-20">1-Hour:</span>
              <div className="flex items-center gap-2">
                <TimeframeBadge trend={analysis.oneHourTrend} />
                <span className="text-xs text-slate-500">(Entry timing only)</span>
              </div>
            </div>
          </div>

          {/* Info Alert - Educational Content */}
          <div className="mt-6">
            <Alert variant="info">
              <Info className="h-4 w-4" />
              <AlertTitle>About the Philip Smith Strategy</AlertTitle>
              <AlertDescription className="text-sm">
                <p className="mb-2">
                  This strategy uses ICT (Inner Circle Trader) 3-Timeframe methodology.
                  A signal is generated when Weekly, Daily, and 4-Hour timeframes ALL align in the same direction.
                </p>
                <p className="text-xs text-slate-500">
                  💡 The 1-Hour timeframe is used for entry timing. If 1H is opposite to W+D+4H,
                  that's a <strong>pullback</strong> - actually the BEST entry opportunity!
                </p>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      )}

      {/* Trading Chart */}
      <div className="glass-card p-6 rounded-xl hover-lift hover-glow-blue transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            {symbol} Chart with Strategy EMAs
          </h3>
          {/* Timeframe Selector */}
          <div className="flex gap-1">
            <button
              onClick={() => setTimeframe('1H')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-300 ${
                timeframe === '1H'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/50'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
              }`}
            >
              1H
            </button>
            <button
              onClick={() => setTimeframe('4H')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-300 ${
                timeframe === '4H'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/50'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
              }`}
            >
              4H
            </button>
            <button
              onClick={() => setTimeframe('1D')}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all duration-300 ${
                timeframe === '1D'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-500/50'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50'
              }`}
            >
              1D
            </button>
          </div>
        </div>

        {filteredCandles.length > 0 ? (
          <div className="rounded-lg overflow-hidden">
            <TradingChartWidget
              candles={filteredCandles}
              positions={[]}
              currentPrice={currentPrice}
              emaData={emaData}
              showEMA={true}
              height={350}
            />
          </div>
        ) : (
          <p className="text-slate-500 text-center py-8">No chart data available</p>
        )}

        {/* EMA Legend */}
        <div className="flex items-center justify-center gap-6 mt-3 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-amber-500"></div>
            <span className="text-slate-400">EMA 20 (Fast)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-blue-500"></div>
            <span className="text-slate-400">EMA 50 (Slow)</span>
          </div>
        </div>
      </div>

      {/* Market Indicators */}
      {candles.length > 0 && (
        <div className="glass-card p-6 rounded-xl hover-lift transition-all duration-300">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Market Indicators
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {rsi !== null && (
              <div className="text-center p-3 bg-slate-900/50 rounded">
                <div className="text-xs text-slate-500 mb-1">RSI (14)</div>
                <div className={`text-xl font-mono ${
                  rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-green-400' : 'text-slate-300'
                }`}>
                  {rsi.toFixed(1)}
                </div>
              </div>
            )}

            {atr !== null && (
              <div className="text-center p-3 bg-slate-900/50 rounded">
                <div className="text-xs text-slate-500 mb-1">ATR (14)</div>
                <div className="text-xl font-mono text-slate-300">
                  {atr.toFixed(5)}
                </div>
              </div>
            )}

            {adx && (
              <div className="text-center p-3 bg-slate-900/50 rounded">
                <div className="text-xs text-slate-500 mb-1">ADX (14)</div>
                <div className={`text-xl font-mono ${
                  adx.adx > 25 ? 'text-green-400' : 'text-amber-400'
                }`}>
                  {adx.adx.toFixed(1)}
                </div>
              </div>
            )}

            {bb && (
              <div className="text-center p-3 bg-slate-900/50 rounded">
                <div className="text-xs text-slate-500 mb-1">BB Width</div>
                <div className="text-xl font-mono text-slate-300">
                  {((bb.upper - bb.lower) / bb.middle * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

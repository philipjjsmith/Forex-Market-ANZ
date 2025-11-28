import { TrendingUp, TrendingDown, BarChart3, AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import TradingChartWidget from './TradingChartWidget';
import { Indicators } from '@/lib/indicators';

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
  // Calculate indicators from candle data
  const closes = candles.map(c => c.close);
  const rsi = Indicators.rsi(closes, 14);
  const bb = Indicators.bollingerBands(closes, 20, 2);
  const atr = Indicators.atr(candles, 14);
  const adx = Indicators.adx(candles, 14);

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
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
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
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-purple-400" />
          {symbol} Chart (1-Hour)
        </h3>

        {candles.length > 0 ? (
          <TradingChartWidget
            candles={candles}
            positions={[]}
            currentPrice={currentPrice}
          />
        ) : (
          <p className="text-slate-500 text-center py-8">No chart data available</p>
        )}
      </div>

      {/* Market Indicators */}
      {candles.length > 0 && (
        <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
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

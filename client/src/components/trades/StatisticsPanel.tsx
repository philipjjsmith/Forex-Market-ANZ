import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, Gauge, Award } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AdvancedStats {
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  expectancy: number;
  interpretation: {
    sharpe: string;
    sortino: string;
    profitFactor: string;
  };
}

interface StatisticsPanelProps {
  technicalIndicators: any;
  executionMetrics: {
    entrySlippage: number;
    exitSlippage: number;
    fillLatency: number;
    mae: number;
    mfe: number;
  };
  advancedStats: AdvancedStats;
}

export function StatisticsPanel({ technicalIndicators, executionMetrics, advancedStats }: StatisticsPanelProps) {
  const StatCard = ({
    label,
    value,
    unit,
    rating,
    tooltip,
    color = 'text-gray-300'
  }: {
    label: string;
    value: string | number;
    unit?: string;
    rating?: string;
    tooltip: string;
    color?: string;
  }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="bg-white/5 dark:bg-black/20 rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors cursor-help">
            <div className="text-xs text-gray-400 mb-2">{label}</div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${color}`}>{value}</span>
              {unit && <span className="text-sm text-gray-500">{unit}</span>}
            </div>
            {rating && (
              <div className="text-xs text-gray-500 mt-1">{rating}</div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <Tabs defaultValue="technical" className="w-full">
      <TabsList className="w-full bg-white/5 dark:bg-black/20 border border-white/10">
        <TabsTrigger value="technical" className="flex-1 data-[state=active]:bg-white/10">
          <Gauge className="w-4 h-4 mr-2" />
          Technical
        </TabsTrigger>
        <TabsTrigger value="execution" className="flex-1 data-[state=active]:bg-white/10">
          <TrendingUp className="w-4 h-4 mr-2" />
          Execution
        </TabsTrigger>
        <TabsTrigger value="performance" className="flex-1 data-[state=active]:bg-white/10">
          <Award className="w-4 h-4 mr-2" />
          Performance
        </TabsTrigger>
      </TabsList>

      <TabsContent value="technical" className="mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            label="RSI"
            value={technicalIndicators.rsi}
            rating={
              parseFloat(technicalIndicators.rsi) > 70 ? 'Overbought' :
              parseFloat(technicalIndicators.rsi) < 30 ? 'Oversold' : 'Neutral'
            }
            color={
              parseFloat(technicalIndicators.rsi) > 70 ? 'text-red-400' :
              parseFloat(technicalIndicators.rsi) < 30 ? 'text-green-400' : 'text-gray-300'
            }
            tooltip="Relative Strength Index measures momentum. >70 overbought, <30 oversold."
          />
          <StatCard
            label="ADX"
            value={technicalIndicators.adx}
            rating={
              parseFloat(technicalIndicators.adx) > 25 ? 'Strong Trend' : 'Weak Trend'
            }
            color={parseFloat(technicalIndicators.adx) > 25 ? 'text-green-400' : 'text-yellow-400'}
            tooltip="Average Directional Index measures trend strength. >25 indicates strong trend."
          />
          <StatCard
            label="MACD"
            value={technicalIndicators.macd.histogram > 0 ? 'Bullish' : 'Bearish'}
            rating={`${technicalIndicators.macd.value > 0 ? '+' : ''}${(technicalIndicators.macd.value * 10000).toFixed(1)}`}
            color={technicalIndicators.macd.histogram > 0 ? 'text-green-400' : 'text-red-400'}
            tooltip="MACD shows momentum direction and strength. Positive histogram = bullish."
          />
          <StatCard
            label="EMA 20"
            value={technicalIndicators.ema20.toFixed(5)}
            tooltip="20-period Exponential Moving Average. Price above EMA = bullish bias."
          />
          <StatCard
            label="EMA 50"
            value={technicalIndicators.ema50.toFixed(5)}
            tooltip="50-period Exponential Moving Average. Longer-term trend indicator."
          />
          <StatCard
            label="ATR"
            value={(technicalIndicators.atr * 10000).toFixed(1)}
            unit="pips"
            rating={
              technicalIndicators.atr > 0.0015 ? 'High Volatility' : 'Normal'
            }
            tooltip="Average True Range measures volatility. Higher ATR = larger price movements."
          />
        </div>
      </TabsContent>

      <TabsContent value="execution" className="mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            label="Entry Slippage"
            value={executionMetrics.entrySlippage > 0 ? '+' : ''}{executionMetrics.entrySlippage.toFixed(1)}
            unit="pips"
            rating={Math.abs(executionMetrics.entrySlippage) < 0.5 ? 'Excellent' : 'Fair'}
            color={executionMetrics.entrySlippage === 0 ? 'text-gray-300' : executionMetrics.entrySlippage > 0 ? 'text-red-400' : 'text-green-400'}
            tooltip="Difference between expected and actual entry price. Positive = worse price."
          />
          <StatCard
            label="Exit Slippage"
            value={`${executionMetrics.exitSlippage > 0 ? '+' : ''}${executionMetrics.exitSlippage.toFixed(1)}`}
            unit="pips"
            rating={Math.abs(executionMetrics.exitSlippage) < 0.5 ? 'Excellent' : 'Fair'}
            color={executionMetrics.exitSlippage === 0 ? 'text-gray-300' : executionMetrics.exitSlippage > 0 ? 'text-red-400' : 'text-green-400'}
            tooltip="Difference between expected and actual exit price."
          />
          <StatCard
            label="Fill Latency"
            value={executionMetrics.fillLatency}
            unit="ms"
            rating={executionMetrics.fillLatency < 100 ? 'Excellent' : executionMetrics.fillLatency < 200 ? 'Good' : 'Fair'}
            color={executionMetrics.fillLatency < 100 ? 'text-green-400' : executionMetrics.fillLatency < 200 ? 'text-lime-400' : 'text-yellow-400'}
            tooltip="Time taken to execute the order. <100ms is professional-grade."
          />
          <StatCard
            label="MAE"
            value={executionMetrics.mae.toFixed(1)}
            unit="pips"
            rating="Max Drawdown"
            color="text-red-400"
            tooltip="Maximum Adverse Excursion: The worst point the trade went against you."
          />
          <StatCard
            label="MFE"
            value={executionMetrics.mfe.toFixed(1)}
            unit="pips"
            rating="Peak Profit"
            color="text-green-400"
            tooltip="Maximum Favorable Excursion: The best profit point reached."
          />
          <StatCard
            label="MFE/MAE Ratio"
            value={(executionMetrics.mfe / executionMetrics.mae).toFixed(1)}
            unit="x"
            rating={
              (executionMetrics.mfe / executionMetrics.mae) >= 3.0 ? 'Excellent' : 'Good'
            }
            color={(executionMetrics.mfe / executionMetrics.mae) >= 3.0 ? 'text-green-400' : 'text-lime-400'}
            tooltip="Efficiency of profit capture. Higher = better exit timing."
          />
        </div>
      </TabsContent>

      <TabsContent value="performance" className="mt-4">
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <StatCard
            label="Sharpe Ratio"
            value={advancedStats.sharpeRatio.toFixed(2)}
            rating={advancedStats.interpretation.sharpe}
            color={
              advancedStats.sharpeRatio >= 2.0 ? 'text-green-400' :
              advancedStats.sharpeRatio >= 1.0 ? 'text-lime-400' :
              advancedStats.sharpeRatio >= 0.5 ? 'text-yellow-400' : 'text-red-400'
            }
            tooltip="Risk-adjusted return. Measures return per unit of volatility. >2.0 is excellent."
          />
          <StatCard
            label="Sortino Ratio"
            value={advancedStats.sortinoRatio.toFixed(2)}
            rating={advancedStats.interpretation.sortino}
            color={
              advancedStats.sortinoRatio >= 3.0 ? 'text-green-400' :
              advancedStats.sortinoRatio >= 2.0 ? 'text-lime-400' :
              advancedStats.sortinoRatio >= 1.0 ? 'text-yellow-400' : 'text-red-400'
            }
            tooltip="Like Sharpe but only considers downside risk. Better metric since upside volatility is good."
          />
          <StatCard
            label="Profit Factor"
            value={advancedStats.profitFactor.toFixed(2)}
            rating={advancedStats.interpretation.profitFactor}
            color={
              advancedStats.profitFactor >= 2.0 ? 'text-green-400' :
              advancedStats.profitFactor >= 1.5 ? 'text-lime-400' :
              advancedStats.profitFactor >= 1.0 ? 'text-yellow-400' : 'text-red-400'
            }
            tooltip="Gross profit / Gross loss. Must be >1.0 to be profitable. >2.0 is excellent."
          />
          <StatCard
            label="Expectancy"
            value={advancedStats.expectancy > 0 ? '+' : ''}{advancedStats.expectancy.toFixed(1)}
            unit="pips"
            rating="Per Trade"
            color={advancedStats.expectancy > 10 ? 'text-green-400' : advancedStats.expectancy > 5 ? 'text-lime-400' : advancedStats.expectancy > 1 ? 'text-yellow-400' : 'text-red-400'}
            tooltip="Average expected profit per trade. Must be positive long-term. >10 pips is excellent."
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}

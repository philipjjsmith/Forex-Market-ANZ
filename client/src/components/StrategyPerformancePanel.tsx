import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLearningEngine } from '@/hooks/use-learning-engine';
import { RefreshCw, TrendingUp, TrendingDown, Activity, Award, AlertTriangle } from 'lucide-react';
import { useState } from 'react';

export function StrategyPerformancePanel() {
  const {
    isInitialized,
    overallStats,
    getMultipliers,
    getTopPerformers,
    getWorstPerformers,
    refresh,
  } = useLearningEngine();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  const multipliers = getMultipliers();
  const topPerformers = getTopPerformers(5);
  const worstPerformers = getWorstPerformers(5);

  if (!isInitialized) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy Performance Analytics</CardTitle>
          <CardDescription>Loading learning data...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Strategy Performance Analytics</h2>
          <p className="text-muted-foreground">AI learning insights from trading history</p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline">
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Overall Statistics */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Metrics</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallStats.totalMetrics}</div>
            <p className="text-xs text-muted-foreground">Symbol/confidence combos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Adjustments</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallStats.activeMultipliers}</div>
            <p className="text-xs text-muted-foreground">Learning from performance</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Win Rate</CardTitle>
            <Award className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallStats.avgWinRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Across all strategies</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Profit Factor</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallStats.avgProfitFactor.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Profit/Loss ratio</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overallStats.totalTrades}</div>
            <p className="text-xs text-muted-foreground">Learning dataset size</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Confidence Multipliers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Active Confidence Adjustments
          </CardTitle>
          <CardDescription>
            The AI adjusts these symbol+confidence combinations based on historical performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          {multipliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="mx-auto h-12 w-12 mb-2 opacity-50" />
              <p>No adjustments yet. Need at least 5 trades per symbol+confidence range.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {multipliers.map((m) => {
                const adjustmentPercent = ((m.multiplier - 1) * 100).toFixed(1);
                const isPositive = m.multiplier > 1;
                const isNeutral = Math.abs(m.multiplier - 1) < 0.05;

                return (
                  <div
                    key={`${m.symbol}:${m.confidenceRange}`}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium">{m.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          Confidence: {m.confidenceRange}%
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant={isNeutral ? 'secondary' : isPositive ? 'default' : 'destructive'}>
                        {isPositive ? '+' : ''}{adjustmentPercent}%
                      </Badge>
                      <div className="text-sm text-muted-foreground">
                        {m.sampleSize} trades
                      </div>
                      {isPositive ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : isNeutral ? (
                        <Activity className="h-4 w-4 text-gray-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top and Worst Performers Side by Side */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-green-600" />
              Top Performers
            </CardTitle>
            <CardDescription>Best symbol+confidence combinations</CardDescription>
          </CardHeader>
          <CardContent>
            {topPerformers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Award className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>No data yet. Keep trading to build history!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topPerformers.map((metric, index) => (
                  <div
                    key={`${metric.symbol}:${metric.confidenceRange}`}
                    className="flex items-center justify-between p-3 border rounded-lg bg-green-50 border-green-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">{metric.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          {metric.confidenceRange}% confidence
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-semibold text-green-700">
                        {metric.winRate.toFixed(1)}% win rate
                      </div>
                      <div className="text-sm text-muted-foreground">
                        PF: {metric.profitFactor.toFixed(2)} • {metric.totalTrades} trades
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Worst Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Needs Improvement
            </CardTitle>
            <CardDescription>Underperforming combinations</CardDescription>
          </CardHeader>
          <CardContent>
            {worstPerformers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>No data yet. Keep trading to build history!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {worstPerformers.map((metric, index) => (
                  <div
                    key={`${metric.symbol}:${metric.confidenceRange}`}
                    className="flex items-center justify-between p-3 border rounded-lg bg-red-50 border-red-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-red-600 text-white text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium">{metric.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          {metric.confidenceRange}% confidence
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-semibold text-red-700">
                        {metric.winRate.toFixed(1)}% win rate
                      </div>
                      <div className="text-sm text-muted-foreground">
                        PF: {metric.profitFactor.toFixed(2)} • {metric.totalTrades} trades
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Learning Status Banner */}
      {overallStats.totalTrades > 0 && (
        <Card className="bg-indigo-50 border-indigo-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Activity className="h-6 w-6 text-indigo-600 mt-1" />
              <div>
                <h3 className="font-semibold text-indigo-900 mb-1">
                  🧠 Learning Engine Active
                </h3>
                <p className="text-sm text-indigo-700">
                  The AI has analyzed <strong>{overallStats.totalTrades} trades</strong> and is
                  actively adjusting confidence scores for <strong>{overallStats.activeMultipliers}</strong>{' '}
                  symbol+confidence combinations. Signals are now being optimized based on what
                  actually works in the market!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

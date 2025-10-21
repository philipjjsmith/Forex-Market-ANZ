import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, TrendingUp, AlertCircle, CheckCircle, Activity, Zap, Database, Target } from 'lucide-react';
import { API_ENDPOINTS } from '@/config/api';
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { getCurrentUser, getToken } from '@/lib/auth';

interface AIInsights {
  totalSignals: number;
  completedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  pendingRecommendations: number;
  lastAnalysis: string;
  symbolInsights: {
    symbol: string;
    totalSignals: number;
    winRate: number;
    hasEnoughData: boolean;
  }[];
}

interface SymbolPerformance {
  symbol: string;
  rsiPerformance: {
    rsi_zone: string;
    total_signals: string;
    wins: string;
    win_rate: string;
  }[];
  adxPerformance: {
    trend_strength: string;
    total_signals: string;
    wins: string;
    win_rate: string;
  }[];
}

export default function AIInsights() {
  const [, setLocation] = useLocation();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check if user is admin
  useEffect(() => {
    async function checkAdminAccess() {
      const user = await getCurrentUser();

      if (!user) {
        // Not logged in - redirect to login
        setLocation('/');
        return;
      }

      if (user.role !== 'admin') {
        // Not an admin - redirect to dashboard
        setLocation('/');
        return;
      }

      setIsCheckingAuth(false);
    }

    checkAdminAccess();
  }, [setLocation]);

  // Fetch overall AI insights
  const { data: insights, isLoading, refetch } = useQuery<AIInsights>({
    queryKey: ['ai-insights'],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(API_ENDPOINTS.AI_INSIGHTS, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch AI insights');
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Trigger manual analysis
  const triggerAnalysis = async () => {
    try {
      const token = getToken();
      const res = await fetch(API_ENDPOINTS.AI_ANALYZE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (res.ok) {
        setTimeout(() => refetch(), 3000); // Refetch after 3 seconds
      }
    } catch (error) {
      console.error('Failed to trigger analysis:', error);
    }
  };

  if (isCheckingAuth || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading AI insights...</div>
      </div>
    );
  }

  const readySymbols = insights?.symbolInsights.filter(s => s.hasEnoughData) || [];
  const learningSymbols = insights?.symbolInsights.filter(s => !s.hasEnoughData && s.totalSignals > 0) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Brain className="w-8 h-8 text-blue-400" />
              AI Learning Insights
            </h1>
            <p className="text-blue-200 mt-2">
              Real-time analysis of trading signal patterns and performance
            </p>
          </div>
          <Button
            onClick={triggerAnalysis}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Activity className="w-4 h-4 mr-2" />
            Run Analysis Now
          </Button>
        </div>

        {/* Learning Summary */}
        <Card className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-blue-500/50 backdrop-blur-md shadow-2xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              Learning Summary
            </CardTitle>
            <CardDescription className="text-blue-200">
              Overall AI learning status and performance metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Database className="w-5 h-5 text-blue-300" />
                  <p className="text-blue-200 text-sm font-medium">Total Signals</p>
                </div>
                <p className="text-4xl font-black text-white">{insights?.totalSignals || 0}</p>
                <p className="text-xs text-blue-300 mt-1">
                  {insights?.completedSignals || 0} completed
                </p>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <p className="text-blue-200 text-sm font-medium">Win Rate</p>
                </div>
                <p className={`text-4xl font-black ${
                  (insights?.winRate || 0) >= 70 ? 'text-green-400' :
                  (insights?.winRate || 0) >= 50 ? 'text-yellow-400' :
                  'text-red-400'
                }`}>
                  {insights?.winRate?.toFixed(1) || '0'}%
                </p>
                <p className="text-xs text-blue-300 mt-1">
                  {insights?.wins || 0} wins, {insights?.losses || 0} losses
                </p>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-purple-400" />
                  <p className="text-blue-200 text-sm font-medium">AI Active</p>
                </div>
                <p className="text-4xl font-black text-white">{readySymbols.length}</p>
                <p className="text-xs text-blue-300 mt-1">
                  {learningSymbols.length} learning
                </p>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-orange-400" />
                  <p className="text-blue-200 text-sm font-medium">Recommendations</p>
                </div>
                <p className="text-4xl font-black text-white">
                  {insights?.pendingRecommendations || 0}
                </p>
                <p className="text-xs text-blue-300 mt-1">pending approval</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Symbol Performance Matrix */}
        <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-400" />
              Symbol Performance Matrix
            </CardTitle>
            <CardDescription className="text-blue-200">
              AI learning status per currency pair
            </CardDescription>
          </CardHeader>
          <CardContent>
            {insights?.symbolInsights && insights.symbolInsights.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-600">
                      <th className="text-left p-3 text-blue-200 font-semibold">Symbol</th>
                      <th className="text-center p-3 text-blue-200 font-semibold">Signals</th>
                      <th className="text-center p-3 text-blue-200 font-semibold">Win Rate</th>
                      <th className="text-left p-3 text-blue-200 font-semibold">AI Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.symbolInsights.map((symbol) => (
                      <tr
                        key={symbol.symbol}
                        className="border-b border-slate-700 hover:bg-slate-700/30 transition-colors"
                      >
                        <td className="p-3 text-white font-mono font-bold">
                          {symbol.symbol}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`font-bold ${
                            symbol.totalSignals >= 30 ? 'text-green-400' :
                            symbol.totalSignals >= 10 ? 'text-yellow-400' :
                            'text-red-400'
                          }`}>
                            {symbol.totalSignals}
                          </span>
                          <span className="text-blue-300 text-sm ml-1">/ 30</span>
                        </td>
                        <td className="p-3 text-center">
                          {symbol.totalSignals > 0 ? (
                            <span className={`font-bold ${
                              symbol.winRate >= 70 ? 'text-green-400' :
                              symbol.winRate >= 50 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {symbol.winRate.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {symbol.hasEnoughData ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-900/50 text-green-300 rounded text-sm font-semibold">
                              <CheckCircle className="w-4 h-4" />
                              AI Active
                            </span>
                          ) : symbol.totalSignals > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-900/50 text-yellow-300 rounded text-sm font-semibold">
                              <Activity className="w-4 h-4" />
                              Learning ({Math.round((symbol.totalSignals / 30) * 100)}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-700/50 text-slate-400 rounded text-sm">
                              <AlertCircle className="w-4 h-4" />
                              No Data
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                No symbol data available yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Indicator Effectiveness (for symbols with data) */}
        {learningSymbols.length > 0 && (
          <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-purple-400" />
                Indicator Effectiveness Analysis
              </CardTitle>
              <CardDescription className="text-blue-200">
                Which technical conditions lead to profitable trades
              </CardDescription>
            </CardHeader>
            <CardContent>
              {learningSymbols.map((symbol) => (
                <SymbolIndicatorPerformance key={symbol.symbol} symbol={symbol.symbol} />
              ))}
            </CardContent>
          </Card>
        )}

        {/* Recommendations Section */}
        <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-400" />
              AI Recommendations
            </CardTitle>
            <CardDescription className="text-blue-200">
              Strategy optimization suggestions (requires 30+ signals per symbol)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg mb-2">No Recommendations Yet</p>
              <p className="text-slate-500 text-sm max-w-md mx-auto">
                The AI needs at least 30 completed signals per symbol to generate
                parameter optimization recommendations. Keep trading and check back soon!
              </p>
              <div className="mt-6">
                <p className="text-blue-300 text-sm">
                  Closest to ready: <span className="font-bold text-white">
                    {learningSymbols[0]?.symbol || 'N/A'}
                  </span> ({learningSymbols[0]?.totalSignals || 0}/30 signals)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-blue-900/30 border-blue-500/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5" />
              <div className="text-sm text-blue-200">
                <p className="font-semibold mb-1">How AI Learning Works:</p>
                <ul className="list-disc list-inside space-y-1 text-blue-300">
                  <li>AI analyzes every completed signal (TP1_HIT/STOP_HIT)</li>
                  <li>Identifies which indicator conditions lead to wins vs losses</li>
                  <li>Adjusts confidence weights based on historical performance</li>
                  <li>Requires minimum 30 signals per symbol for statistical significance</li>
                  <li>Updates automatically every 6 hours</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Component to show indicator performance for a specific symbol
function SymbolIndicatorPerformance({ symbol }: { symbol: string }) {
  const { data, isLoading } = useQuery<SymbolPerformance>({
    queryKey: ['symbol-performance', symbol],
    queryFn: async () => {
      const res = await fetch(API_ENDPOINTS.AI_PERFORMANCE(symbol), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch performance');
      return res.json();
    },
  });

  if (isLoading) {
    return <div className="text-slate-400 text-sm">Loading {symbol} performance...</div>;
  }

  if (!data) return null;

  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-white font-bold mb-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-400" />
        {symbol}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RSI Performance */}
        <div className="bg-slate-700/30 rounded p-3">
          <p className="text-blue-200 text-sm font-semibold mb-2">RSI Conditions</p>
          <div className="space-y-1">
            {data.rsiPerformance.map((rsi, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm">
                <span className="text-slate-300">
                  {rsi.rsi_zone.replace('RSI_', '').replace('_', ' ')}:
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{rsi.total_signals} signals</span>
                  <span className={`font-bold ${
                    parseFloat(rsi.win_rate) >= 70 ? 'text-green-400' :
                    parseFloat(rsi.win_rate) >= 50 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {parseFloat(rsi.win_rate).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ADX Performance */}
        <div className="bg-slate-700/30 rounded p-3">
          <p className="text-blue-200 text-sm font-semibold mb-2">Trend Strength (ADX)</p>
          <div className="space-y-1">
            {data.adxPerformance.map((adx, idx) => (
              <div key={idx} className="flex justify-between items-center text-sm">
                <span className="text-slate-300">
                  {adx.trend_strength.replace('_', ' ')}:
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">{adx.total_signals} signals</span>
                  <span className={`font-bold ${
                    parseFloat(adx.win_rate) >= 70 ? 'text-green-400' :
                    parseFloat(adx.win_rate) >= 50 ? 'text-yellow-400' :
                    'text-red-400'
                  }`}>
                    {parseFloat(adx.win_rate).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

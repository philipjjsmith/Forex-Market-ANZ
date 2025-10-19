import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Activity, TrendingUp, TrendingDown, Clock, Target, BarChart3, LogOut, User, Home } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { API_ENDPOINTS } from '@/config/api';
import { getCurrentUser, logout, type User as AuthUser } from '@/lib/auth';
import { ActiveSignalsTable } from '@/components/ActiveSignalsTable';
import { SignalHistoryTable } from '@/components/SignalHistoryTable';

interface PerformanceData {
  overall: {
    totalSignals: number;
    wins: number;
    losses: number;
    expired: number;
    pending: number;
    winRate: number;
    avgWinPips: number;
    avgLossPips: number;
  };
  bySymbol: Array<{
    symbol: string;
    confidence_bracket: string;
    total_signals: number;
    wins: number;
    losses: number;
    win_rate: number;
    avg_profit_pips: number;
    avg_loss_pips: number;
  }>;
  unlocks: {
    insightsUnlocked: boolean;
    advancedUnlocked: boolean;
    signalsNeededForInsights: number;
    signalsNeededForAdvanced: number;
  };
}

interface ActiveSignal {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  order_type: string;
  execution_type: string;
  created_at: string;
  expires_at: string;
  indicators: any;
}

interface HistorySignal {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  outcome: string;
  outcome_price: number;
  outcome_time: string;
  profit_loss_pips: number;
  manually_closed_by_user: boolean;
  created_at: string;
}

export default function Analytics() {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [activeSignals, setActiveSignals] = useState<ActiveSignal[]>([]);
  const [historySignals, setHistorySignals] = useState<HistorySignal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        setLocation('/login');
      } else {
        setUser(currentUser);
      }
      setIsCheckingAuth(false);
    };

    checkAuth();
  }, [setLocation]);

  // Fetch performance data
  const fetchPerformance = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.SIGNALS_PERFORMANCE, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch performance data');
      }

      const data = await response.json();
      setPerformance(data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Fetch active signals
  const fetchActiveSignals = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.SIGNALS_ACTIVE, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch active signals');
      }

      const data = await response.json();
      setActiveSignals(data.signals || []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Fetch signal history
  const fetchHistory = async () => {
    try {
      const response = await fetch(API_ENDPOINTS.SIGNALS_HISTORY + '?limit=50', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch signal history');
      }

      const data = await response.json();
      setHistorySignals(data.history || []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Initial data load
  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([
        fetchPerformance(),
        fetchActiveSignals(),
        fetchHistory(),
      ]);
      setIsLoading(false);
    };

    loadData();

    // Poll active signals every 30 seconds
    const interval = setInterval(() => {
      fetchActiveSignals();
      fetchPerformance();
    }, 30000);

    return () => clearInterval(interval);
  }, [user]);

  // Handle logout
  const handleLogout = async () => {
    await logout();
    setLocation('/login');
  };

  if (isCheckingAuth || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading analytics...</div>
      </div>
    );
  }

  const totalCompleted = performance
    ? performance.overall.totalSignals - performance.overall.pending
    : 0;

  const insightsProgress = Math.min((totalCompleted / 10) * 100, 100);
  const advancedProgress = Math.min((totalCompleted / 30) * 100, 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Activity className="w-8 h-8 text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold text-white">AI Analytics</h1>
                <p className="text-sm text-blue-200">Performance Tracking & Insights</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                onClick={() => setLocation('/')}
                className="border-white/20 hover:bg-white/10 text-white"
              >
                <Home className="w-4 h-4 mr-2" />
                Dashboard
              </Button>
              <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg">
                <User className="w-4 h-4 text-blue-300" />
                <span className="text-white font-medium">{user?.username}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-200">
            {error}
          </div>
        )}

        {/* Performance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200">Total Signals</CardDescription>
              <CardTitle className="text-3xl text-white">
                {performance?.overall.totalSignals || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-200">
                  {performance?.overall.pending || 0} pending
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200">Win Rate</CardDescription>
              <CardTitle className="text-3xl text-white">
                {performance?.overall.winRate.toFixed(1) || 0}%
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-green-200">
                  {performance?.overall.wins || 0} wins
                </span>
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="text-red-200">
                  {performance?.overall.losses || 0} losses
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200">Avg Win</CardDescription>
              <CardTitle className="text-3xl text-green-400">
                +{performance?.overall.avgWinPips.toFixed(1) || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-green-200">pips per winning trade</p>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200">Avg Loss</CardDescription>
              <CardTitle className="text-3xl text-red-400">
                -{performance?.overall.avgLossPips.toFixed(1) || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-red-200">pips per losing trade</p>
            </CardContent>
          </Card>
        </div>

        {/* AI Unlock Progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border-blue-500/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-400" />
                AI Insights
              </CardTitle>
              <CardDescription className="text-blue-200">
                {performance?.unlocks.insightsUnlocked
                  ? '✅ Unlocked - View performance patterns'
                  : `${performance?.unlocks.signalsNeededForInsights || 10} more signals needed`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={insightsProgress} className="h-2" />
              <p className="text-sm text-blue-200 mt-2">
                {totalCompleted} / 10 completed signals
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/20 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-400" />
                AI Auto-Optimization
              </CardTitle>
              <CardDescription className="text-purple-200">
                {performance?.unlocks.advancedUnlocked
                  ? '✅ Unlocked - AI recommendations active'
                  : `${performance?.unlocks.signalsNeededForAdvanced || 30} more signals needed`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={advancedProgress} className="h-2" />
              <p className="text-sm text-purple-200 mt-2">
                {totalCompleted} / 30 completed signals
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active Signals */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white">Active Signals ({activeSignals.length})</CardTitle>
            <CardDescription className="text-blue-200">
              Real-time monitoring • Updates every 30s
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActiveSignalsTable
              signals={activeSignals}
              onSignalClosed={() => {
                fetchActiveSignals();
                fetchHistory();
                fetchPerformance();
              }}
            />
          </CardContent>
        </Card>

        {/* Signal History */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white">Signal History</CardTitle>
            <CardDescription className="text-blue-200">
              Last 50 completed signals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignalHistoryTable signals={historySignals} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

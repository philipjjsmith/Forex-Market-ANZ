import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Activity, TrendingUp, TrendingDown, Clock, Target, BarChart3, LogOut, User, Home, DollarSign, Wallet, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { API_ENDPOINTS } from '@/config/api';
import { getCurrentUser, logout, getToken, type User as AuthUser } from '@/lib/auth';
import { ActiveSignalsTable } from '@/components/ActiveSignalsTable';
import { SignalHistoryTable } from '@/components/SignalHistoryTable';
import { calculateTotalProfit } from '@/lib/profit-calculator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const [accountSize, setAccountSize] = useState<number>(10000); // Default $10,000

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
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.SIGNALS_PERFORMANCE, {
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
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
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.SIGNALS_ACTIVE, {
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
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
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.SIGNALS_HISTORY + '?limit=50', {
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
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

  // Calculate total profit
  const profitData = calculateTotalProfit(accountSize, historySignals, performance?.bySymbol || []);
  const accountBalance = accountSize + profitData.totalProfit;

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

        {/* Account Size Selector & Profit Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Account Size Selector */}
          <Card className="bg-gradient-to-br from-blue-900/40 to-indigo-900/40 border-blue-500/50 backdrop-blur-sm shadow-xl">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-cyan-500/20 rounded-lg">
                  <Wallet className="w-6 h-6 text-cyan-400" />
                </div>
                <CardTitle className="text-xl font-bold text-white">
                  Account Size
                </CardTitle>
              </div>
              <CardDescription className="text-slate-300 text-sm">
                Select your trading capital
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <Select
                value={accountSize.toString()}
                onValueChange={(value) => setAccountSize(parseInt(value))}
              >
                <SelectTrigger className="bg-slate-800/80 border-cyan-500/30 text-white h-12 text-lg font-semibold hover:border-cyan-400/50 transition-colors">
                  <SelectValue placeholder="Select account size" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-cyan-500/30">
                  <SelectItem value="1000" className="text-white hover:bg-cyan-500/20 text-lg">
                    $1,000
                  </SelectItem>
                  <SelectItem value="10000" className="text-white hover:bg-cyan-500/20 text-lg">
                    $10,000
                  </SelectItem>
                  <SelectItem value="100000" className="text-white hover:bg-cyan-500/20 text-lg">
                    $100,000
                  </SelectItem>
                </SelectContent>
              </Select>
              <div className="mt-3 text-center">
                <p className="text-5xl font-black text-cyan-400 tracking-tight">
                  ${accountSize.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Total Profit */}
          <Card className={`backdrop-blur-sm shadow-xl border-2 transition-all ${
            profitData.totalProfit > 0
              ? 'bg-gradient-to-br from-emerald-900/50 to-green-900/50 border-emerald-500/50'
              : profitData.totalProfit < 0
              ? 'bg-gradient-to-br from-red-900/50 to-rose-900/50 border-red-500/50'
              : 'bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-600/50'
          }`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-1">
                <div className={`p-2 rounded-lg ${
                  profitData.totalProfit > 0 ? 'bg-emerald-500/20' : profitData.totalProfit < 0 ? 'bg-red-500/20' : 'bg-slate-500/20'
                }`}>
                  <DollarSign className={`w-6 h-6 ${
                    profitData.totalProfit > 0 ? 'text-emerald-400' : profitData.totalProfit < 0 ? 'text-red-400' : 'text-slate-400'
                  }`} />
                </div>
                <CardDescription className={`text-base font-medium ${
                  profitData.totalProfit > 0 ? 'text-emerald-200' : profitData.totalProfit < 0 ? 'text-red-200' : 'text-slate-300'
                }`}>
                  Total Profit/Loss
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <p className={`text-6xl font-black tracking-tight ${
                  profitData.totalProfit > 0 ? 'text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]' :
                  profitData.totalProfit < 0 ? 'text-red-400 drop-shadow-[0_0_15px_rgba(248,113,113,0.5)]' :
                  'text-slate-400'
                }`}>
                  {profitData.totalProfit >= 0 ? '+' : ''}${Math.abs(profitData.totalProfit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className={`flex items-center justify-center gap-2 text-sm font-medium ${
                profitData.totalProfit > 0 ? 'text-emerald-300' : profitData.totalProfit < 0 ? 'text-red-300' : 'text-slate-400'
              }`}>
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  {profitData.winningTrades} wins
                </span>
                <span className="text-slate-500">•</span>
                <span className="flex items-center gap-1">
                  <XCircle className="w-4 h-4" />
                  {profitData.losingTrades} losses
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Account Balance */}
          <Card className="bg-gradient-to-br from-purple-900/40 to-pink-900/40 border-purple-500/50 backdrop-blur-sm shadow-xl border-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Wallet className="w-6 h-6 text-purple-400" />
                </div>
                <CardDescription className="text-base font-medium text-purple-200">
                  Account Balance
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <p className="text-6xl font-black text-white tracking-tight drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                  ${accountBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <div className={`flex items-center gap-1 px-3 py-1 rounded-full font-semibold text-sm ${
                  profitData.totalProfit > 0
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : profitData.totalProfit < 0
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-slate-500/20 text-slate-300'
                }`}>
                  {profitData.totalProfit > 0 ? <TrendingUp className="w-4 h-4" /> : profitData.totalProfit < 0 ? <TrendingDown className="w-4 h-4" /> : <Target className="w-4 h-4" />}
                  <span>
                    {profitData.totalProfit >= 0 ? '+' : ''}{((profitData.totalProfit / accountSize) * 100).toFixed(2)}% ROI
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200 font-medium">Total Signals</CardDescription>
              <CardTitle className="text-3xl text-white font-bold">
                {performance?.overall.totalSignals || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span className="text-yellow-200 font-medium">
                  {performance?.overall.pending || 0} pending
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200 font-medium">Win Rate</CardDescription>
              <CardTitle className="text-3xl text-white font-bold">
                {performance?.overall.winRate.toFixed(1) || 0}%
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-green-400" />
                <span className="text-green-200 font-medium">
                  {performance?.overall.wins || 0} wins
                </span>
                <TrendingDown className="w-4 h-4 text-red-400" />
                <span className="text-red-200 font-medium">
                  {performance?.overall.losses || 0} losses
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200 font-medium">Avg Win</CardDescription>
              <CardTitle className="text-3xl text-green-400 font-bold">
                +{performance?.overall.avgWinPips.toFixed(1) || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-green-200 font-medium">pips per winning trade</p>
            </CardContent>
          </Card>

          <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader className="pb-2">
              <CardDescription className="text-blue-200 font-medium">Avg Loss</CardDescription>
              <CardTitle className="text-3xl text-red-400 font-bold">
                -{performance?.overall.avgLossPips.toFixed(1) || 0}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-red-200 font-medium">pips per losing trade</p>
            </CardContent>
          </Card>
        </div>

        {/* AI Unlock Progress */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-blue-500/40 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2 font-bold">
                <BarChart3 className="w-5 h-5 text-blue-400" />
                AI Insights
              </CardTitle>
              <CardDescription className="text-blue-200 font-medium">
                {performance?.unlocks.insightsUnlocked
                  ? '✅ Unlocked - View performance patterns'
                  : `${performance?.unlocks.signalsNeededForInsights || 10} more signals needed`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={insightsProgress} className="h-2" />
              <p className="text-sm text-blue-200 mt-2 font-medium">
                {totalCompleted} / 10 completed signals
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-purple-500/40 backdrop-blur-md shadow-lg hover:shadow-xl transition-all duration-300">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2 font-bold">
                <Target className="w-5 h-5 text-purple-400" />
                AI Auto-Optimization
              </CardTitle>
              <CardDescription className="text-purple-200 font-medium">
                {performance?.unlocks.advancedUnlocked
                  ? '✅ Unlocked - AI recommendations active'
                  : `${performance?.unlocks.signalsNeededForAdvanced || 30} more signals needed`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={advancedProgress} className="h-2" />
              <p className="text-sm text-purple-200 mt-2 font-medium">
                {totalCompleted} / 30 completed signals
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active Signals */}
        <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg">
          <CardHeader>
            <CardTitle className="text-white font-bold">Active Signals ({activeSignals.length})</CardTitle>
            <CardDescription className="text-blue-200 font-medium">
              Real-time monitoring • Updates every 30s
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActiveSignalsTable
              signals={activeSignals}
              accountSize={accountSize}
              performanceData={performance?.bySymbol || []}
              onSignalClosed={() => {
                fetchActiveSignals();
                fetchHistory();
                fetchPerformance();
              }}
            />
          </CardContent>
        </Card>

        {/* Signal History */}
        <Card className="bg-white/15 border-white/30 backdrop-blur-md shadow-lg">
          <CardHeader>
            <CardTitle className="text-white font-bold">Signal History</CardTitle>
            <CardDescription className="text-blue-200 font-medium">
              Last 50 completed signals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignalHistoryTable
              signals={historySignals}
              accountSize={accountSize}
              performanceData={performance?.bySymbol || []}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Activity, TrendingUp, AlertCircle, RefreshCw, Play, Pause, Clock, CheckCircle, Calendar, Database, Zap, Brain, Target, DollarSign, TrendingDown, BarChart3, HelpCircle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { API_ENDPOINTS, API_BASE_URL } from '@/config/api';
import { useLocation } from 'wouter';
import { getCurrentUser, getToken } from '@/lib/auth';
import { calculateFxifyProfit, formatDollars, meetsFxifyRequirements } from '@/lib/fxify-profit-calculator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';

interface SystemHealth {
  status: 'healthy' | 'warning' | 'error';
  signalGenerator: {
    isRunning: boolean;
    lastRun: string;
    nextRun: string;
    signalsGenerated: number;
    signalsTracked: number;
  };
  outcomeValidator: {
    isRunning: boolean;
    lastRun: string;
    pendingSignals: number;
    validatedToday: number;
  };
  apiUsage: {
    exchangeRateAPI: {
      callsToday: number;
      limit: number;
      cacheHitRate: number;
    };
    twelveDataAPI: {
      callsToday: number;
      limit: number;
      cacheHitRate: number;
    };
  };
}

interface GenerationLog {
  id: string;
  timestamp: string;
  duration: number;
  pairsProcessed: number;
  signalsGenerated: number;
  signalsTracked: number;
  errors: string[];
  status: 'success' | 'partial' | 'failed';
}

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

interface Recommendation {
  id: string;
  symbol: string;
  recommendation_title: string;
  recommendation_details: string;
  reasoning: string;
  suggested_changes: {
    fastMA_period?: { from: number; to: number };
    slowMA_period?: { from: number; to: number };
    atr_multiplier?: { from: number; to: number };
  };
  expected_win_rate_improvement: string;
  based_on_signals: number;
  status: string;
  created_at: string;
}

interface OverallMetrics {
  totalSignals: number;
  wins: number;
  losses: number;
  totalProfitPips: number;
  winRate: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface SignalDataSet {
  overall: OverallMetrics;
  cumulativeProfit: Array<{
    date: string;
    daily_pips: string;
    cumulative_pips: string;
  }>;
  monthlyComparison: Array<{
    month: string;
    total_signals: string;
    wins: string;
    profit_pips: string;
    win_rate: string;
  }>;
  symbolPerformance: Array<{
    symbol: string;
    total_signals: string;
    wins: string;
    profit_pips: string;
    win_rate: string;
  }>;
}

interface DualGrowthStats {
  fxifyOnly: SignalDataSet;
  allSignals: SignalDataSet;
  comparison: {
    signalCountDiff: number;
    winRateDiff: number;
    profitDiff: number;
  };
  timeframe: string;
}

interface GrowthStats extends SignalDataSet {
  timeframe: string;
}

export default function Admin() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [triggeringGeneration, setTriggeringGeneration] = useState(false);
  const [triggeringBacktest, setTriggeringBacktest] = useState(false);
  const [countdown, setCountdown] = useState<string>('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<'system' | 'ai' | 'growth'>('system');
  const [growthDays, setGrowthDays] = useState(0); // 0 = all time
  const [lotSize, setLotSize] = useState<'micro' | 'mini' | 'standard'>('mini');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Mobile detection for responsive charts
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Fetch system health
  const { data: health, isLoading: healthLoading } = useQuery<SystemHealth>({
    queryKey: [API_ENDPOINTS.ADMIN_HEALTH],
    queryFn: async () => {
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.ADMIN_HEALTH, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch health');
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch generation logs
  const { data: logs, isLoading: logsLoading } = useQuery<GenerationLog[]>({
    queryKey: [API_ENDPOINTS.ADMIN_LOGS],
    queryFn: async () => {
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.ADMIN_LOGS, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch AI insights
  const { data: aiInsights, isLoading: aiLoading, refetch: refetchAI } = useQuery<AIInsights>({
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
    enabled: activeTab === 'ai', // Only fetch when AI tab is active
  });

  // Fetch AI recommendations
  const { data: recommendations, isLoading: recsLoading, refetch: refetchRecs } = useQuery<Recommendation[]>({
    queryKey: ['ai-recommendations'],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(API_ENDPOINTS.AI_RECOMMENDATIONS, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch recommendations');
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: activeTab === 'ai', // Only fetch when AI tab is active
  });

  // Fetch dual growth stats (FXIFY + All Signals)
  const { data: dualGrowthStats, isLoading: growthLoading } = useQuery<DualGrowthStats>({
    queryKey: ['growth-stats-dual', growthDays],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${API_ENDPOINTS.ADMIN_GROWTH_STATS_DUAL}?days=${growthDays}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch growth stats');
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
    enabled: activeTab === 'growth', // Only fetch when Growth tab is active
  });

  // Manual trigger mutation
  const triggerGeneration = useMutation({
    mutationFn: async () => {
      const token = getToken();
      const response = await fetch(API_ENDPOINTS.ADMIN_TRIGGER_GENERATION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 405) {
          throw new Error('Server is redeploying. Please wait 2-3 minutes and try again.');
        }
        throw new Error('Failed to trigger generation');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ADMIN_HEALTH] });
      queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ADMIN_LOGS] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const handleTriggerGeneration = async () => {
    setTriggeringGeneration(true);
    try {
      await triggerGeneration.mutateAsync();
    } finally {
      setTriggeringGeneration(false);
    }
  };

  // Trigger manual AI analysis
  const handleTriggerAI = async () => {
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
        setTimeout(() => refetchAI(), 3000); // Refetch after 3 seconds
      }
    } catch (error) {
      console.error('Failed to trigger AI analysis:', error);
    }
  };

  // Handle recommendation approval
  const handleApprove = async (id: string) => {
    try {
      const token = getToken();
      const res = await fetch(API_ENDPOINTS.AI_RECOMMENDATION_APPROVE(id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (res.ok) {
        refetchRecs();
        refetchAI();
      }
    } catch (error) {
      console.error('Failed to approve recommendation:', error);
    }
  };

  // Handle recommendation rejection
  const handleReject = async (id: string) => {
    try {
      const token = getToken();
      const res = await fetch(API_ENDPOINTS.AI_RECOMMENDATION_REJECT(id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (res.ok) {
        refetchRecs();
        refetchAI();
      }
    } catch (error) {
      console.error('Failed to reject recommendation:', error);
    }
  };

  // Trigger backtesting
  const handleTriggerBacktest = async () => {
    setTriggeringBacktest(true);
    try {
      const token = getToken();
      const res = await fetch(API_BASE_URL + '/api/ai/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (res.ok) {
        // Wait 3 seconds then refresh recommendations
        setTimeout(() => {
          refetchRecs();
          refetchAI();
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to trigger backtesting:', error);
    } finally {
      setTimeout(() => setTriggeringBacktest(false), 3000);
    }
  };

  // Countdown timer effect
  useEffect(() => {
    const updateCountdown = () => {
      if (!health?.signalGenerator.nextRun) {
        setCountdown('');
        return;
      }

      const now = new Date().getTime();
      const nextRun = new Date(health.signalGenerator.nextRun).getTime();
      const diff = nextRun - now;

      if (diff <= 0) {
        setCountdown('Running now...');
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setCountdown(`in ${minutes}m ${seconds}s`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [health?.signalGenerator.nextRun]);

  if (isCheckingAuth || healthLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const getStatusColor = (status?: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'warning': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'error': return 'bg-red-500/20 text-red-400 border-red-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  const getStatusIcon = (status?: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy': return <Activity className="h-4 w-4" />;
      case 'warning': return <AlertCircle className="h-4 w-4" />;
      case 'error': return <AlertCircle className="h-4 w-4" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  const readySymbols = aiInsights?.symbolInsights.filter(s => s.hasEnoughData) || [];
  const learningSymbols = aiInsights?.symbolInsights.filter(s => !s.hasEnoughData && s.totalSignals > 0) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-blue-200 mt-1">
              {activeTab === 'system'
                ? 'Monitor system health and signal generation'
                : activeTab === 'ai'
                ? 'AI learning insights and performance analytics'
                : 'Track profitability and growth over time'}
            </p>
          </div>
          <div className="flex gap-3">
            {activeTab !== 'growth' && (
              <Button
                onClick={activeTab === 'system' ? handleTriggerGeneration : handleTriggerAI}
                disabled={activeTab === 'system' && (triggeringGeneration || health?.signalGenerator.isRunning)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {activeTab === 'system' ? (
                  triggeringGeneration ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Trigger Generation
                    </>
                  )
                ) : (
                  <>
                    <Activity className="h-4 w-4 mr-2" />
                    Run AI Analysis
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 border-b border-slate-700">
          <button
            onClick={() => setActiveTab('system')}
            className={`px-6 py-3 font-semibold transition-all ${
              activeTab === 'system'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              System Health
            </div>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`px-6 py-3 font-semibold transition-all ${
              activeTab === 'ai'
                ? 'text-white border-b-2 border-purple-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4" />
              AI Insights
            </div>
          </button>
          <button
            onClick={() => setActiveTab('growth')}
            className={`px-6 py-3 font-semibold transition-all ${
              activeTab === 'growth'
                ? 'text-white border-b-2 border-green-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Growth Tracking
            </div>
          </button>
        </div>

        {/* System Health Tab Content */}
        {activeTab === 'system' && (
          <>
            {/* Quick Stats Summary */}
            <Card className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-blue-500/50 backdrop-blur-md shadow-2xl">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Database className="w-5 h-5 text-blue-300" />
                <p className="text-blue-200 text-sm font-medium">Total Signals Today</p>
              </div>
              <p className="text-4xl font-black text-white">
                {logs?.reduce((sum, log) => sum + log.signalsTracked, 0) || 0}
              </p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <CheckCircle className="w-5 h-5 text-green-300" />
                <p className="text-blue-200 text-sm font-medium">Success Rate</p>
              </div>
              <p className="text-4xl font-black text-green-400">
                {logs?.filter(log => log.status === 'success').length === logs?.length ? '100' : '0'}%
              </p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-yellow-300" />
                <p className="text-blue-200 text-sm font-medium">Next Generation</p>
              </div>
              <p className="text-3xl font-black text-yellow-400">
                {countdown || 'Calculating...'}
              </p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Activity className="w-5 h-5 text-emerald-300" />
                <p className="text-blue-200 text-sm font-medium">System Status</p>
              </div>
              <Badge className={`${getStatusColor(health?.status)} text-lg px-4 py-1 font-bold`}>
                {health?.status?.toUpperCase() || 'UNKNOWN'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section Divider */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <Zap className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-bold text-white">System Health</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent"></div>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Overall Health */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              {getStatusIcon(health?.status)}
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge className={`${getStatusColor(health?.status)} text-sm px-3 py-1`}>
              {health?.status?.toUpperCase() || 'UNKNOWN'}
            </Badge>
          </CardContent>
        </Card>

        {/* Signal Generator */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Signal Generator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <span className="text-blue-200 text-sm">Status:</span>
              </div>
              <Badge className={health?.signalGenerator.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}>
                {health?.signalGenerator.isRunning ? 'Running' : 'Idle'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span className="text-blue-200 text-sm">Last Run:</span>
              </div>
              <span className="text-white text-base font-bold">
                {health?.signalGenerator.lastRun ? new Date(health.signalGenerator.lastRun).toLocaleTimeString() : 'Never'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-yellow-400" />
                <span className="text-blue-200 text-sm">Next Run:</span>
              </div>
              <div className="text-right">
                <p className="text-white text-base font-bold">
                  {health?.signalGenerator.nextRun ? new Date(health.signalGenerator.nextRun).toLocaleTimeString() : 'N/A'}
                </p>
                {countdown && (
                  <p className="text-yellow-400 text-xs font-semibold">{countdown}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Outcome Validator */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Outcome Validator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-yellow-400" />
                <span className="text-blue-200 text-sm">Pending:</span>
              </div>
              <span className="text-white text-3xl font-black">
                {health?.outcomeValidator.pendingSignals || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-blue-200 text-sm">Validated Today:</span>
              </div>
              <span className="text-green-400 text-3xl font-black">
                {health?.outcomeValidator.validatedToday || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-400" />
                <span className="text-blue-200 text-sm">Last Run:</span>
              </div>
              <span className="text-white text-base font-bold">
                {health?.outcomeValidator.lastRun ? new Date(health.outcomeValidator.lastRun).toLocaleTimeString() : 'Never'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section Divider */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <TrendingUp className="w-5 h-5 text-purple-400" />
        <h2 className="text-xl font-bold text-white">API Monitoring</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-purple-500/50 to-transparent"></div>
      </div>

      {/* API Usage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ExchangeRate API */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white">ExchangeRate API</CardTitle>
            <CardDescription className="text-blue-200">Real-time forex quotes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-200 text-sm">Daily Usage</span>
                </div>
                <span className="text-white text-lg font-black">
                  {health?.apiUsage.exchangeRateAPI.callsToday || 0} / {health?.apiUsage.exchangeRateAPI.limit || 1500}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-3">
                <div
                  className="bg-blue-500 h-3 rounded-full transition-all"
                  style={{
                    width: `${Math.min(((health?.apiUsage.exchangeRateAPI.callsToday || 0) / (health?.apiUsage.exchangeRateAPI.limit || 1500)) * 100, 100)}%`
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-green-400" />
                <span className="text-blue-200 text-sm">Cache Hit Rate:</span>
              </div>
              <span className="text-green-400 text-2xl font-black">
                {health?.apiUsage.exchangeRateAPI.cacheHitRate || 0}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Twelve Data API */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white">Twelve Data API</CardTitle>
            <CardDescription className="text-blue-200">Historical candle data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-purple-400" />
                  <span className="text-blue-200 text-sm">Daily Usage</span>
                </div>
                <span className="text-white text-lg font-black">
                  {health?.apiUsage.twelveDataAPI.callsToday || 0} / {health?.apiUsage.twelveDataAPI.limit || 800}
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-3">
                <div
                  className="bg-purple-500 h-3 rounded-full transition-all"
                  style={{
                    width: `${Math.min(((health?.apiUsage.twelveDataAPI.callsToday || 0) / (health?.apiUsage.twelveDataAPI.limit || 800)) * 100, 100)}%`
                  }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-green-400" />
                <span className="text-blue-200 text-sm">Cache Hit Rate:</span>
              </div>
              <span className="text-green-400 text-2xl font-black">
                {health?.apiUsage.twelveDataAPI.cacheHitRate || 0}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section Divider */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <RefreshCw className="w-5 h-5 text-green-400" />
        <h2 className="text-xl font-bold text-white">Generation History</h2>
        <div className="flex-1 h-px bg-gradient-to-r from-green-500/50 to-transparent"></div>
      </div>

      {/* Recent Generation Logs */}
      <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
        <CardHeader>
          <CardTitle className="text-white">Recent Generation Logs</CardTitle>
          <CardDescription className="text-blue-200">Last 10 signal generation cycles</CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="bg-slate-700/50 border border-slate-600/50 rounded-lg p-4 hover:bg-slate-700/70 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Badge className={
                        log.status === 'success' ? 'bg-green-500/20 text-green-400' :
                        log.status === 'partial' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }>
                        {log.status.toUpperCase()}
                      </Badge>
                      <span className="text-white text-sm font-medium">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-blue-200 text-sm">
                      Duration: {log.duration}s
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3">
                    <div>
                      <span className="text-blue-200 text-xs">Pairs Processed</span>
                      <p className="text-white font-bold">{log.pairsProcessed}</p>
                    </div>
                    <div>
                      <span className="text-blue-200 text-xs">Signals Generated</span>
                      <p className="text-white font-bold">{log.signalsGenerated}</p>
                    </div>
                    <div>
                      <span className="text-blue-200 text-xs">Signals Tracked</span>
                      <p className="text-white font-bold">{log.signalsTracked}</p>
                    </div>
                  </div>
                  {log.errors.length > 0 && (
                    <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded">
                      <p className="text-red-400 text-xs font-medium">Errors:</p>
                      <ul className="text-red-300 text-xs mt-1 space-y-1">
                        {log.errors.map((error, idx) => (
                          <li key={idx}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-blue-200 text-center py-8">No generation logs yet</p>
          )}
        </CardContent>
      </Card>
          </>
        )}

        {/* AI Insights Tab Content */}
        {activeTab === 'ai' && (
          <>
            {aiLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : (
              <>
                {/* Learning Summary */}
                <Card className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-blue-500/50 backdrop-blur-md shadow-2xl">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white flex items-center gap-2">
                          <Zap className="w-5 h-5 text-yellow-400" />
                          Learning Summary
                        </CardTitle>
                        <CardDescription className="text-blue-200">
                          Overall AI learning status and performance metrics
                        </CardDescription>
                      </div>
                      <Button
                        onClick={handleTriggerBacktest}
                        disabled={triggeringBacktest || (aiInsights?.symbolInsights.filter(s => s.hasEnoughData).length || 0) === 0}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        {triggeringBacktest ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Running...
                          </>
                        ) : (
                          <>
                            <Brain className="w-4 h-4 mr-2" />
                            Run Backtesting
                          </>
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <Database className="w-5 h-5 text-blue-300" />
                          <p className="text-blue-200 text-sm font-medium">Total Signals</p>
                        </div>
                        <p className="text-4xl font-black text-white">{aiInsights?.totalSignals || 0}</p>
                        <p className="text-xs text-blue-300 mt-1">
                          {aiInsights?.completedSignals || 0} completed
                        </p>
                      </div>

                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <TrendingUp className="w-5 h-5 text-green-400" />
                          <p className="text-blue-200 text-sm font-medium">Win Rate</p>
                        </div>
                        <p className={`text-4xl font-black ${
                          (aiInsights?.winRate || 0) >= 70 ? 'text-green-400' :
                          (aiInsights?.winRate || 0) >= 50 ? 'text-yellow-400' :
                          'text-red-400'
                        }`}>
                          {aiInsights?.winRate?.toFixed(1) || '0'}%
                        </p>
                        <p className="text-xs text-blue-300 mt-1">
                          {aiInsights?.wins || 0} wins, {aiInsights?.losses || 0} losses
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
                          {aiInsights?.pendingRecommendations || 0}
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
                    {aiInsights?.symbolInsights && aiInsights.symbolInsights.length > 0 ? (
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
                            {aiInsights.symbolInsights.map((symbol) => (
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

                {/* AI Recommendations */}
                <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-400" />
                      AI Recommendations
                    </CardTitle>
                    <CardDescription className="text-blue-200">
                      Parameter optimization suggestions based on backtesting
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {recsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                      </div>
                    ) : recommendations && recommendations.length > 0 ? (
                      <div className="space-y-4">
                        {recommendations.map((rec) => (
                          <div
                            key={rec.id}
                            className="bg-slate-900/50 border border-slate-700 rounded-lg p-4"
                          >
                            {/* Header */}
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="text-white font-bold text-lg flex items-center gap-2">
                                  <span className="text-blue-400">{rec.symbol}</span>
                                  <Badge className="bg-purple-900/50 text-purple-300 border-purple-500/50">
                                    +{parseFloat(rec.expected_win_rate_improvement).toFixed(1)}% Win Rate
                                  </Badge>
                                </h3>
                                <p className="text-blue-300 text-sm mt-1">{rec.recommendation_title}</p>
                              </div>
                            </div>

                            {/* Parameter Changes */}
                            <div className="bg-slate-800/50 rounded p-3 mb-3">
                              <p className="text-blue-200 text-sm font-semibold mb-2">Suggested Changes:</p>
                              <div className="space-y-1 text-sm">
                                {rec.suggested_changes.fastMA_period && (
                                  <p className="text-slate-300">
                                    <span className="text-slate-400">Fast EMA:</span>{' '}
                                    <span className="text-red-400">{rec.suggested_changes.fastMA_period.from}</span>
                                    {' → '}
                                    <span className="text-green-400">{rec.suggested_changes.fastMA_period.to}</span>
                                  </p>
                                )}
                                {rec.suggested_changes.slowMA_period && (
                                  <p className="text-slate-300">
                                    <span className="text-slate-400">Slow EMA:</span>{' '}
                                    <span className="text-red-400">{rec.suggested_changes.slowMA_period.from}</span>
                                    {' → '}
                                    <span className="text-green-400">{rec.suggested_changes.slowMA_period.to}</span>
                                  </p>
                                )}
                                {rec.suggested_changes.atr_multiplier && (
                                  <p className="text-slate-300">
                                    <span className="text-slate-400">ATR Multiplier:</span>{' '}
                                    <span className="text-red-400">{rec.suggested_changes.atr_multiplier.from}x</span>
                                    {' → '}
                                    <span className="text-green-400">{rec.suggested_changes.atr_multiplier.to}x</span>
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Reasoning */}
                            <div className="mb-3">
                              <p className="text-blue-200 text-sm font-semibold mb-1">Reasoning:</p>
                              <p className="text-slate-300 text-sm leading-relaxed">{rec.reasoning}</p>
                            </div>

                            {/* Metadata */}
                            <div className="flex items-center gap-4 mb-3 text-xs text-slate-400">
                              <span>Based on {rec.based_on_signals} signals</span>
                              <span>•</span>
                              <span>{new Date(rec.created_at).toLocaleDateString()}</span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              <Button
                                onClick={() => handleApprove(rec.id)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                                size="sm"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                onClick={() => handleReject(rec.id)}
                                className="bg-red-600 hover:bg-red-700 text-white"
                                size="sm"
                              >
                                <AlertCircle className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3 opacity-50" />
                        <p className="text-slate-400">No pending recommendations</p>
                        <p className="text-slate-500 text-sm mt-1">
                          The AI will generate recommendations when it finds parameter improvements {'>'} 5%
                        </p>
                      </div>
                    )}
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
              </>
            )}
          </>
        )}

        {/* Growth Tracking Tab Content */}
        {activeTab === 'growth' && (
          <>
            {growthLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 h-8 animate-spin text-blue-500" />
              </div>
            ) : dualGrowthStats ? (
              <>
                {/* Time Period Filter */}
                <div className="flex justify-end items-center mb-6">
                  <Select value={growthDays.toString()} onValueChange={(value) => setGrowthDays(parseInt(value))}>
                    <SelectTrigger className="w-[200px] bg-slate-800/80 text-white border-white/30">
                      <SelectValue placeholder="Time period" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 text-white border-white/30">
                      <SelectItem value="0">All Time</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Key Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  {/* Total Profit */}
                  {(() => {
                    const pipValue = { micro: 0.10, mini: 1.00, standard: 10.00 };
                    const profitUSD = dualGrowthStats.allSignals.overall.totalProfitPips * pipValue[lotSize];
                    const isProfit = dualGrowthStats.allSignals.overall.totalProfitPips >= 0;
                    const cardGradient = isProfit
                      ? "bg-gradient-to-br from-green-900/40 to-emerald-900/40 border-green-500/50"
                      : "bg-gradient-to-br from-red-900/40 to-rose-900/40 border-red-500/50";
                    const textColor = isProfit ? "text-green-200" : "text-red-200";
                    const valueColor = isProfit ? "text-green-400" : "text-red-400";

                    return (
                      <Card className={`${cardGradient} backdrop-blur-sm shadow-xl`}>
                        <CardHeader className="pb-2">
                          <CardTitle className={`text-sm font-medium ${textColor} flex items-center gap-2`}>
                            <DollarSign className="w-4 h-4" />
                            Total Profit
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className={`text-2xl font-bold ${valueColor}`}>
                            {isProfit ? '+' : ''}${profitUSD.toFixed(2)} USD
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {isProfit ? '+' : ''}{dualGrowthStats.allSignals.overall.totalProfitPips.toFixed(1)} pips
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {dualGrowthStats.timeframe}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Win Rate */}
                  <Card className="bg-gradient-to-br from-blue-900/40 to-indigo-900/40 border-blue-500/50 backdrop-blur-sm shadow-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-blue-200 flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Win Rate
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">
                        {dualGrowthStats.allSignals.overall.winRate.toFixed(2)}%
                      </div>
                      <p className="text-xs text-blue-300 mt-1">
                        {dualGrowthStats.allSignals.overall.wins}W / {dualGrowthStats.allSignals.overall.losses}L
                      </p>
                    </CardContent>
                  </Card>

                  {/* Profit Factor */}
                  <Card className="bg-gradient-to-br from-purple-900/40 to-pink-900/40 border-purple-500/50 backdrop-blur-sm shadow-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-purple-200 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Profit Factor
                        <TooltipProvider>
                          <UITooltip>
                            <TooltipTrigger>
                              <HelpCircle className="w-3 h-3 text-purple-300" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs bg-slate-900 border-slate-700">
                              <p className="font-semibold mb-1">What is Profit Factor?</p>
                              <p className="text-sm mb-2">Total wins ÷ Total losses</p>
                              <p className="text-xs text-slate-300">
                                • Below 1.0: Losing more than winning<br/>
                                • 1.0-1.75: Breaking even or small profit<br/>
                                • 1.75-2.5: Good performance<br/>
                                • 2.5+: Excellent performance
                              </p>
                            </TooltipContent>
                          </UITooltip>
                        </TooltipProvider>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">
                        {dualGrowthStats.allSignals.overall.profitFactor.toFixed(2)}
                      </div>
                      <p className={`text-xs mt-1 ${
                        dualGrowthStats.allSignals.overall.profitFactor >= 2.5 ? 'text-green-300' :
                        dualGrowthStats.allSignals.overall.profitFactor >= 1.75 ? 'text-blue-300' :
                        dualGrowthStats.allSignals.overall.profitFactor >= 1.0 ? 'text-yellow-300' :
                        'text-red-300'
                      }`}>
                        {dualGrowthStats.allSignals.overall.profitFactor >= 2.5 ? '⭐ Excellent' :
                         dualGrowthStats.allSignals.overall.profitFactor >= 1.75 ? '✓ Good' :
                         dualGrowthStats.allSignals.overall.profitFactor >= 1.0 ? '○ Breaking Even' :
                         '✗ Needs Work'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Sharpe Ratio */}
                  <Card className="bg-gradient-to-br from-yellow-900/40 to-orange-900/40 border-yellow-500/50 backdrop-blur-sm shadow-xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-yellow-200 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Sharpe Ratio
                        <TooltipProvider>
                          <UITooltip>
                            <TooltipTrigger>
                              <HelpCircle className="w-3 h-3 text-yellow-300" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs bg-slate-900 border-slate-700">
                              <p className="font-semibold mb-1">What is Sharpe Ratio?</p>
                              <p className="text-sm mb-2">Risk-adjusted return metric</p>
                              <p className="text-xs text-slate-300">
                                • Below 1: High risk for returns<br/>
                                • 1-2: Good risk-adjusted performance<br/>
                                • 2-3: Very good performance<br/>
                                • 3+: Exceptional performance
                              </p>
                            </TooltipContent>
                          </UITooltip>
                        </TooltipProvider>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">
                        {dualGrowthStats.allSignals.overall.sharpeRatio.toFixed(2)}
                      </div>
                      <p className={`text-xs mt-1 ${
                        dualGrowthStats.allSignals.overall.sharpeRatio >= 3 ? 'text-green-300' :
                        dualGrowthStats.allSignals.overall.sharpeRatio >= 2 ? 'text-blue-300' :
                        dualGrowthStats.allSignals.overall.sharpeRatio >= 1 ? 'text-yellow-300' :
                        'text-red-300'
                      }`}>
                        {dualGrowthStats.allSignals.overall.sharpeRatio >= 3 ? '⭐ Exceptional' :
                         dualGrowthStats.allSignals.overall.sharpeRatio >= 2 ? '✓ Very Good' :
                         dualGrowthStats.allSignals.overall.sharpeRatio >= 1 ? '○ Good' :
                         '✗ High Risk'}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Max Drawdown */}
                  {(() => {
                    const pipValue = { micro: 0.10, mini: 1.00, standard: 10.00 };
                    const maxDrawdownUSD = dualGrowthStats.allSignals.overall.maxDrawdown * pipValue[lotSize];

                    return (
                      <Card className="bg-gradient-to-br from-red-900/40 to-rose-900/40 border-red-500/50 backdrop-blur-sm shadow-xl">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-red-200 flex items-center gap-2">
                            <TrendingDown className="w-4 h-4" />
                            Max Drawdown
                            <TooltipProvider>
                              <UITooltip>
                                <TooltipTrigger>
                                  <HelpCircle className="w-3 h-3 text-red-300" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs bg-slate-900 border-slate-700">
                                  <p className="font-semibold mb-1">What is Max Drawdown?</p>
                                  <p className="text-sm mb-2">Largest peak-to-trough decline</p>
                                  <p className="text-xs text-slate-300">
                                    Shows the worst loss experienced from any profit peak.<br/>
                                    Lower is better (indicates better risk management).
                                  </p>
                                </TooltipContent>
                              </UITooltip>
                            </TooltipProvider>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-bold text-red-400">
                            -{dualGrowthStats.allSignals.overall.maxDrawdown.toFixed(1)} pips
                          </div>
                          <p className="text-xs text-red-300 mt-1">
                            -${maxDrawdownUSD.toFixed(2)} USD
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })()}
                </div>

                {/* Cumulative Profit Chart */}
                <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                      Cumulative Profit Over Time
                    </CardTitle>
                    <CardDescription className="text-blue-200">
                      Track your profit growth day by day
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {dualGrowthStats.allSignals.cumulativeProfit.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        {(() => {
                          const chartData = dualGrowthStats.allSignals.cumulativeProfit.map((d, idx, arr) => {
                            const pips = parseFloat(d.cumulative_pips);
                            const prevPips = idx > 0 ? parseFloat(arr[idx - 1].cumulative_pips) : 0;
                            return {
                              date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                              pips: pips,
                              color: pips >= 0 ? '#10B981' : '#EF4444',
                              isDeclining: pips < prevPips
                            };
                          });
                          const maxPips = Math.max(...chartData.map(d => d.pips), 0);
                          const minPips = Math.min(...chartData.map(d => d.pips), 0);

                          return (
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis
                                dataKey="date"
                                stroke="#9CA3AF"
                                style={{ fontSize: isMobile ? '10px' : '12px' }}
                                angle={isMobile ? -45 : 0}
                                textAnchor={isMobile ? 'end' : 'middle'}
                                height={isMobile ? 70 : 30}
                              />
                              <YAxis
                                stroke="#9CA3AF"
                                style={{ fontSize: isMobile ? '10px' : '12px' }}
                              />

                              {/* Zero reference line */}
                              <ReferenceLine
                                y={0}
                                stroke="#6B7280"
                                strokeDasharray="3 3"
                                label={{ value: 'Break Even', fill: '#9CA3AF', fontSize: 12 }}
                              />

                              {/* Shaded profit zone */}
                              {maxPips > 0 && (
                                <ReferenceArea
                                  y1={0}
                                  y2={maxPips}
                                  fill="#10B981"
                                  fillOpacity={0.1}
                                />
                              )}

                              {/* Shaded loss zone */}
                              {minPips < 0 && (
                                <ReferenceArea
                                  y1={0}
                                  y2={minPips}
                                  fill="#EF4444"
                                  fillOpacity={0.1}
                                />
                              )}

                              <Tooltip
                                contentStyle={{
                                  backgroundColor: '#1F2937',
                                  border: '1px solid #374151',
                                  borderRadius: '8px'
                                }}
                                labelStyle={{ color: '#F3F4F6' }}
                                formatter={(value: number) => [
                                  `${value >= 0 ? '+' : ''}${value.toFixed(1)} pips`,
                                  'Cumulative Profit'
                                ]}
                              />

                              {/* Conditional line with colored dots */}
                              <Line
                                type="monotone"
                                dataKey="pips"
                                stroke="#10B981"
                                strokeWidth={2}
                                dot={(props: any) => {
                                  const { cx, cy, payload } = props;
                                  return (
                                    <circle
                                      cx={cx}
                                      cy={cy}
                                      r={4}
                                      fill={payload.color}
                                      stroke="white"
                                      strokeWidth={2}
                                    />
                                  );
                                }}
                                activeDot={{ r: 6 }}
                              />
                            </LineChart>
                          );
                        })()}
                      </ResponsiveContainer>
                    ) : (
                      <div className="text-center py-12 text-slate-400">
                        No data available for selected time period
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Monthly Charts Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Monthly Profit/Loss Chart */}
                  <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-400" />
                        Monthly Profit/Loss
                      </CardTitle>
                      <CardDescription className="text-blue-200">
                        Profit in pips per month (green = profit, red = loss)
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {dualGrowthStats.allSignals.monthlyComparison.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={dualGrowthStats.allSignals.monthlyComparison.slice().reverse().map(d => ({
                            month: new Date(d.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                            pips: parseFloat(d.profit_pips),
                            color: parseFloat(d.profit_pips) >= 0 ? '#10B981' : '#EF4444'
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="month"
                              stroke="#9CA3AF"
                              style={{ fontSize: isMobile ? '10px' : '12px' }}
                              angle={isMobile ? -45 : 0}
                              textAnchor={isMobile ? 'end' : 'middle'}
                              height={isMobile ? 70 : 30}
                            />
                            <YAxis stroke="#9CA3AF" style={{ fontSize: isMobile ? '10px' : '12px' }} />
                            <ReferenceLine y={0} stroke="#6B7280" strokeWidth={2} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                              labelStyle={{ color: '#F3F4F6' }}
                              formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(1)} pips`, 'Profit']}
                            />
                            <Bar dataKey="pips" name="Profit (pips)">
                              {dualGrowthStats.allSignals.monthlyComparison.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={parseFloat(entry.profit_pips) >= 0 ? '#10B981' : '#EF4444'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center py-12 text-slate-400">
                          No data available for selected time period
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Monthly Win Rate Chart */}
                  <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Target className="w-5 h-5 text-blue-400" />
                        Monthly Win Rate
                      </CardTitle>
                      <CardDescription className="text-blue-200">
                        Percentage of winning trades per month
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {dualGrowthStats.allSignals.monthlyComparison.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={dualGrowthStats.allSignals.monthlyComparison.slice().reverse().map(d => ({
                            month: new Date(d.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                            winRate: parseFloat(d.win_rate),
                            color: parseFloat(d.win_rate) >= 50 ? '#3B82F6' : '#F59E0B'
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis
                              dataKey="month"
                              stroke="#9CA3AF"
                              style={{ fontSize: isMobile ? '10px' : '12px' }}
                              angle={isMobile ? -45 : 0}
                              textAnchor={isMobile ? 'end' : 'middle'}
                              height={isMobile ? 70 : 30}
                            />
                            <YAxis stroke="#9CA3AF" domain={[0, 100]} style={{ fontSize: isMobile ? '10px' : '12px' }} />
                            <ReferenceLine y={50} stroke="#6B7280" strokeDasharray="3 3" label={{ value: '50%', fill: '#9CA3AF' }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                              labelStyle={{ color: '#F3F4F6' }}
                              formatter={(value: number) => [`${value.toFixed(1)}%`, 'Win Rate']}
                            />
                            <Bar dataKey="winRate" name="Win Rate (%)">
                              {dualGrowthStats.allSignals.monthlyComparison.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={parseFloat(entry.win_rate) >= 50 ? '#3B82F6' : '#F59E0B'} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="text-center py-12 text-slate-400">
                          No data available for selected time period
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Symbol Performance Table */}
                <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Target className="w-5 h-5 text-purple-400" />
                      Symbol Performance
                    </CardTitle>
                    <CardDescription className="text-blue-200">
                      Compare profitability across currency pairs
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className="text-left py-3 px-4 text-sm font-semibold text-slate-300">Symbol</th>
                            <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Signals</th>
                            <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Win Rate</th>
                            <th className="text-right py-3 px-4 text-sm font-semibold text-slate-300">Profit (pips)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dualGrowthStats.allSignals.symbolPerformance.map((symbol, idx) => {
                            const profitPips = parseFloat(symbol.profit_pips);
                            const winRate = parseFloat(symbol.win_rate);
                            return (
                              <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                                <td className="py-3 px-4 font-semibold text-white">{symbol.symbol}</td>
                                <td className="py-3 px-4 text-right text-slate-300">{symbol.total_signals}</td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`font-semibold ${
                                    winRate >= 50 ? 'text-green-400' :
                                    winRate >= 35 ? 'text-yellow-400' :
                                    'text-red-400'
                                  }`}>
                                    {winRate.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <span className={`font-bold ${profitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {profitPips >= 0 ? '+' : ''}{profitPips.toFixed(1)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="bg-slate-800/80 border-slate-600/50 shadow-xl">
                <CardContent className="py-12">
                  <div className="text-center text-slate-400">
                    <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No growth data available yet</p>
                    <p className="text-sm mt-2">Signals need to be completed before growth tracking begins</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

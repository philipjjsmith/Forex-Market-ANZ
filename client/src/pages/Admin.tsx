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
  const [growthVersion, setGrowthVersion] = useState<string>('all'); // 🆕 Version filter
  const [historicalFilter, setHistoricalFilter] = useState<string>('nov4forward'); // 🆕 Date-based filter (DEFAULT: Nov 4+ only)
  const [dataQualityFilter, setDataQualityFilter] = useState<string>('production'); // 🆕 Data quality filter (DEFAULT: production only)
  const [lotSize, setLotSize] = useState<'micro' | 'mini' | 'standard'>('mini');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<any>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);

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
    queryKey: ['growth-stats-dual', growthDays, growthVersion, historicalFilter, dataQualityFilter],
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${API_ENDPOINTS.ADMIN_GROWTH_STATS_DUAL}?days=${growthDays}&version=${growthVersion}&historical=${historicalFilter}&dataQuality=${dataQualityFilter}`, {
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

  // Run FXIFY loss diagnostic
  const handleRunDiagnostic = async () => {
    setDiagnosticLoading(true);
    try {
      const token = getToken();
      const res = await fetch(API_BASE_URL + '/api/admin/diagnose-fxify-losses', {
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnosticData(data);
        setShowDiagnostic(true);
      } else {
        const errorData = await res.json();
        console.error('Diagnostic error:', errorData);
        alert(`Error ${res.status}: ${errorData.error || res.statusText}\n\nDetails: ${errorData.details || 'No additional details'}`);
      }
    } catch (error) {
      console.error('Failed to run diagnostic:', error);
      alert(`Failed to run diagnostic: ${error}`);
    } finally {
      setDiagnosticLoading(false);
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
        {/* Frankfurter API */}
        <Card className="bg-slate-800/80 border-slate-600/50 backdrop-blur-md shadow-xl">
          <CardHeader>
            <CardTitle className="text-white">Frankfurter API</CardTitle>
            <CardDescription className="text-blue-200">Real-time forex quotes (ECB data)</CardDescription>
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
                {/* Time Period Filter & Diagnostic Button */}
                <div className="flex justify-between items-center mb-6 gap-4">
                  <Button
                    onClick={handleRunDiagnostic}
                    disabled={diagnosticLoading}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  >
                    {diagnosticLoading ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running...</>
                    ) : (
                      <><AlertCircle className="h-4 w-4 mr-2" /> 🔍 Run Diagnostic</>
                    )}
                  </Button>

                  <div className="flex gap-3">
                    {/* Data Quality Filter (Professional Soft Delete) */}
                    <Select value={dataQualityFilter} onValueChange={(value) => setDataQualityFilter(value)}>
                      <SelectTrigger className="w-[240px] bg-slate-800/80 text-white border-white/30">
                        <SelectValue placeholder="Data quality" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 text-white border-white/30">
                        <SelectItem value="production">Production Only (v3.1.0+) ✅</SelectItem>
                        <SelectItem value="legacy">Legacy Data (pre-Nov 19) ⚠️</SelectItem>
                        <SelectItem value="all">All Data (Production + Legacy)</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Historical Data Filter (100% Accurate) */}
                    <Select value={historicalFilter} onValueChange={(value) => setHistoricalFilter(value)}>
                      <SelectTrigger className="w-[240px] bg-slate-800/80 text-white border-white/30">
                        <SelectValue placeholder="Data filter" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 text-white border-white/30">
                        <SelectItem value="nov4forward">Nov 4+ (Fixed System) ✅</SelectItem>
                        <SelectItem value="all">All Historical Data ⚠️</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Time Period */}
                    <Select value={growthDays.toString()} onValueChange={(value) => setGrowthDays(parseInt(value))}>
                      <SelectTrigger className="w-[180px] bg-slate-800/80 text-white border-white/30">
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
                </div>

                {/* System Upgrade Banner */}
                <Card className="bg-blue-900/30 border-blue-500/50 mb-6">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <HelpCircle className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm">
                        <p className="font-semibold text-blue-200 mb-2">📢 Data Filter Explanation</p>
                        <div className="text-blue-300 space-y-2">
                          <div>
                            <p><strong className="text-green-400">✅ Nov 4+ (Fixed System) [DEFAULT]</strong></p>
                            <p className="pl-4 text-xs">• Shows only signals from November 4, 2025 forward</p>
                            <p className="pl-4 text-xs">• 100% accurate profitability tracking</p>
                            <p className="pl-4 text-xs">• Includes all bug fixes: MACD momentum, confidence scoring, JPY pip calculations</p>
                            <p className="pl-4 text-xs">• <strong>Use this for reliable performance metrics</strong></p>
                          </div>
                          <div>
                            <p><strong className="text-yellow-400">⚠️ All Historical Data</strong></p>
                            <p className="pl-4 text-xs">• Includes old signals with known bugs (confidence inversion, wrong USD/JPY pips)</p>
                            <p className="pl-4 text-xs">• Shows -$130K total loss (94% from USD/JPY bug alone)</p>
                            <p className="pl-4 text-xs">• <strong>For comparison/research only - not representative of current system</strong></p>
                          </div>
                        </div>
                        <p className="text-blue-400 text-xs mt-3 italic">
                          💡 Tip: Keep default "Nov 4+ (Fixed System)" for accurate profitability tracking. Historical data preserved for scientific comparison.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* DIAGNOSTIC RESULTS */}
                {showDiagnostic && diagnosticData && (
                  <Card className="bg-slate-900/90 border-yellow-500/50 mb-6">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-yellow-400">🔍 FXIFY Loss Diagnostic Results</CardTitle>
                        <Button
                          onClick={() => setShowDiagnostic(false)}
                          variant="ghost"
                          size="sm"
                          className="text-slate-400 hover:text-white"
                        >
                          ✕ Close
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {/* Overall Summary */}
                        <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                          <h3 className="text-white font-bold mb-3">📊 Overall Summary</h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-slate-400">Total Signals:</p>
                              <p className="text-white font-bold">{diagnosticData.summary.total_signals}</p>
                            </div>
                            <div>
                              <p className="text-slate-400">Win Rate:</p>
                              <p className={`font-bold ${parseFloat(diagnosticData.summary.win_rate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                {diagnosticData.summary.win_rate}%
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-400">Total Pips:</p>
                              <p className={`font-bold ${parseFloat(diagnosticData.summary.total_pips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {parseFloat(diagnosticData.summary.total_pips).toFixed(2)}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-400">Total Dollars:</p>
                              <p className={`font-bold ${parseFloat(diagnosticData.summary.total_pips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ${(parseFloat(diagnosticData.summary.total_pips) * 10).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* v2.2.0 System Status - Phase 2 & 3 Tracking */}
                        {diagnosticData.pendingV220 && diagnosticData.pendingV220.count > 0 ? (
                          <div className="bg-blue-900/30 border border-blue-500/50 p-4 rounded-lg">
                            <h3 className="text-blue-400 font-bold mb-2">✅ v2.2.0 SYSTEM ACTIVE (Phase 2 & 3 Deployed)</h3>
                            <div className="space-y-2 text-sm">
                              <p className="text-blue-200">
                                <span className="font-bold">{diagnosticData.pendingV220.count} pending v2.2.0 signals</span> awaiting resolution
                              </p>
                              <p className="text-blue-300">
                                📅 First signal: {diagnosticData.pendingV220.firstSignal ? new Date(diagnosticData.pendingV220.firstSignal).toLocaleString() : 'N/A'}
                              </p>
                              <p className="text-blue-300">
                                📅 Latest signal: {diagnosticData.pendingV220.latestSignal ? new Date(diagnosticData.pendingV220.latestSignal).toLocaleString() : 'N/A'}
                              </p>
                              <p className="text-white mt-2">
                                ⏳ Signals typically take 3-7 days to resolve (swing trading strategy)
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-yellow-900/30 border border-yellow-500/50 p-4 rounded-lg">
                            <h3 className="text-yellow-400 font-bold mb-2">⚠️ NO v2.2.0 PENDING SIGNALS</h3>
                            <p className="text-yellow-200 text-sm">
                              No pending v2.2.0 signals found. Check that signal generator is running.
                            </p>
                          </div>
                        )}

                        {/* Post-Nov4 Results (Date-Based Phase 2 & 3 Performance) */}
                        {diagnosticData.postNov4 && (
                          <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-lg">
                            <h3 className="text-white font-bold mb-3">📊 Post-Nov4 Results (Phase 2 & 3 Performance)</h3>
                            {diagnosticData.postNov4.signals > 0 ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                  <div>
                                    <p className="text-slate-400">Completed:</p>
                                    <p className="text-white font-bold">{diagnosticData.postNov4.signals}</p>
                                  </div>
                                  <div>
                                    <p className="text-slate-400">Win Rate:</p>
                                    <p className={`font-bold ${parseFloat(diagnosticData.postNov4.winRate) >= 40 ? 'text-green-400' : parseFloat(diagnosticData.postNov4.winRate) >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                                      {diagnosticData.postNov4.winRate}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-slate-400">Total Pips:</p>
                                    <p className={`font-bold ${parseFloat(diagnosticData.postNov4.totalPips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {parseFloat(diagnosticData.postNov4.totalPips).toFixed(2)}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-slate-400">Record:</p>
                                    <p className="text-white font-bold">{diagnosticData.postNov4.wins}W / {diagnosticData.postNov4.losses}L</p>
                                  </div>
                                </div>

                                {/* Smart Status Analysis */}
                                {diagnosticData.postNov4.signals < 50 ? (
                                  <div className="bg-blue-900/20 border-l-4 border-blue-500 p-3 mt-3">
                                    <p className="text-blue-300 text-sm font-semibold">
                                      📊 INSUFFICIENT DATA ({diagnosticData.postNov4.signals}/50 signals)
                                    </p>
                                    <p className="text-blue-200 text-sm mt-1">
                                      Need 50-100 completed signals for statistical significance. Continue monitoring.
                                    </p>
                                  </div>
                                ) : diagnosticData.postNov4.winRate >= 40 && diagnosticData.postNov4.totalPips > 0 ? (
                                  <div className="bg-green-900/20 border-l-4 border-green-500 p-3 mt-3">
                                    <p className="text-green-300 text-sm font-semibold">
                                      ✅ PHASE 2 & 3 WORKING - System profitable!
                                    </p>
                                    <p className="text-green-200 text-sm mt-1">
                                      Win rate above 40% target. Continue monitoring for consistency.
                                    </p>
                                  </div>
                                ) : diagnosticData.postNov4.signals < 100 ? (
                                  <div className="bg-yellow-900/20 border-l-4 border-yellow-500 p-3 mt-3">
                                    <p className="text-yellow-300 text-sm font-semibold">
                                      ⚠️ MONITORING REQUIRED ({diagnosticData.postNov4.signals}/100 signals)
                                    </p>
                                    <p className="text-yellow-200 text-sm mt-1">
                                      Current win rate below target. Wait for 100 signals before taking action.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="bg-red-900/20 border-l-4 border-red-500 p-3 mt-3">
                                    <p className="text-red-300 text-sm font-semibold">
                                      🚨 ACTION REQUIRED - Win rate &lt; 30% after 100+ signals
                                    </p>
                                    <p className="text-red-200 text-sm mt-1">
                                      Phase 2 & 3 may need additional tuning. Review strategy parameters.
                                    </p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-slate-400 text-sm">
                                No completed signals since Nov 4. Signals typically take 3-7 days to resolve.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Historical Context */}
                        {(() => {
                          const oldVersions = diagnosticData.byVersion.filter((v: any) => parseFloat(v.strategy_version || '0') < 2.2);
                          if (oldVersions.length > 0) {
                            const oldPips = oldVersions.reduce((sum: number, v: any) => sum + parseFloat(v.total_pips), 0);
                            return (
                              <div className="bg-slate-800/30 border border-slate-600 p-4 rounded-lg">
                                <h3 className="text-slate-300 font-bold mb-2">📜 Historical Context</h3>
                                <p className="text-slate-400 text-sm mb-2">
                                  Pre-Phase 2 & 3 versions (&lt; v2.2.0): <span className="text-red-400 font-bold">{oldPips.toFixed(2)} pips</span>
                                </p>
                                <p className="text-slate-400 text-sm">
                                  ℹ️ Use "Nov 4+ (Fixed System)" filter in Growth Tracking to see v2.2.0 performance only
                                </p>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Strategy Version Breakdown */}
                        <div>
                          <h3 className="text-white font-bold mb-3">🔢 Performance by Strategy Version</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-800">
                                <tr>
                                  <th className="text-left p-2 text-slate-300">Version</th>
                                  <th className="text-right p-2 text-slate-300">Signals</th>
                                  <th className="text-right p-2 text-slate-300">Win Rate</th>
                                  <th className="text-right p-2 text-slate-300">Total Pips</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diagnosticData.byVersion.map((v: any, i: number) => (
                                  <tr key={i} className="border-b border-slate-700">
                                    <td className="p-2 text-white font-mono">{v.strategy_version || 'Unknown'}</td>
                                    <td className="p-2 text-right text-slate-300">{v.signals}</td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(v.win_rate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                      {v.win_rate}%
                                    </td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(v.total_pips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {parseFloat(v.total_pips).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Symbol Performance */}
                        <div>
                          <h3 className="text-white font-bold mb-3">💱 Performance by Symbol</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-800">
                                <tr>
                                  <th className="text-left p-2 text-slate-300">Symbol</th>
                                  <th className="text-right p-2 text-slate-300">Signals</th>
                                  <th className="text-right p-2 text-slate-300">Win Rate</th>
                                  <th className="text-right p-2 text-slate-300">Total Pips</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diagnosticData.bySymbol.map((s: any, i: number) => (
                                  <tr key={i} className="border-b border-slate-700">
                                    <td className="p-2 text-white font-bold">{s.symbol}</td>
                                    <td className="p-2 text-right text-slate-300">{s.signals}</td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(s.win_rate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                      {s.win_rate}%
                                    </td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(s.total_pips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {parseFloat(s.total_pips).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Monthly Performance (first 6 months) */}
                        <div>
                          <h3 className="text-white font-bold mb-3">📅 Monthly Performance</h3>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-800">
                                <tr>
                                  <th className="text-left p-2 text-slate-300">Month</th>
                                  <th className="text-right p-2 text-slate-300">Signals</th>
                                  <th className="text-right p-2 text-slate-300">Win Rate</th>
                                  <th className="text-right p-2 text-slate-300">Total Pips</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diagnosticData.monthly.slice(0, 6).map((m: any, i: number) => (
                                  <tr key={i} className="border-b border-slate-700">
                                    <td className="p-2 text-white">{m.month ? new Date(m.month).toISOString().slice(0, 7) : 'Unknown'}</td>
                                    <td className="p-2 text-right text-slate-300">{m.signals}</td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(m.win_rate) >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                                      {m.win_rate}%
                                    </td>
                                    <td className={`p-2 text-right font-bold ${parseFloat(m.total_pips) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                      {parseFloat(m.total_pips).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Export Button */}
                        <div className="flex justify-end">
                          <Button
                            onClick={() => {
                              const blob = new Blob([JSON.stringify(diagnosticData, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `fxify-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                              URL.revokeObjectURL(url);
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            💾 Export Full Report (JSON)
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* DUAL SIDE-BY-SIDE LAYOUT */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* LEFT SIDE: FXIFY PERFORMANCE (PRIMARY) */}
                  <div className="space-y-6">
                    <Card className="bg-gradient-to-br from-green-900/40 to-emerald-900/40 border-green-500/50 backdrop-blur-md shadow-2xl">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <Badge className="bg-green-500/80 text-white mb-2">🎯 FXIFY TRADING</Badge>
                            <CardTitle className="text-white text-2xl">Real Trading Performance</CardTitle>
                            <CardDescription className="text-green-200 mt-1">
                              HIGH tier signals (80+) sent to broker • {dualGrowthStats.timeframe}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const fxify = dualGrowthStats.fxifyOnly.overall;
                          const profitCalc = calculateFxifyProfit(fxify.totalProfitPips, fxify.totalSignals, 100000, 3);
                          const requirements = meetsFxifyRequirements(fxify.winRate, fxify.profitFactor, fxify.maxDrawdown, 100000);

                          return (
                            <div className="space-y-6">
                              {/* Key Metrics */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Total Profit</p>
                                  <p className={`text-3xl font-black ${fxify.totalProfitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {formatDollars(profitCalc.totalDollars)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.totalProfitPips >= 0 ? '+' : ''}{fxify.totalProfitPips.toFixed(1)} pips
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Win Rate</p>
                                  <p className="text-3xl font-black text-white">{fxify.winRate.toFixed(1)}%</p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.wins}W / {fxify.losses}L
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Monthly Projection</p>
                                  <p className="text-2xl font-black text-green-400">
                                    {formatDollars(profitCalc.monthlyDollars)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    Based on {profitCalc.projectedMonthlyTrades} trades/mo
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Profit Factor</p>
                                  <p className={`text-2xl font-black ${
                                    fxify.profitFactor >= 2.5 ? 'text-green-400' :
                                    fxify.profitFactor >= 1.5 ? 'text-yellow-400' :
                                    'text-red-400'
                                  }`}>
                                    {fxify.profitFactor.toFixed(2)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.profitFactor >= 2.5 ? '⭐ Excellent' :
                                     fxify.profitFactor >= 1.5 ? '✓ Good' :
                                     '✗ Below Target'}
                                  </p>
                                </div>
                              </div>

                              {/* FXIFY Readiness */}
                              <div className={`p-4 rounded-lg border-2 ${
                                requirements.meetsRequirements
                                  ? 'bg-green-900/20 border-green-500/50'
                                  : 'bg-yellow-900/20 border-yellow-500/50'
                              }`}>
                                <p className="font-semibold text-white mb-2">
                                  {requirements.meetsRequirements ? '✅ FXIFY Ready' : '⚠️ Needs Improvement'}
                                </p>
                                {requirements.issues.length > 0 && (
                                  <ul className="text-xs text-yellow-300 space-y-1">
                                    {requirements.issues.map((issue, idx) => (
                                      <li key={idx}>• {issue}</li>
                                    ))}
                                  </ul>
                                )}
                                {requirements.meetsRequirements && (
                                  <p className="text-xs text-green-300">All FXIFY requirements met</p>
                                )}
                              </div>

                              {/* Stats Summary */}
                              <div className="flex justify-between text-xs text-green-300">
                                <div>
                                  <span className="text-slate-400">Signals:</span> {fxify.totalSignals}
                                </div>
                                <div>
                                  <span className="text-slate-400">Avg Win:</span> +{fxify.avgWinPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-400">Avg Loss:</span> -{fxify.avgLossPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-400">Max DD:</span> -{fxify.maxDrawdown.toFixed(1)}p
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>

                    {/* FXIFY Symbol Performance */}
                    <Card className="bg-slate-800/80 border-green-500/30 shadow-xl">
                      <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                          <Target className="w-5 h-5 text-green-400" />
                          FXIFY Symbol Performance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-300">Symbol</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-300">Signals</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-300">Win Rate</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-300">Profit (pips)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dualGrowthStats.fxifyOnly.symbolPerformance.map((symbol, idx) => {
                                const profitPips = parseFloat(symbol.profit_pips);
                                const winRate = parseFloat(symbol.win_rate);
                                return (
                                  <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                    <td className="py-2 px-3 font-semibold text-white">{symbol.symbol}</td>
                                    <td className="py-2 px-3 text-center text-slate-300">{symbol.total_signals}</td>
                                    <td className="py-2 px-3 text-center">
                                      <span className={`font-semibold ${
                                        winRate >= 50 ? 'text-green-400' :
                                        winRate >= 40 ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>
                                        {winRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right">
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
                  </div>

                  {/* RIGHT SIDE: ALL SIGNALS (SECONDARY) */}
                  <div className="space-y-6">
                    <Card className="bg-slate-800/60 border-slate-600/50 backdrop-blur-md shadow-xl">
                      <CardHeader>
                        <div>
                          <Badge className="bg-slate-500/80 text-white mb-2">📊 SYSTEM LEARNING</Badge>
                          <CardTitle className="text-white text-xl">All Signals (Including Practice)</CardTitle>
                          <CardDescription className="text-slate-300 mt-1">
                            HIGH + MEDIUM tier for AI training • {dualGrowthStats.timeframe}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const all = dualGrowthStats.allSignals.overall;
                          const comp = dualGrowthStats.comparison;

                          return (
                            <div className="space-y-6">
                              {/* Key Metrics */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Total Profit</p>
                                  <p className={`text-2xl font-bold ${all.totalProfitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {all.totalProfitPips >= 0 ? '+' : ''}{all.totalProfitPips.toFixed(1)} pips
                                  </p>
                                  {comp.profitDiff !== 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                      ({comp.profitDiff >= 0 ? '+' : ''}{comp.profitDiff.toFixed(1)}p FXIFY diff)
                                    </p>
                                  )}
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Win Rate</p>
                                  <p className="text-2xl font-bold text-white">{all.winRate.toFixed(1)}%</p>
                                  {comp.winRateDiff !== 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                      ({comp.winRateDiff >= 0 ? '+' : ''}{comp.winRateDiff.toFixed(1)}% FXIFY diff)
                                    </p>
                                  )}
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Total Signals</p>
                                  <p className="text-2xl font-bold text-white">{all.totalSignals}</p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {all.wins}W / {all.losses}L
                                  </p>
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Profit Factor</p>
                                  <p className="text-2xl font-bold text-white">{all.profitFactor.toFixed(2)}</p>
                                </div>
                              </div>

                              {/* Comparison Insight */}
                              {comp.signalCountDiff > 0 && (
                                <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-500/30">
                                  <p className="font-semibold text-blue-300 mb-2">
                                    🧠 AI Learning Progress
                                  </p>
                                  <p className="text-sm text-slate-300">
                                    <span className="font-bold text-white">{comp.signalCountDiff}</span> paper trade signals (70-79% confidence) are being used to train the AI. These are NOT sent to FXIFY.
                                  </p>
                                  {comp.winRateDiff > 0 && (
                                    <p className="text-xs text-blue-400 mt-2">
                                      💡 FXIFY signals are {comp.winRateDiff.toFixed(1)}% more accurate
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Stats Summary */}
                              <div className="flex justify-between text-xs text-slate-400">
                                <div>
                                  <span className="text-slate-500">Avg Win:</span> +{all.avgWinPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-500">Avg Loss:</span> -{all.avgLossPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-500">Max DD:</span> -{all.maxDrawdown.toFixed(1)}p
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>

                    {/* All Signals Symbol Performance */}
                    <Card className="bg-slate-800/60 border-slate-600/50 shadow-xl">
                      <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-slate-400" />
                          All Signals Symbol Performance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-400">Symbol</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-400">Signals</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-400">Win Rate</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-400">Profit (pips)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dualGrowthStats.allSignals.symbolPerformance.map((symbol, idx) => {
                                const profitPips = parseFloat(symbol.profit_pips);
                                const winRate = parseFloat(symbol.win_rate);
                                return (
                                  <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                    <td className="py-2 px-3 font-semibold text-slate-300">{symbol.symbol}</td>
                                    <td className="py-2 px-3 text-center text-slate-400">{symbol.total_signals}</td>
                                    <td className="py-2 px-3 text-center">
                                      <span className={`font-semibold ${
                                        winRate >= 50 ? 'text-green-400' :
                                        winRate >= 35 ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>
                                        {winRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right">
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
                  </div>
                </div>
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

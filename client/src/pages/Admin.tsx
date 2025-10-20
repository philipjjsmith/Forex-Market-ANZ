import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, TrendingUp, AlertCircle, RefreshCw, Play, Pause, Clock, CheckCircle, Calendar, Database, Zap, Brain } from 'lucide-react';
import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '@/config/api';
import { useLocation } from 'wouter';

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

export default function Admin() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [triggeringGeneration, setTriggeringGeneration] = useState(false);
  const [countdown, setCountdown] = useState<string>('');

  // Fetch system health
  const { data: health, isLoading: healthLoading } = useQuery<SystemHealth>({
    queryKey: [API_ENDPOINTS.ADMIN_HEALTH],
    queryFn: async () => {
      const response = await fetch(API_ENDPOINTS.ADMIN_HEALTH, {
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
      const response = await fetch(API_ENDPOINTS.ADMIN_LOGS, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch logs');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Manual trigger mutation
  const triggerGeneration = useMutation({
    mutationFn: async () => {
      const response = await fetch(API_ENDPOINTS.ADMIN_TRIGGER_GENERATION, {
        method: 'POST',
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

  if (healthLoading) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div className="container mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-blue-200 mt-1">Monitor system health and signal generation</p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => setLocation('/ai-insights')}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Brain className="h-4 w-4 mr-2" />
              AI Insights
            </Button>
            <Button
              onClick={handleTriggerGeneration}
              disabled={triggeringGeneration || health?.signalGenerator.isRunning}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {triggeringGeneration ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Trigger Generation Now
                </>
              )}
            </Button>
          </div>
      </div>

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
      </div>
    </div>
  );
}

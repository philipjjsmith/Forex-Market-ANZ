import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Activity, TrendingUp, TrendingDown, Target, BarChart3, AlertTriangle, CheckCircle, XCircle, Star, Clock, Zap, LogOut, User, GraduationCap, Settings } from 'lucide-react';
import { Indicators } from '@/lib/indicators';
import { MACrossoverStrategy, Signal } from '@/lib/strategy';
import { ComprehensiveSignalCard } from '@/components/ComprehensiveSignalCard';
import { useQuotaTracker } from '@/hooks/use-quota-tracker';
import { generateCandlesFromQuote } from '@/lib/candle-generator';
import { API_ENDPOINTS } from '@/config/api';
import { getCurrentUser, logout, getToken, type User as AuthUser } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [pairs] = useState(['EUR/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF']); // GBP/USD disabled (signal-generator.ts:664)
  const [selectedPair, setSelectedPair] = useState('EUR/USD');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketData, setMarketData] = useState<Record<string, { candles: any[], currentPrice: number }>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState('all');
  const [signalTypeFilter, setSignalTypeFilter] = useState('all');
  const [savedSignals, setSavedSignals] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'signals' | 'saved'>('signals');
  const [apiError, setApiError] = useState<string | null>(null);

  // Toast notifications
  const { toast } = useToast();

  // Quota tracking
  const { remainingAnalyses, canAnalyze, useAnalysis, dailyLimit, timeUntilReset } = useQuotaTracker();

  // Load saved signals from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('savedSignals');
    if (saved) {
      setSavedSignals(JSON.parse(saved));
    }
  }, []);

  const toggleSaveSignal = (signalId: string) => {
    setSavedSignals(prev => {
      const newSaved = prev.includes(signalId)
        ? prev.filter(id => id !== signalId)
        : [...prev, signalId];
      localStorage.setItem('savedSignals', JSON.stringify(newSaved));
      return newSaved;
    });
  };

  const generateDemoSignal = (pair: string, candles: any[]): Signal => {
    const currentPrice = candles[candles.length - 1].close;
    const atr = Indicators.atr(candles, 14) || 0.0015;
    const type = Math.random() > 0.5 ? 'LONG' : 'SHORT';
    const stopDistance = atr * 2;
    
    const entryPrice = parseFloat(currentPrice.toFixed(5));
    const priceVariation = (Math.random() - 0.5) * 0.002;
    const adjustedEntry = parseFloat((currentPrice * (1 + priceVariation)).toFixed(5));
    
    let orderType: string;
    let executionType: string;
    
    if (Math.abs(adjustedEntry - currentPrice) < 0.00010) {
      orderType = 'MARKET';
      executionType = 'FILL_OR_KILL';
    } else if (type === 'LONG') {
      if (adjustedEntry < currentPrice) {
        orderType = 'BUY_LIMIT';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      } else {
        orderType = 'BUY_STOP';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      }
    } else {
      if (adjustedEntry > currentPrice) {
        orderType = 'SELL_LIMIT';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      } else {
        orderType = 'SELL_STOP';
        executionType = Math.random() > 0.5 ? 'GTC' : 'DAY';
      }
    }
    
    if (Math.random() > 0.7 && orderType !== 'MARKET') {
      orderType = type === 'LONG' ? 'BUY_STOP_LIMIT' : 'SELL_STOP_LIMIT';
    }

    // MT5 Requirements: BUY_STOP_LIMIT limit is BELOW stop, SELL_STOP_LIMIT limit is ABOVE stop
    const stopLimitPrice = (orderType === 'BUY_STOP_LIMIT' || orderType === 'SELL_STOP_LIMIT')
      ? parseFloat((adjustedEntry + (type === 'LONG' ? -0.00015 : 0.00015)).toFixed(5))
      : undefined;
    
    return {
      id: `SIG_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      type: type,
      symbol: pair,
      entry: adjustedEntry,
      currentPrice: parseFloat(currentPrice.toFixed(5)),
      orderType: orderType,
      executionType: executionType,
      stop: type === 'LONG' 
        ? parseFloat((adjustedEntry - stopDistance).toFixed(5))
        : parseFloat((adjustedEntry + stopDistance).toFixed(5)),
      stopLimitPrice,
      targets: type === 'LONG' ? [
        parseFloat((adjustedEntry + stopDistance * 1.5).toFixed(5)),
        parseFloat((adjustedEntry + stopDistance * 2.5).toFixed(5)),
        parseFloat((adjustedEntry + stopDistance * 4).toFixed(5))
      ] : [
        parseFloat((adjustedEntry - stopDistance * 1.5).toFixed(5)),
        parseFloat((adjustedEntry - stopDistance * 2.5).toFixed(5)),
        parseFloat((adjustedEntry - stopDistance * 4).toFixed(5))
      ],
      riskReward: 2.5,
      confidence: Math.floor(Math.random() * 30) + 55,
      indicators: {
        fastMA: currentPrice.toFixed(5),
        slowMA: (currentPrice * 0.998).toFixed(5),
        rsi: (Math.random() * 40 + 30).toFixed(2),
        atr: atr.toFixed(5),
        adx: (Math.random() * 30 + 20).toFixed(2),
        bbUpper: (currentPrice * 1.002).toFixed(5),
        bbLower: (currentPrice * 0.998).toFixed(5),
        htfTrend: type === 'LONG' ? 'UP' : 'DOWN'
      },
      rationale: type === 'LONG' 
        ? 'Bullish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bullish. Volatility is moderate.'
        : 'Bearish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bearish. Volatility is moderate.',
      strategy: 'MA Crossover Multi-Timeframe',
      version: '1.0.0',
      status: 'active'
    };
  };

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

  // Handle logout
  const handleLogout = async () => {
    await logout();
    setLocation('/login');
  };

  const analyzeMarket = useCallback(async () => {
    // Check quota before analyzing
    if (!canAnalyze) {
      toast({
        title: "Analysis Limit Reached",
        description: `Daily limit of ${dailyLimit} analyses reached. Resets in ${timeUntilReset}.`,
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setApiError(null);

    try {
      if (import.meta.env.DEV) {
        console.log('🚀 Analyzing markets using v3.1.0 ICT methodology...');
      }

      // Use one analysis from quota
      const quotaUsed = useAnalysis();
      if (!quotaUsed) {
        throw new Error('Failed to use analysis quota');
      }

      const pairs = ['EUR/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'];
      const newSignals: Signal[] = [];
      const newMarketData: Record<string, { candles: any[], currentPrice: number }> = {};

      // Fetch current prices for display (still using Frankfurter for quotes)
      const priceResponse = await fetch(API_ENDPOINTS.FOREX_QUOTES);
      const priceResult = await priceResponse.json();
      const priceMap: Record<string, number> = {};

      if (priceResult.success && priceResult.data) {
        priceResult.data.forEach((quote: any) => {
          priceMap[quote.symbol] = quote.exchangeRate;
        });
      }

      // Call SERVER endpoint for each pair (v3.1.0 ICT analysis)
      for (const pair of pairs) {
        try {
          if (import.meta.env.DEV) {
            console.log(`🔍 Analyzing ${pair} on server...`);
          }

          const response = await fetch(API_ENDPOINTS.SIGNALS_ANALYZE, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ symbol: pair })
          });

          const result = await response.json();

          if (result.success && result.signal) {
            const signal = result.signal;

            newSignals.push({
              ...signal,
              symbol: pair,
              status: 'active'
            });

            if (import.meta.env.DEV) {
              console.log(`✅ ${pair}: ${result.message}`);
            }

            // Store candles and current price for chart display
            newMarketData[pair] = {
              candles: result.candles || [],
              currentPrice: signal.currentPrice
            };
          } else if (result.success && !result.signal) {
            if (import.meta.env.DEV) {
              console.log(`ℹ️ ${pair}: No signal (market not aligned)`);
            }

            // No signal, no candles needed
            newMarketData[pair] = {
              candles: [],
              currentPrice: priceMap[pair] || 1.0
            };
          } else {
            // Check if it's a rate limit error
            if (result.isRateLimit) {
              console.warn(`⚠️  ${pair}: API rate limit - using cached data`);
            } else {
              console.error(`❌ ${pair}: ${result.error}`);
            }

            // Error case, no data available
            newMarketData[pair] = {
              candles: [],
              currentPrice: priceMap[pair] || 1.0
            };
          }

        } catch (error) {
          console.error(`❌ Error analyzing ${pair}:`, error);
        }
      }

      // Update state with new v3.1.0 signals
      setSignals(prev => [...newSignals, ...prev].slice(0, 20));
      setMarketData(newMarketData);

      // Show success toast
      if (newSignals.length > 0) {
        toast({
          title: "✅ Analysis Complete",
          description: `Generated ${newSignals.length} v3.1.0 signal${newSignals.length > 1 ? 's' : ''} using ICT methodology`,
          duration: 5000,
        });
      } else {
        toast({
          title: "ℹ️ No Signals Generated",
          description: "Market conditions not aligned (W+D+4H timeframes must match)",
          duration: 5000,
        });
      }

      if (import.meta.env.DEV) {
        console.log(`✅ Generated ${newSignals.length} v3.1.0 signals from server`);
      }

    } catch (error: any) {
      if (import.meta.env.DEV) {
        console.error('❌ Error analyzing market:', error);
      }
      setApiError(error.message || 'Failed to analyze market. Please try again.');
      toast({
        title: "❌ Analysis Failed",
        description: error.message || 'Failed to analyze market',
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [canAnalyze, dailyLimit, timeUntilReset, useAnalysis, toast]);

  // Initial analysis on mount (commented out to save quota)
  // useEffect(() => {
  //   analyzeMarket();
  // }, []);

  const activeSignals = signals.filter(s => {
    if (s.status !== 'active') return false;

    // Tier-based filtering: Live Trading (80-100%) vs Practice (70-79%)
    if (confidenceFilter === 'live' && s.confidence < 80) return false;
    if (confidenceFilter === 'practice' && (s.confidence < 70 || s.confidence >= 80)) return false;

    if (signalTypeFilter !== 'all' && s.type !== signalTypeFilter) return false;

    return true;
  });

  const displaySignals = activeTab === 'saved' 
    ? signals.filter(s => savedSignals.includes(s.id))
    : activeSignals;
  
  const currentData = marketData[selectedPair];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-3 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between mb-2 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500 rounded-lg">
                <Activity className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Forex Signal Engine</h1>
                <p className="text-blue-300">Multi-Timeframe Analysis Platform</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:gap-4">
              {/* Analytics Button */}
              <button
                onClick={() => setLocation('/analytics')}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
                title="View AI Analytics"
              >
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm font-medium">Analytics</span>
              </button>

              {/* Learn Button */}
              <button
                onClick={() => setLocation('/learn')}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                title="Learn Forex Trading"
              >
                <GraduationCap className="w-4 h-4" />
                <span className="text-sm font-medium">Learn</span>
              </button>

              {/* Admin Button - Only visible for admin users */}
              {user && user.role === 'admin' && (
                <button
                  onClick={() => setLocation('/admin')}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Admin Dashboard"
                >
                  <Settings className="w-4 h-4" />
                  <span className="text-sm font-medium">Admin</span>
                </button>
              )}

              {/* User Info & Logout */}
              {user && (
                <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">
                  <User className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium">{user.username}</span>
                  <button
                    onClick={handleLogout}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Logout"
                  >
                    <LogOut className="w-4 h-4 text-slate-400 hover:text-red-400" />
                  </button>
                </div>
              )}
              {/* Quota Display */}
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold">
                    {remainingAnalyses}/{dailyLimit} Analyses Remaining
                  </span>
                </div>
                <span className="text-xs text-slate-400">
                  Resets in {timeUntilReset}
                </span>
              </div>

              {/* Analyze Button */}
              <button
                onClick={analyzeMarket}
                disabled={isAnalyzing || !canAnalyze}
                className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-all ${
                  !canAnalyze
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                } disabled:opacity-70`}
                data-testid="button-analyze-now"
              >
                <BarChart3 className="w-4 h-4" />
                {isAnalyzing ? 'Analyzing...' : canAnalyze ? 'Analyze Now' : 'Limit Reached'}
              </button>
            </div>
          </div>

          {/* API Error Display */}
          {apiError && (
            <div className="mt-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <span className="text-red-300 text-sm">{apiError}</span>
            </div>
          )}
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Active Signals</span>
              <Activity className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold" data-testid="text-active-signals">{activeSignals.length}</div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">LONG Signals</span>
              <TrendingUp className="w-4 h-4 text-green-400" />
            </div>
            <div className="text-2xl font-bold text-green-400" data-testid="text-long-signals">
              {activeSignals.filter(s => s.type === 'LONG').length}
            </div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">SHORT Signals</span>
              <TrendingDown className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-bold text-red-400" data-testid="text-short-signals">
              {activeSignals.filter(s => s.type === 'SHORT').length}
            </div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400 text-sm">Avg Confidence</span>
              <Target className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-bold text-purple-400" data-testid="text-avg-confidence">
              {activeSignals.length > 0 
                ? Math.round(activeSignals.reduce((sum, s) => sum + s.confidence, 0) / activeSignals.length)
                : 0}%
            </div>
          </div>
        </div>

        {/* Pair Selector */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {pairs.map(pair => (
              <button
                key={pair}
                onClick={() => setSelectedPair(pair)}
                className={`px-4 py-2 rounded-lg transition-all ${
                  selectedPair === pair
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                data-testid={`button-pair-${pair.replace('/', '-')}`}
              >
                {pair}
                {currentData && pair === selectedPair && (
                  <span className="ml-2 text-xs opacity-75">
                    {currentData.currentPrice.toFixed(5)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Section */}
        <div className="mb-6 bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-6">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400 font-semibold">Signal Quality:</span>
              <select
                value={confidenceFilter}
                onChange={(e) => setConfidenceFilter(e.target.value)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 hover:border-blue-500 focus:border-blue-500 focus:outline-none cursor-pointer transition-all"
                data-testid="select-confidence-filter"
              >
                <option value="all">📊 All Signals</option>
                <option value="live">🔵 Live Trading (80-100%)</option>
                <option value="practice">⚪ Practice Signal (70-79%)</option>
              </select>
            </div>

            <div className="lg:border-l border-slate-600 lg:pl-6 flex items-center gap-3">
              <span className="text-sm text-slate-400 font-semibold">Signal Type:</span>
              <select
                value={signalTypeFilter}
                onChange={(e) => setSignalTypeFilter(e.target.value)}
                className="px-4 py-2 rounded-lg bg-slate-700 text-white border border-slate-600 hover:border-blue-500 focus:border-blue-500 focus:outline-none cursor-pointer transition-all"
                data-testid="select-signal-type-filter"
              >
                <option value="all">All Types</option>
                <option value="LONG">🔼 LONG Only</option>
                <option value="SHORT">🔽 SHORT Only</option>
              </select>
            </div>

            <div className="lg:border-l border-slate-600 lg:pl-6 flex items-center gap-3">
              <button
                onClick={() => setActiveTab('signals')}
                className={`px-4 py-2 rounded-lg transition-all ${
                  activeTab === 'signals' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                data-testid="button-tab-signals"
              >
                Active Signals
              </button>
              <button
                onClick={() => setActiveTab('saved')}
                className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                  activeTab === 'saved' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
                data-testid="button-tab-saved"
              >
                <Star className="w-4 h-4" />
                Saved ({savedSignals.length})
              </button>
            </div>

            <div className="lg:ml-auto flex items-center gap-3">
              <div className="text-sm text-slate-400">
                Showing <span className="font-bold text-white text-lg">{displaySignals.length}</span> signal{displaySignals.length !== 1 ? 's' : ''}
              </div>
              {(confidenceFilter !== 'all' || signalTypeFilter !== 'all') && (
                <button
                  onClick={() => {
                    setConfidenceFilter('all');
                    setSignalTypeFilter('all');
                  }}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-all"
                  data-testid="button-clear-filters"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Signals List */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-400" />
              {activeTab === 'saved' ? 'Saved Trading Signals' : 'Active Trading Signals'}
            </h2>
            
            {displaySignals.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-8 text-center border border-slate-700">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                <p className="text-slate-400">
                  {activeTab === 'saved' 
                    ? 'No saved signals yet. Click the star icon on any signal to save it.'
                    : 'No signals generated yet. Click "Analyze Now" to scan the market.'}
                </p>
              </div>
            ) : (
              displaySignals.map(signal => (
                <ComprehensiveSignalCard
                  key={signal.id}
                  signal={signal}
                  candles={marketData[signal.symbol]?.candles}
                  onToggleSave={toggleSaveSignal}
                  isSaved={savedSignals.includes(signal.id)}
                />
              ))
            )}
          </div>

          {/* Market Data & Indicators */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-purple-400" />
              Market Indicators
            </h2>
            
            {currentData && (() => {
              const closes = currentData.candles.map((c: any) => c.close);
              const rsi = Indicators.rsi(closes, 14);
              const bb = Indicators.bollingerBands(closes, 20, 2);
              const atr = Indicators.atr(currentData.candles, 14);
              const adx = Indicators.adx(currentData.candles, 14);
              const fastMA = Indicators.ema(closes, 20);
              const slowMA = Indicators.ema(closes, 50);

              return (
                <div className="bg-slate-800 rounded-lg p-5 border border-slate-700">
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">Current Price</span>
                        <span className="font-bold text-lg" data-testid="text-current-price">{currentData.currentPrice.toFixed(5)}</span>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">RSI (14)</span>
                        <span className={`font-bold ${
                          rsi && rsi > 70 ? 'text-red-400' : rsi && rsi < 30 ? 'text-green-400' : 'text-yellow-400'
                        }`} data-testid="text-rsi">
                          {rsi ? rsi.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            rsi && rsi > 70 ? 'bg-red-500' : rsi && rsi < 30 ? 'bg-green-500' : 'bg-yellow-500'
                          }`}
                          style={{ width: `${rsi || 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-slate-400">ADX (14)</span>
                        <span className={`font-bold ${
                          adx && adx.adx > 25 ? 'text-green-400' : 'text-yellow-400'
                        }`} data-testid="text-adx">
                          {adx ? adx.adx.toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {adx && adx.adx > 25 ? 'Strong Trend' : 'Weak Trend'}
                      </p>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-sm text-slate-400 mb-2">Moving Averages</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">EMA 20</span>
                          <span className="text-sm font-mono">{fastMA ? fastMA.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">EMA 50</span>
                          <span className="text-sm font-mono">{slowMA ? slowMA.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {fastMA && slowMA && (
                            <>
                              {fastMA > slowMA ? (
                                <><CheckCircle className="w-3 h-3 text-green-400" /> <span className="text-green-400">Bullish Alignment</span></>
                              ) : (
                                <><XCircle className="w-3 h-3 text-red-400" /> <span className="text-red-400">Bearish Alignment</span></>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <p className="text-sm text-slate-400 mb-2">Bollinger Bands</p>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Upper</span>
                          <span className="text-sm font-mono">{bb ? bb.upper.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Middle</span>
                          <span className="text-sm font-mono">{bb ? bb.middle.toFixed(5) : 'N/A'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-slate-500">Lower</span>
                          <span className="text-sm font-mono">{bb ? bb.lower.toFixed(5) : 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-slate-700 pt-4">
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-400">ATR (14)</span>
                        <span className="text-sm font-mono" data-testid="text-atr">{atr ? atr.toFixed(5) : 'N/A'}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">Average True Range - Volatility Measure</p>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

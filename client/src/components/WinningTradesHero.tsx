import { useState, useEffect } from "react";
import { Trophy, Loader2, TrendingUp, TrendingDown, Target, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import WinningTradeChart from "./WinningTradeChart";
import { useQuery } from "@tanstack/react-query";
import { getToken, getApiBaseUrl } from "@/lib/auth";

interface Candle {
  date?: string;
  timestamp?: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface WinningTrade {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  outcome: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT';
  outcome_price: number;
  outcome_time: string;
  profit_loss_pips: number;
  indicators: {
    rsi: string;
    adx: string;
    macd: {
      value: number;
      signal: number;
      histogram: number;
    };
    ema20: number;
    ema50: number;
    atr: number;
    bb: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
  candles: Candle[];
  strategy_name: string;
  strategy_version: string;
  created_at: string;
  duration: string;
  durationHours: number;
  achievedRR: number;
}

async function fetchWinningTrades(limit: number = 5): Promise<WinningTrade[]> {
  const token = getToken();
  const response = await fetch(`${getApiBaseUrl()}/api/signals/winning-trades-week?limit=${limit}`, {
    headers: {
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch winning trades');
  }

  const data = await response.json();
  return data.trades || [];
}

export default function WinningTradesHero() {
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { data: trades, isLoading, error } = useQuery({
    queryKey: ['winning-trades-week'],
    queryFn: () => fetchWinningTrades(5),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 15 * 60 * 1000, // Refetch every 15 minutes
  });

  // Reset featured index when trades change
  useEffect(() => {
    setFeaturedIndex(0);
  }, [trades]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!trades || trades.length === 0) return;

      if (e.key === 'ArrowLeft' && featuredIndex > 0) {
        handleFeatureChange(featuredIndex - 1);
      } else if (e.key === 'ArrowRight' && featuredIndex < trades.length - 1) {
        handleFeatureChange(featuredIndex + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [featuredIndex, trades]);

  const handleFeatureChange = (index: number) => {
    if (isTransitioning) return; // Prevent multiple rapid transitions

    setIsTransitioning(true);
    setFeaturedIndex(index);

    // Reset transition lock after animation completes
    setTimeout(() => {
      setIsTransitioning(false);
    }, 700); // 600ms animation + 100ms buffer
  };

  // Loading state
  if (isLoading) {
    return (
      <Card className="w-full bg-slate-900 border-slate-800">
        <CardContent className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
            <p className="text-slate-400">Loading winning trades...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="w-full border-red-900 bg-red-950/50">
        <CardContent className="py-8 text-center">
          <p className="text-red-400">Failed to load winning trades. Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  // Empty state - no winning trades this week
  if (!trades || trades.length === 0) {
    return (
      <Card className="w-full bg-slate-900 border-slate-800">
        <CardContent className="py-16 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-blue-900/30 rounded-full flex items-center justify-center">
              <Trophy className="h-8 w-8 text-blue-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-slate-100 mb-2">No Winning Trades Yet This Week</h3>
              <p className="text-slate-400 max-w-md mx-auto">
                Check back soon! Our signal generator runs every 15 minutes to identify high-probability trading opportunities.
                When signals hit their profit targets, they'll appear here.
              </p>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-slate-400 pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <span>3-7 signals/week expected</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <span>65-75% win rate target</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const featuredTrade = trades[featuredIndex];
  const isLong = featuredTrade.type === 'LONG';
  const targetHit = featuredTrade.outcome === 'TP1_HIT' ? 1 : featuredTrade.outcome === 'TP2_HIT' ? 2 : 3;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border border-emerald-500/30">
            <Trophy className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Winning Trades This Week</h2>
            <p className="text-sm text-slate-400">
              {trades.length} {trades.length === 1 ? 'win' : 'wins'} • Live trading results
            </p>
          </div>
        </div>
      </div>

      {/* Featured Trade Hero Section (60-70vh) */}
      <div className="relative">
        {/* Featured Trade Container with fade+zoom animation */}
        <div
          key={featuredTrade.signal_id}
          className={`relative min-h-[60vh] lg:min-h-[70vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl transition-all duration-700 ${
            isTransitioning ? 'animate-fadeZoom' : ''
          }`}
        >
          {/* Glassmorphic Overlays - Top Left: Symbol & Profit */}
          <div className="absolute top-6 left-6 z-10 backdrop-blur-md bg-slate-900/60 rounded-xl border border-slate-700/50 p-4 shadow-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${isLong ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-rose-500/20 border border-rose-500/30'}`}>
                {isLong ? (
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-rose-400" />
                )}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-100">{featuredTrade.symbol}</h3>
                <Badge variant={isLong ? "default" : "destructive"} className="mt-1">
                  {featuredTrade.type}
                </Badge>
              </div>
            </div>
            <div className="text-3xl font-bold text-emerald-400">
              +{featuredTrade.profit_loss_pips.toFixed(1)} pips
            </div>
            <div className="text-sm text-slate-400 mt-1">
              {featuredTrade.achievedRR.toFixed(2)}:1 Risk:Reward
            </div>
          </div>

          {/* Glassmorphic Overlays - Top Right: Confidence Badge */}
          <div className="absolute top-6 right-6 z-10 backdrop-blur-md bg-slate-900/60 rounded-xl border border-slate-700/50 p-4 shadow-xl">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400 mb-1">
                {featuredTrade.confidence}%
              </div>
              <div className="text-xs text-slate-400 mb-2">Confidence</div>
              <Badge className={`${featuredTrade.tier === 'HIGH' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'}`}>
                {featuredTrade.tier === 'HIGH' ? 'LIVE TRADING' : 'PRACTICE'}
              </Badge>
            </div>
          </div>

          {/* Glassmorphic Overlays - Bottom Right: Trade Details */}
          <div className="absolute bottom-6 right-6 z-10 backdrop-blur-md bg-slate-900/60 rounded-xl border border-slate-700/50 p-4 shadow-xl">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <Clock className="h-3 w-3" />
                  <span>Duration</span>
                </div>
                <div className="font-semibold text-sm text-slate-100">{featuredTrade.duration}</div>
              </div>
              <div>
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <Target className="h-3 w-3" />
                  <span>Target Hit</span>
                </div>
                <div className="font-semibold text-sm text-emerald-400">TP{targetHit}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Entry</div>
                <div className="font-semibold text-sm text-slate-100 font-mono">
                  {featuredTrade.entry_price.toFixed(5)}
                </div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Exit</div>
                <div className="font-semibold text-sm text-emerald-400 font-mono">
                  {featuredTrade.outcome_price.toFixed(5)}
                </div>
              </div>
            </div>
          </div>

          {/* Chart - Takes full space */}
          <div className="h-[60vh] lg:h-[70vh] w-full">
            <WinningTradeChart
              candles={featuredTrade.candles}
              entryPrice={featuredTrade.entry_price}
              entryTime={new Date(featuredTrade.created_at).getTime() / 1000}
              exitPrice={featuredTrade.outcome_price}
              exitTime={new Date(featuredTrade.outcome_time).getTime() / 1000}
              stopLoss={featuredTrade.stop_loss}
              tp1={featuredTrade.tp1}
              tp2={featuredTrade.tp2}
              tp3={featuredTrade.tp3}
              type={isLong ? 'long' : 'short'}
              targetHit={targetHit}
              height={600}
            />
          </div>
        </div>

        {/* Keyboard Navigation Hint */}
        <div className="absolute bottom-[-2rem] left-1/2 -translate-x-1/2 text-xs text-slate-500 hidden md:block">
          Use ← → arrow keys to navigate
        </div>
      </div>

      {/* Thumbnail Gallery */}
      {trades.length > 1 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {trades.map((trade, index) => {
            const isFeatured = index === featuredIndex;
            const tradeIsLong = trade.type === 'LONG';

            return (
              <button
                key={trade.signal_id}
                onClick={() => handleFeatureChange(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFeatureChange(index);
                  }
                }}
                className={`group relative bg-slate-900 rounded-lg border overflow-hidden transition-all duration-300 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isFeatured
                    ? 'border-blue-500 shadow-lg shadow-blue-500/20 scale-105'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
                aria-label={`View ${trade.symbol} trade, ${trade.profit_loss_pips.toFixed(1)} pips profit`}
                tabIndex={0}
              >
                {/* Featured Indicator */}
                {isFeatured && (
                  <div className="absolute top-2 right-2 z-10">
                    <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full font-semibold">
                      Featured
                    </div>
                  </div>
                )}

                {/* Thumbnail Content */}
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`p-1.5 rounded ${tradeIsLong ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                      {tradeIsLong ? (
                        <TrendingUp className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-rose-400" />
                      )}
                    </div>
                    <h4 className="font-semibold text-slate-100 text-sm">{trade.symbol}</h4>
                  </div>
                  <div className="text-xl font-bold text-emerald-400">
                    +{trade.profit_loss_pips.toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {trade.achievedRR.toFixed(2)}:1 R:R
                  </div>

                  {/* Mini Chart Preview */}
                  <div className="mt-3 h-16 relative">
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-800/50 to-transparent rounded">
                      {/* Simplified chart visualization */}
                      <svg width="100%" height="100%" className="opacity-60">
                        <polyline
                          points={trade.candles.slice(0, 20).map((candle, i) =>
                            `${(i / 20) * 100},${70 - ((candle.close - Math.min(...trade.candles.slice(0, 20).map(c => c.close))) / (Math.max(...trade.candles.slice(0, 20).map(c => c.close)) - Math.min(...trade.candles.slice(0, 20).map(c => c.close)))) * 40}`
                          ).join(' ')}
                          fill="none"
                          stroke={tradeIsLong ? '#34d399' : '#f87171'}
                          strokeWidth="1.5"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Hover Overlay */}
                <div className={`absolute inset-0 bg-gradient-to-t from-blue-600/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none ${
                  isFeatured ? 'opacity-100' : ''
                }`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

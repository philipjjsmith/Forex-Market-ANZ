import { useState, useEffect, useRef } from "react";
import { Trophy, Loader2, TrendingUp, TrendingDown, Target, Clock, ChevronLeft, ChevronRight, Play, Pause, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import WinningTradeChart from "./WinningTradeChart";
import { useQuery } from "@tanstack/react-query";
import { getToken, getApiBaseUrl } from "@/lib/auth";
import { cn } from "@/lib/utils";

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

// Custom useInterval hook (Dan Abramov pattern)
function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// Helper function to safely format numeric values
function safeToFixed(value: any, decimals: number): string {
  if (value === null || value === undefined) return 'N/A';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return !isNaN(num) ? num.toFixed(decimals) : 'N/A';
}

export default function WinningTradesHero() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const { data: trades, isLoading, error } = useQuery({
    queryKey: ['winning-trades-week'],
    queryFn: () => fetchWinningTrades(5),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 15 * 60 * 1000, // Refetch every 15 minutes
  });

  // Auto-advance carousel (15-second interval)
  useInterval(() => {
    if (isAutoPlaying && trades && trades.length > 1) {
      handleNext();
    }
  }, isAutoPlaying ? 15000 : null);

  // Reset index when trades change
  useEffect(() => {
    setCurrentIndex(0);
    setIsAutoPlaying(true);
  }, [trades]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!trades || trades.length === 0) return;

      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, trades]);

  const handlePrev = () => {
    if (isTransitioning || !trades) return;
    setIsAutoPlaying(false); // Stop auto-play on manual interaction
    setIsTransitioning(true);
    setCurrentIndex((prev) => (prev === 0 ? trades.length - 1 : prev - 1));
    setTimeout(() => setIsTransitioning(false), 700);
  };

  const handleNext = () => {
    if (isTransitioning || !trades) return;
    setIsTransitioning(true);
    setCurrentIndex((prev) => (prev + 1) % trades.length);
    setTimeout(() => setIsTransitioning(false), 700);
  };

  const toggleAutoPlay = () => {
    setIsAutoPlaying(!isAutoPlaying);
  };

  // Loading state
  if (isLoading) {
    return (
      <Card className="w-full bg-card border-card-border">
        <CardContent className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Loading winning trades...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="w-full border-destructive bg-destructive/10">
        <CardContent className="py-8 text-center">
          <p className="text-destructive">Failed to load winning trades. Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  // Empty state - no winning trades this week
  if (!trades || trades.length === 0) {
    return (
      <Card className="w-full bg-card border-card-border">
        <CardContent className="py-16 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
              <Trophy className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-foreground mb-2">No Winning Trades Yet This Week</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Check back soon! Our signal generator runs every 15 minutes to identify high-probability trading opportunities.
                When signals hit their profit targets, they'll appear here.
              </p>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-chart-2" />
                <span>3-7 signals/week expected</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" />
                <span>65-75% win rate target</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const featuredTrade = trades[currentIndex];
  const isLong = featuredTrade.type === 'LONG';
  const targetHit = featuredTrade.outcome === 'TP1_HIT' ? 1 : featuredTrade.outcome === 'TP2_HIT' ? 2 : 3;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-chart-2/20 to-chart-2/30 border border-chart-2/30">
            <Trophy className="h-6 w-6 text-chart-2" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Winning Trades This Week</h2>
            <p className="text-sm text-muted-foreground">
              {trades.length} {trades.length === 1 ? 'win' : 'wins'} • Live trading results
            </p>
          </div>
        </div>
      </div>

      {/* Featured Trade Hero Section with pause on hover */}
      <div
        className="relative"
        onMouseEnter={() => setIsAutoPlaying(false)}
        onMouseLeave={() => setIsAutoPlaying(true)}
      >
        {/* Featured Trade Container with fade+zoom animation */}
        <div
          key={featuredTrade.signal_id}
          className={`relative min-h-[60vh] lg:min-h-[70vh] bg-card rounded-2xl overflow-hidden border border-card-border shadow-2xl transition-all duration-700 ${
            isTransitioning ? 'animate-fadeZoom' : ''
          }`}
        >
          {/* Glassmorphic Overlays - Top Left: Symbol & Profit */}
          <div className="absolute top-6 left-6 z-10 backdrop-blur-md bg-card/80 rounded-xl border border-card-border p-4 shadow-xl">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${isLong ? 'bg-chart-2/20 border border-chart-2/30' : 'bg-destructive/20 border border-destructive/30'}`}>
                {isLong ? (
                  <TrendingUp className="h-5 w-5 text-chart-2" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-destructive" />
                )}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground">{featuredTrade.symbol}</h3>
                <Badge variant={isLong ? "default" : "destructive"} className="mt-1">
                  {featuredTrade.type}
                </Badge>
              </div>
            </div>
            <div className="text-3xl font-bold text-chart-2">
              +{featuredTrade.profit_loss_pips.toFixed(1)} pips
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {featuredTrade.achievedRR.toFixed(2)}:1 Risk:Reward
            </div>
          </div>

          {/* Glassmorphic Overlays - Top Right: Confidence Badge */}
          <div className="absolute top-6 right-6 z-10 backdrop-blur-md bg-card/80 rounded-xl border border-card-border p-4 shadow-xl">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary mb-1">
                {featuredTrade.confidence}%
              </div>
              <div className="text-xs text-muted-foreground mb-2">Confidence</div>
              <Badge className={`${featuredTrade.tier === 'HIGH' ? 'bg-chart-2/20 text-chart-2 border border-chart-2/30' : 'bg-muted text-muted-foreground border border-border'}`}>
                {featuredTrade.tier === 'HIGH' ? 'LIVE TRADING' : 'PRACTICE'}
              </Badge>
            </div>
          </div>

          {/* Glassmorphic Overlays - Bottom Right: Trade Details */}
          <div className="absolute bottom-6 right-6 z-10 backdrop-blur-md bg-card/80 rounded-xl border border-card-border p-4 shadow-xl">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Clock className="h-3 w-3" />
                  <span>Duration</span>
                </div>
                <div className="font-semibold text-sm text-foreground">{featuredTrade.duration}</div>
              </div>
              <div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Target className="h-3 w-3" />
                  <span>Target Hit</span>
                </div>
                <div className="font-semibold text-sm text-chart-2">TP{targetHit}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Entry</div>
                <div className="font-semibold text-sm text-foreground font-mono">
                  {featuredTrade.entry_price.toFixed(5)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs mb-1">Exit</div>
                <div className="font-semibold text-sm text-chart-2 font-mono">
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
      </div>

      {/* Navigation Controls */}
      {trades.length > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={handlePrev}
            variant="outline"
            size="sm"
            className="bg-card hover:bg-primary/10 border-card-border"
            aria-label="Previous trade"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="text-sm text-muted-foreground font-medium">
            Trade {currentIndex + 1} of {trades.length}
          </span>

          <Button
            onClick={handleNext}
            variant="outline"
            size="sm"
            className="bg-card hover:bg-primary/10 border-card-border"
            aria-label="Next trade"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            onClick={toggleAutoPlay}
            variant="outline"
            size="sm"
            className="bg-card hover:bg-primary/10 border-card-border"
            aria-label={isAutoPlaying ? "Pause auto-advance" : "Play auto-advance"}
          >
            {isAutoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {/* Collapsible Trade Analysis (Collapsed by Default) */}
      <Collapsible open={isAccordionOpen} onOpenChange={setIsAccordionOpen}>
        <Card className="bg-card border-card-border">
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between p-4 hover:bg-primary/5 transition-colors">
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={cn(
                    "h-5 w-5 text-muted-foreground transition-transform duration-200",
                    isAccordionOpen && "rotate-180"
                  )}
                />
                <span className="font-semibold text-foreground">View Trade Analysis & Technical Details</span>
              </div>
              <Badge variant="outline" className="border-primary/30 text-primary">
                {featuredTrade.strategy_name} {featuredTrade.strategy_version}
              </Badge>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent className="animate-accordion-down">
            <CardContent className="pt-0 pb-6 space-y-6">
              {/* Technical Indicators */}
              <div>
                <h4 className="font-semibold text-foreground mb-3">Technical Indicators at Entry</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">RSI</div>
                    <div className="font-semibold text-foreground">{featuredTrade.indicators?.rsi || 'N/A'}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">ADX</div>
                    <div className="font-semibold text-foreground">{featuredTrade.indicators?.adx || 'N/A'}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">EMA 20</div>
                    <div className="font-semibold text-foreground font-mono">{safeToFixed(featuredTrade.indicators?.ema20, 5)}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">EMA 50</div>
                    <div className="font-semibold text-foreground font-mono">{safeToFixed(featuredTrade.indicators?.ema50, 5)}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">ATR</div>
                    <div className="font-semibold text-foreground font-mono">{safeToFixed(featuredTrade.indicators?.atr, 5)}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">MACD</div>
                    <div className="font-semibold text-foreground">{safeToFixed(featuredTrade.indicators?.macd?.histogram, 4)}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">BB Upper</div>
                    <div className="font-semibold text-foreground font-mono">{safeToFixed(featuredTrade.indicators?.bb?.upper, 5)}</div>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-1">BB Lower</div>
                    <div className="font-semibold text-foreground font-mono">{safeToFixed(featuredTrade.indicators?.bb?.lower, 5)}</div>
                  </div>
                </div>
              </div>

              {/* Trade Timeline */}
              <div>
                <h4 className="font-semibold text-foreground mb-3">Trade Timeline</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center p-2 bg-muted/20 rounded border border-border">
                    <span className="text-muted-foreground">Entry Time:</span>
                    <span className="font-mono text-foreground">{new Date(featuredTrade.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-muted/20 rounded border border-border">
                    <span className="text-muted-foreground">Exit Time:</span>
                    <span className="font-mono text-foreground">{new Date(featuredTrade.outcome_time).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-chart-2/10 rounded border border-chart-2/30">
                    <span className="text-muted-foreground">Total Duration:</span>
                    <span className="font-semibold text-chart-2">{featuredTrade.duration} ({featuredTrade.durationHours.toFixed(1)}h)</span>
                  </div>
                </div>
              </div>

              {/* Entry Reasoning */}
              <div>
                <h4 className="font-semibold text-foreground mb-3">Why This Trade Won</h4>
                <div className="bg-chart-2/10 border border-chart-2/30 rounded-lg p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-chart-2"></div>
                    </div>
                    <p className="text-sm text-foreground">
                      <strong>Multi-timeframe alignment:</strong> Weekly, Daily, and 4H trends all aligned {isLong ? 'bullish' : 'bearish'} (ICT 3-Timeframe Rule)
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-chart-2"></div>
                    </div>
                    <p className="text-sm text-foreground">
                      <strong>Entry timing:</strong> 1H timeframe showed optimal entry with RSI in favorable range ({featuredTrade.indicators.rsi})
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-chart-2"></div>
                    </div>
                    <p className="text-sm text-foreground">
                      <strong>Trend strength:</strong> ADX at {featuredTrade.indicators.adx} confirmed strong directional movement
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-chart-2"></div>
                    </div>
                    <p className="text-sm text-foreground">
                      <strong>Risk management:</strong> Achieved {featuredTrade.achievedRR.toFixed(2)}:1 reward-to-risk ratio with TP{targetHit} exit
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Keyboard Navigation Hint */}
      {trades.length > 1 && (
        <div className="text-center text-xs text-muted-foreground hidden md:block">
          Use ← → arrow keys to navigate • Hover to pause auto-advance
        </div>
      )}
    </div>
  );
}

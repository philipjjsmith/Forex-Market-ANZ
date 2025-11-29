import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, TrendingUp, Trophy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import WinningTradeCard from "./WinningTradeCard";
import { useQuery } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";

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
  const response = await fetch(`/api/signals/winning-trades-week?limit=${limit}`, {
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

export default function WinningTradesCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  const { data: trades, isLoading, error } = useQuery({
    queryKey: ['winning-trades-week'],
    queryFn: () => fetchWinningTrades(5),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 15 * 60 * 1000, // Refetch every 15 minutes
  });

  // Handle touch events for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe && currentIndex < (trades?.length || 0) - 1) {
      setCurrentIndex(currentIndex + 1);
    }

    if (isRightSwipe && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }

    setTouchStart(0);
    setTouchEnd(0);
  };

  const goToPrevious = () => {
    setCurrentIndex(Math.max(0, currentIndex - 1));
  };

  const goToNext = () => {
    setCurrentIndex(Math.min((trades?.length || 0) - 1, currentIndex + 1));
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  // Reset to first slide when trades change
  useEffect(() => {
    setCurrentIndex(0);
  }, [trades]);

  // Loading state
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
            <p className="text-muted-foreground">Loading winning trades...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="w-full border-red-200 bg-red-50">
        <CardContent className="py-8 text-center">
          <p className="text-red-600">Failed to load winning trades. Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  // Empty state - no winning trades this week
  if (!trades || trades.length === 0) {
    return (
      <Card className="w-full border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardContent className="py-12 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Trophy className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Winning Trades Yet This Week</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Check back soon! Our signal generator runs every 15 minutes to identify high-probability trading opportunities.
                When signals hit their profit targets, they'll appear here.
              </p>
            </div>
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <span>3-7 signals/week expected</span>
              </div>
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-600" />
                <span>65-75% win rate target</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalSlides = trades.length;
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < totalSlides - 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200">
            <Trophy className="h-6 w-6 text-emerald-700" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Winning Trades This Week</h2>
            <p className="text-sm text-muted-foreground">
              {totalSlides} {totalSlides === 1 ? 'win' : 'wins'} • Live trading results
            </p>
          </div>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goToPrevious}
            disabled={!canGoPrevious}
            className="h-10 w-10"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="text-sm text-muted-foreground px-3">
            {currentIndex + 1} / {totalSlides}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={goToNext}
            disabled={!canGoNext}
            className="h-10 w-10"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Carousel Container */}
      <div className="relative">
        {/* Mobile: Carousel with swipe */}
        <div
          ref={carouselRef}
          className="md:hidden overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${currentIndex * 100}%)` }}
          >
            {trades.map((trade) => (
              <div key={trade.signal_id} className="w-full flex-shrink-0 px-1">
                <WinningTradeCard trade={trade} />
              </div>
            ))}
          </div>
        </div>

        {/* Tablet/Desktop: Grid layout */}
        <div className="hidden md:block">
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {trades.slice(currentIndex, currentIndex + 3).map((trade) => (
              <WinningTradeCard key={trade.signal_id} trade={trade} />
            ))}
          </div>
        </div>

        {/* Mobile Navigation Arrows (overlay) */}
        <div className="md:hidden">
          {canGoPrevious && (
            <Button
              variant="outline"
              size="icon"
              onClick={goToPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg z-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {canGoNext && (
            <Button
              variant="outline"
              size="icon"
              onClick={goToNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-white/90 backdrop-blur-sm shadow-lg z-10"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      {/* Dot Indicators (mobile only) */}
      {totalSlides > 1 && (
        <div className="flex justify-center gap-2 md:hidden">
          {trades.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`h-2 rounded-full transition-all ${
                index === currentIndex
                  ? 'w-8 bg-blue-600'
                  : 'w-2 bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Pagination Dots (desktop) */}
      {totalSlides > 3 && (
        <div className="hidden md:flex justify-center gap-2">
          {Array.from({ length: Math.ceil(totalSlides / 3) }).map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index * 3)}
              className={`h-2 rounded-full transition-all ${
                Math.floor(currentIndex / 3) === index
                  ? 'w-8 bg-blue-600'
                  : 'w-2 bg-gray-300 hover:bg-gray-400'
              }`}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

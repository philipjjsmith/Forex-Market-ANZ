/**
 * Enhanced Winning Trades Hero - Phase 3 Integration
 * Integrates all 9 new components with 3-tier mode toggle and progressive disclosure
 */

import { useState, useEffect } from "react";
import { Trophy, Loader2, TrendingUp, ChevronLeft, ChevronRight, Settings, GraduationCap, Briefcase } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WinningTradeChart from "./WinningTradeChart";
import { useQuery } from "@tanstack/react-query";
import { getToken, getApiBaseUrl } from "@/lib/auth";

// Import new hooks
import { useWinningTradeDetails } from "@/hooks/useWinningTradeDetails";
import { useSessionPerformance } from "@/hooks/useSessionPerformance";
import { useStrategyStats } from "@/hooks/useStrategyStats";

// Import new components
import { PerformanceScoreCard } from "./trades/PerformanceScoreCard";
import { MarketContextBadge } from "./trades/MarketContextBadge";
import { ExecutionQualityIndicator } from "./trades/ExecutionQualityIndicator";
import { SessionHeatMap } from "./trades/SessionHeatMap";
import { ComparisonChart } from "./trades/ComparisonChart";
import { TradeNarrative } from "./trades/TradeNarrative";
import { EducationalSidebar } from "./trades/EducationalSidebar";
import { StatisticsPanel } from "./trades/StatisticsPanel";
import { MAEMFEChart } from "./trades/MAEMFEChart";
import { TradeSummaryCard } from "./trades/TradeSummaryCard";
import { IntermediateSidebar } from "./trades/IntermediateSidebar";
import { ProfessionalSidebar } from "./trades/ProfessionalSidebar";

// Import types
import type { ViewMode } from "@/types/enhanced-trade";

interface BasicWinningTrade {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  entry_price: number;
  stop_loss: number;
  outcome: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT';
  outcome_price: number;
  profit_loss_pips: number;
  strategy_name: string;
  created_at: string;
  duration: string;
}

async function fetchWinningTrades(limit: number = 5): Promise<BasicWinningTrade[]> {
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

export default function EnhancedWinningTradesHero() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('beginner');
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);

  // Fetch basic winning trades list
  const { data: trades, isLoading, error } = useQuery<BasicWinningTrade[]>({
    queryKey: ['winning-trades-week'],
    queryFn: () => fetchWinningTrades(5),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000, // Refresh every 15 min
  });

  // Auto-select first trade when trades load
  useEffect(() => {
    if (trades && trades.length > 0 && !selectedTradeId) {
      setSelectedTradeId(trades[0].signal_id);
    }
  }, [trades, selectedTradeId]);

  // Fetch enhanced details for selected trade
  const { data: enhancedTrade, isLoading: isLoadingDetails } = useWinningTradeDetails({
    signalId: selectedTradeId || '',
    enabled: !!selectedTradeId
  });

  // Fetch session performance
  const { data: sessionPerformance } = useSessionPerformance();

  // Fetch strategy stats
  const { data: strategyStats } = useStrategyStats({
    strategyName: enhancedTrade?.strategy_name || '',
    enabled: !!enhancedTrade?.strategy_name
  });

  // Auto-rotate carousel
  useEffect(() => {
    if (!isAutoPlaying || !trades || trades.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % trades.length);
    }, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, [isAutoPlaying, trades]);

  // Update selected trade when carousel changes
  useEffect(() => {
    if (trades && trades[currentIndex]) {
      setSelectedTradeId(trades[currentIndex].signal_id);
    }
  }, [currentIndex, trades]);

  const goToPrevious = () => {
    if (!trades) return;
    setCurrentIndex((prev) => (prev - 1 + trades.length) % trades.length);
    setIsAutoPlaying(false);
  };

  const goToNext = () => {
    if (!trades) return;
    setCurrentIndex((prev) => (prev + 1) % trades.length);
    setIsAutoPlaying(false);
  };

  // Loading state
  if (isLoading) {
    return (
      <Card className="w-full bg-slate-900 border-slate-700">
        <CardContent className="flex items-center justify-center py-24">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
            <p className="text-slate-300">Loading winning trades...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="w-full border-red-500 bg-red-950/50">
        <CardContent className="py-8 text-center">
          <p className="text-red-400">Failed to load winning trades. Please try again later.</p>
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (!trades || trades.length === 0) {
    return (
      <Card className="w-full bg-slate-900 border-slate-700">
        <CardContent className="py-16 text-center">
          <div className="space-y-4">
            <div className="mx-auto w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <Trophy className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white mb-2">No Winning Trades Yet This Week</h3>
              <p className="text-slate-300 max-w-md mx-auto">
                Check back soon! Our signal generator runs every 15 minutes to identify high-probability trading opportunities.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentTrade = trades[currentIndex];

  return (
    <div className="space-y-6">
      {/* Header with Mode Toggle */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/30 border border-emerald-500/30">
            <Trophy className="h-6 w-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Winning Trades This Week</h2>
            <p className="text-sm text-slate-300">
              {trades.length} {trades.length === 1 ? 'win' : 'wins'} • Enhanced analysis
            </p>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-2 bg-slate-800/50 backdrop-blur-sm rounded-lg p-1 border border-slate-600">
          <Button
            variant={viewMode === 'beginner' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('beginner')}
            className="gap-2"
          >
            <GraduationCap className="w-4 h-4" />
            Beginner
          </Button>
          <Button
            variant={viewMode === 'intermediate' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('intermediate')}
            className="gap-2"
          >
            <Settings className="w-4 h-4" />
            Intermediate
          </Button>
          <Button
            variant={viewMode === 'professional' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('professional')}
            className="gap-2"
          >
            <Briefcase className="w-4 h-4" />
            Professional
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div
        className="relative"
        onMouseEnter={() => setIsAutoPlaying(false)}
        onMouseLeave={() => setIsAutoPlaying(true)}
      >
        {/* Featured Trade Card */}
        <Card className="relative overflow-hidden bg-slate-900 border-slate-700 shadow-2xl">
          <CardContent className="p-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
              {/* Left Column: Chart & Basic Info */}
              <div className="lg:col-span-2 space-y-4">
                {/* Performance Score Card - Always visible */}
                {enhancedTrade && (
                  <PerformanceScoreCard
                    grade={enhancedTrade.executionGrade}
                    score={enhancedTrade.executionScore}
                    tier={enhancedTrade.tier}
                    confidence={enhancedTrade.confidence}
                  />
                )}

                {/* Chart */}
                <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
                  <WinningTradeChart
                    candles={enhancedTrade?.candles || currentTrade.candles || []}
                    entryPrice={currentTrade.entry_price}
                    entryTime={new Date(currentTrade.created_at).getTime() / 1000}
                    exitPrice={currentTrade.outcome_price}
                    exitTime={new Date(currentTrade.outcome_time || Date.now()).getTime() / 1000}
                    stopLoss={currentTrade.stop_loss}
                    tp1={enhancedTrade?.tp1 || currentTrade.tp1 || 0}
                    tp2={enhancedTrade?.tp2 || currentTrade.tp2 || 0}
                    tp3={enhancedTrade?.tp3 || currentTrade.tp3 || 0}
                    type={currentTrade.type.toLowerCase() as 'long' | 'short'}
                    targetHit={
                      currentTrade.outcome === 'TP1_HIT' ? 1 :
                      currentTrade.outcome === 'TP2_HIT' ? 2 : 3
                    }
                    height={400}
                  />
                </div>

                {/* Market Context Badges - Intermediate & Professional */}
                {(viewMode === 'intermediate' || viewMode === 'professional') && enhancedTrade && (
                  <MarketContextBadge
                    newsEvents={enhancedTrade.newsEvents || []}
                    session={enhancedTrade.session}
                    volatilityLevel={enhancedTrade.volatility_level}
                  />
                )}

                {/* Execution Quality - Intermediate & Professional */}
                {(viewMode === 'intermediate' || viewMode === 'professional') && enhancedTrade && (
                  <ExecutionQualityIndicator
                    entrySlippage={enhancedTrade.entry_slippage || 0}
                    exitSlippage={enhancedTrade.exit_slippage || 0}
                    fillLatency={enhancedTrade.fill_latency || 0}
                    mae={enhancedTrade.mae}
                    mfe={enhancedTrade.mfe}
                  />
                )}
              </div>

              {/* Right Column: Beginner Mode */}
              {viewMode === 'beginner' && (
                <div className="lg:col-span-1 space-y-4">
                  {/* Trade Summary - Always visible */}
                  <TradeSummaryCard
                    entry={currentTrade.entry_price}
                    stopLoss={currentTrade.stop_loss}
                    tp1={enhancedTrade?.tp1 || currentTrade.tp1 || 0}
                    tp2={enhancedTrade?.tp2 || currentTrade.tp2 || 0}
                    tp3={enhancedTrade?.tp3 || currentTrade.tp3 || 0}
                    targetHit={
                      currentTrade.outcome === 'TP1_HIT' ? 1 :
                      currentTrade.outcome === 'TP2_HIT' ? 2 : 3
                    }
                    profitPips={currentTrade.profit_loss_pips}
                    session={enhancedTrade?.sessionName || 'N/A'}
                    confidence={currentTrade.confidence}
                    symbol={currentTrade.symbol}
                  />
                  <EducationalSidebar mode={viewMode} />
                </div>
              )}

              {/* Right Column: Intermediate Mode */}
              {viewMode === 'intermediate' && (
                <div className="lg:col-span-1 space-y-4">
                  {/* Trade Summary - Always visible */}
                  <TradeSummaryCard
                    entry={currentTrade.entry_price}
                    stopLoss={currentTrade.stop_loss}
                    tp1={enhancedTrade?.tp1 || currentTrade.tp1 || 0}
                    tp2={enhancedTrade?.tp2 || currentTrade.tp2 || 0}
                    tp3={enhancedTrade?.tp3 || currentTrade.tp3 || 0}
                    targetHit={
                      currentTrade.outcome === 'TP1_HIT' ? 1 :
                      currentTrade.outcome === 'TP2_HIT' ? 2 : 3
                    }
                    profitPips={currentTrade.profit_loss_pips}
                    session={enhancedTrade?.sessionName || 'N/A'}
                    confidence={currentTrade.confidence}
                    symbol={currentTrade.symbol}
                  />
                  <IntermediateSidebar />
                </div>
              )}

              {/* Right Column: Professional Mode */}
              {viewMode === 'professional' && (
                <div className="lg:col-span-1 space-y-4">
                  {/* Trade Summary - Always visible */}
                  <TradeSummaryCard
                    entry={currentTrade.entry_price}
                    stopLoss={currentTrade.stop_loss}
                    tp1={enhancedTrade?.tp1 || currentTrade.tp1 || 0}
                    tp2={enhancedTrade?.tp2 || currentTrade.tp2 || 0}
                    tp3={enhancedTrade?.tp3 || currentTrade.tp3 || 0}
                    targetHit={
                      currentTrade.outcome === 'TP1_HIT' ? 1 :
                      currentTrade.outcome === 'TP2_HIT' ? 2 : 3
                    }
                    profitPips={currentTrade.profit_loss_pips}
                    session={enhancedTrade?.sessionName || 'N/A'}
                    confidence={currentTrade.confidence}
                    symbol={currentTrade.symbol}
                  />
                  {enhancedTrade && strategyStats && (
                    <ComparisonChart
                      data={{
                        currentTrade: {
                          profit: enhancedTrade.profit_loss_pips,
                          duration: enhancedTrade.durationHours,
                          rr: enhancedTrade.achievedRR
                        },
                        strategyAverage: {
                          avgProfit: strategyStats.avgProfit,
                          avgDuration: strategyStats.avgDuration,
                          winRate: strategyStats.winRate
                        },
                        percentile: enhancedTrade.strategyComparison?.percentile || 50,
                        rank: enhancedTrade.strategyComparison?.rank || 'Average'
                      }}
                      symbol={enhancedTrade.symbol}
                    />
                  )}
                  <ProfessionalSidebar />
                </div>
              )}
            </div>

            {/* Detailed Statistics Panel - Professional Mode */}
            {viewMode === 'professional' && enhancedTrade && strategyStats && (
              <div className="border-t border-slate-700 p-6">
                <StatisticsPanel
                  technicalIndicators={enhancedTrade.indicators}
                  executionMetrics={{
                    entrySlippage: enhancedTrade.entry_slippage || 0,
                    exitSlippage: enhancedTrade.exit_slippage || 0,
                    fillLatency: enhancedTrade.fill_latency || 0,
                    mae: enhancedTrade.mae,
                    mfe: enhancedTrade.mfe
                  }}
                  advancedStats={{
                    sharpeRatio: strategyStats.sharpeRatio,
                    sortinoRatio: strategyStats.sortinoRatio,
                    profitFactor: strategyStats.profitFactor,
                    expectancy: strategyStats.expectancy,
                    interpretation: strategyStats.interpretation
                  }}
                />
              </div>
            )}

            {/* Trade Narrative - All Modes */}
            {enhancedTrade && (
              <div className="border-t border-slate-700 p-6">
                <TradeNarrative
                  symbol={enhancedTrade.symbol}
                  type={enhancedTrade.type}
                  entry={enhancedTrade.entry_price}
                  outcome={enhancedTrade.outcome}
                  outcomePrice={enhancedTrade.outcome_price}
                  profitPips={enhancedTrade.profit_loss_pips}
                  duration={enhancedTrade.duration}
                  session={enhancedTrade.session}
                  newsEvents={enhancedTrade.newsEvents || []}
                  confidence={enhancedTrade.confidence}
                />
              </div>
            )}

            {/* MAE/MFE Chart - Professional Mode */}
            {viewMode === 'professional' && enhancedTrade && enhancedTrade.candles && (
              <div className="border-t border-slate-700 p-6">
                <MAEMFEChart
                  candles={enhancedTrade.candles}
                  entryPrice={enhancedTrade.entry_price}
                  type={enhancedTrade.type}
                  mae={enhancedTrade.mae}
                  mfe={enhancedTrade.mfe}
                  symbol={enhancedTrade.symbol}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Carousel Navigation */}
        {trades.length > 1 && (
          <>
            <Button
              variant="outline"
              size="icon"
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 bg-slate-900/80 backdrop-blur-sm hover:bg-slate-900 border-slate-700 shadow-lg"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 bg-slate-900/80 backdrop-blur-sm hover:bg-slate-900 border-slate-700 shadow-lg"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>

            {/* Carousel Indicators */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {trades.map((_, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setCurrentIndex(index);
                    setIsAutoPlaying(false);
                  }}
                  className={`h-2 rounded-full transition-all ${
                    index === currentIndex
                      ? 'w-8 bg-primary'
                      : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Session Heat Map - Professional Mode */}
      {viewMode === 'professional' && sessionPerformance && (
        <Card className="border-slate-700">
          <CardContent className="p-6">
            <SessionHeatMap
              sessions={sessionPerformance.sessions}
              currentSession={enhancedTrade?.session}
            />
          </CardContent>
        </Card>
      )}

      {/* Loading Overlay for Details */}
      {isLoadingDetails && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 rounded-lg p-6 shadow-xl">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-slate-300">Loading trade analysis...</p>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { LearningEngine, StrategyMetric, PerformanceMultiplier } from '@/lib/learning-engine';
import { AutoTraderAPI } from '@/lib/auto-trader-api';

interface UseLearningEngineReturn {
  // State
  isInitialized: boolean;
  overallStats: {
    totalMetrics: number;
    activeMultipliers: number;
    avgWinRate: number;
    avgProfitFactor: number;
    totalTrades: number;
  };

  // Actions
  adjustConfidence: (symbol: string, baseConfidence: number) => number;
  getSymbolPerformance: (symbol: string) => StrategyMetric[];
  getMultipliers: () => PerformanceMultiplier[];
  getTopPerformers: (limit?: number) => StrategyMetric[];
  getWorstPerformers: (limit?: number) => StrategyMetric[];
  refresh: () => Promise<void>;
}

export function useLearningEngine(): UseLearningEngineReturn {
  const engineRef = useRef<LearningEngine>(new LearningEngine());
  const [isInitialized, setIsInitialized] = useState(false);
  const [overallStats, setOverallStats] = useState({
    totalMetrics: 0,
    activeMultipliers: 0,
    avgWinRate: 0,
    avgProfitFactor: 0,
    totalTrades: 0,
  });

  // Load metrics from database on mount
  const loadMetrics = useCallback(async () => {
    try {
      console.log('🧠 Loading learning metrics from database...');
      const metrics = await AutoTraderAPI.getMetrics();

      // Convert database format to StrategyMetric format
      const strategyMetrics: StrategyMetric[] = metrics.map((m: any) => ({
        symbol: m.symbol,
        confidenceRange: m.confidence_range || m.confidenceRange,
        totalTrades: m.total_trades || m.totalTrades || 0,
        winningTrades: m.winning_trades || m.winningTrades || 0,
        losingTrades: m.losing_trades || m.losingTrades || 0,
        avgProfit: parseFloat(m.avg_profit || m.avgProfit || '0'),
        avgLoss: parseFloat(m.avg_loss || m.avgLoss || '0'),
        winRate: parseFloat(m.win_rate || m.winRate || '0'),
        profitFactor: parseFloat(m.profit_factor || m.profitFactor || '0'),
        lastUpdated: new Date(m.last_updated || m.lastUpdated || Date.now()),
      }));

      engineRef.current.loadMetrics(strategyMetrics);
      setOverallStats(engineRef.current.getOverallStats());
      setIsInitialized(true);

      console.log(`✅ Learning engine initialized with ${strategyMetrics.length} metrics`);
    } catch (error) {
      // Silently fail if not authenticated yet - this is normal on initial page load
      console.log('ℹ️ Learning metrics not loaded (may not be authenticated yet). Engine will work without historical data.');
      // Initialize with empty metrics - still functional, just no learning data yet
      setIsInitialized(true);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Adjust confidence score based on historical performance
  const adjustConfidence = useCallback((symbol: string, baseConfidence: number): number => {
    if (!isInitialized) return baseConfidence;

    const adjusted = engineRef.current.adjustConfidence(symbol, baseConfidence);

    // Log adjustments for visibility
    if (Math.abs(adjusted - baseConfidence) > 1) {
      const diff = adjusted - baseConfidence;
      const sign = diff > 0 ? '+' : '';
      console.log(`🎯 Confidence adjusted for ${symbol}: ${baseConfidence.toFixed(1)}% → ${adjusted.toFixed(1)}% (${sign}${diff.toFixed(1)}%)`);
    }

    return adjusted;
  }, [isInitialized]);

  // Get performance for a specific symbol
  const getSymbolPerformance = useCallback((symbol: string): StrategyMetric[] => {
    return engineRef.current.getSymbolPerformance(symbol);
  }, []);

  // Get all active multipliers
  const getMultipliers = useCallback((): PerformanceMultiplier[] => {
    return engineRef.current.getMultipliers();
  }, []);

  // Get top performers
  const getTopPerformers = useCallback((limit = 5): StrategyMetric[] => {
    return engineRef.current.getTopPerformers(limit);
  }, []);

  // Get worst performers
  const getWorstPerformers = useCallback((limit = 5): StrategyMetric[] => {
    return engineRef.current.getWorstPerformers(limit);
  }, []);

  // Refresh metrics from database
  const refresh = useCallback(async () => {
    await loadMetrics();
  }, [loadMetrics]);

  return {
    isInitialized,
    overallStats,
    adjustConfidence,
    getSymbolPerformance,
    getMultipliers,
    getTopPerformers,
    getWorstPerformers,
    refresh,
  };
}

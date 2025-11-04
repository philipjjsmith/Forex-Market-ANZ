import { useState, useEffect, useRef, useCallback } from 'react';
import { AutoTrader, AutoTradePosition, AutoTraderStats, AutoTraderConfig } from '@/lib/auto-trader';
import { Signal } from '@/lib/strategy';
import { AutoTraderAPI } from '@/lib/auto-trader-api';

interface UseAutoTraderReturn {
  // State
  positions: {
    open: AutoTradePosition[];
    closed: AutoTradePosition[];
  };
  stats: AutoTraderStats;
  config: AutoTraderConfig;

  // Actions
  start: () => void;
  stop: () => void;
  updateConfig: (config: Partial<AutoTraderConfig>) => void;
  processSignals: (signals: Signal[]) => void;
  updatePrices: (marketData: Record<string, { currentPrice: number }>) => void;
  manualClosePosition: (positionId: string, currentPrice: number) => void;
  reset: () => void;
}

export function useAutoTrader(initialConfig?: Partial<AutoTraderConfig>): UseAutoTraderReturn {
  const autoTraderRef = useRef<AutoTrader | null>(null);

  const [positions, setPositions] = useState<{
    open: AutoTradePosition[];
    closed: AutoTradePosition[];
  }>({
    open: [],
    closed: [],
  });

  const [stats, setStats] = useState<AutoTraderStats>({
    totalTrades: 0,
    openPositions: 0,
    closedPositions: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    netPL: 0,
    winRate: 0,
    avgProfit: 0,
    avgLoss: 0,
    isRunning: false,
    virtualBalance: initialConfig?.startingBalance || 10000,
  });

  const [config, setConfig] = useState<AutoTraderConfig>({
    enabled: false,
    minConfidence: 70,
    maxPositions: 3,
    positionSize: 1000,
    maxDailyTrades: 10,
    timeLimit: 240,
    startingBalance: 10000,
    ...initialConfig,
  });

  // Initialize AutoTrader instance
  useEffect(() => {
    autoTraderRef.current = new AutoTrader(initialConfig);

    // Set up database callbacks
    autoTraderRef.current.setDatabaseCallbacks({
      onPositionOpen: async (position) => {
        await AutoTraderAPI.saveTrade(position);
      },
      onPositionClose: async (position) => {
        await AutoTraderAPI.updateTrade(position);
        // Update metrics for learning
        if (position.profitLoss !== undefined) {
          await AutoTraderAPI.updateMetrics(
            position.symbol,
            position.confidence,
            position.profitLoss > 0,
            position.profitLoss
          );
        }
      },
      onSessionUpdate: async (sessionId, stats) => {
        await AutoTraderAPI.updateSession(sessionId, stats);
      },
    });

    // Subscribe to updates
    const unsubscribe = autoTraderRef.current.subscribe((openPositions, updatedStats) => {
      const allPositions = autoTraderRef.current!.getPositions();
      setPositions(allPositions);
      setStats(updatedStats);
    });

    // Load saved config from localStorage
    const savedConfig = localStorage.getItem('autoTraderConfig');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        autoTraderRef.current.updateConfig(parsed);
        setConfig({ ...config, ...parsed });
      } catch (e) {
        console.error('Failed to load saved auto-trader config:', e);
      }
    }

    return () => {
      unsubscribe();
    };
  }, []);

  // Save config to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('autoTraderConfig', JSON.stringify(config));
  }, [config]);

  const start = useCallback(async () => {
    autoTraderRef.current?.start();
    setConfig(prev => ({ ...prev, enabled: true }));

    // Create a new trading session
    try {
      const sessionId = await AutoTraderAPI.createSession(
        stats.virtualBalance,
        config
      );
      autoTraderRef.current?.setSessionId(sessionId);
      console.log('📊 Trading session created:', sessionId);
    } catch (error) {
      console.error('❌ Failed to create trading session:', error);
    }
  }, [stats.virtualBalance, config]);

  const stop = useCallback(() => {
    autoTraderRef.current?.stop();
    setConfig(prev => ({ ...prev, enabled: false }));
  }, []);

  const updateConfig = useCallback((newConfig: Partial<AutoTraderConfig>) => {
    autoTraderRef.current?.updateConfig(newConfig);
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  const processSignals = useCallback((signals: Signal[]) => {
    autoTraderRef.current?.processSignals(signals);
  }, []);

  const updatePrices = useCallback((marketData: Record<string, { currentPrice: number }>) => {
    autoTraderRef.current?.updatePrices(marketData);
  }, []);

  const manualClosePosition = useCallback((positionId: string, currentPrice: number) => {
    autoTraderRef.current?.manualClosePosition(positionId, currentPrice);
  }, []);

  const reset = useCallback(() => {
    autoTraderRef.current?.reset();
    setPositions({ open: [], closed: [] });
    setStats({
      totalTrades: 0,
      openPositions: 0,
      closedPositions: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      netPL: 0,
      winRate: 0,
      avgProfit: 0,
      avgLoss: 0,
      isRunning: false,
      virtualBalance: config.startingBalance,
    });
  }, [config.startingBalance]);

  return {
    positions,
    stats,
    config,
    start,
    stop,
    updateConfig,
    processSignals,
    updatePrices,
    manualClosePosition,
    reset,
  };
}

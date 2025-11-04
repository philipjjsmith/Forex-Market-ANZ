import { useState, useEffect, useRef, useCallback } from 'react';
import { PriceSimulator, SimulatedPrice, PriceSimulatorConfig } from '@/lib/price-simulator';

interface UsePriceSimulatorReturn {
  prices: Map<string, SimulatedPrice>;
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  setVolatility: (volatility: number) => void;
  setTrendBias: (bias: number) => void;
  initializePrices: (initialPrices: Record<string, number>) => void;
}

export function usePriceSimulator(config?: Partial<PriceSimulatorConfig>): UsePriceSimulatorReturn {
  const simulatorRef = useRef<PriceSimulator | null>(null);
  const [prices, setPrices] = useState<Map<string, SimulatedPrice>>(new Map());
  const [isRunning, setIsRunning] = useState(false);

  // Initialize simulator
  useEffect(() => {
    simulatorRef.current = new PriceSimulator(config);

    // Subscribe to price updates
    const unsubscribe = simulatorRef.current.subscribe((updatedPrices) => {
      setPrices(updatedPrices);
    });

    return () => {
      unsubscribe();
      simulatorRef.current?.stop();
    };
  }, []);

  const start = useCallback(() => {
    console.log('📊 Price simulator starting...');
    simulatorRef.current?.start();
    setIsRunning(true);
    console.log('✅ Price simulator started');
  }, []);

  const stop = useCallback(() => {
    simulatorRef.current?.stop();
    setIsRunning(false);
  }, []);

  const setVolatility = useCallback((volatility: number) => {
    simulatorRef.current?.setVolatility(volatility);
  }, []);

  const setTrendBias = useCallback((bias: number) => {
    simulatorRef.current?.setTrendBias(bias);
  }, []);

  const initializePrices = useCallback((initialPrices: Record<string, number>) => {
    simulatorRef.current?.initializePrices(initialPrices);
    setPrices(simulatorRef.current?.getPrices() || new Map());
  }, []);

  return {
    prices,
    isRunning,
    start,
    stop,
    setVolatility,
    setTrendBias,
    initializePrices,
  };
}

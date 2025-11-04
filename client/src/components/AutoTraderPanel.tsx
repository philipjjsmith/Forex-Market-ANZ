import { useState, useEffect } from 'react';
import { useAutoTrader } from '@/hooks/use-auto-trader';
import { usePriceSimulator } from '@/hooks/use-price-simulator';
import { Signal } from '@/lib/strategy';
import { PositionCard } from './PositionCard';
import {
  Activity,
  Play,
  Pause,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Settings,
  BarChart3,
  Clock,
  AlertTriangle
} from 'lucide-react';

interface AutoTraderPanelProps {
  signals: Signal[];
  marketData: Record<string, { candles: any[], currentPrice: number }>;
  onSignalsProcessed?: () => void;
}

export function AutoTraderPanel({ signals, marketData, onSignalsProcessed }: AutoTraderPanelProps) {
  const {
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
  } = useAutoTrader();

  const {
    prices: simulatedPrices,
    isRunning: isSimulatorRunning,
    start: startSimulator,
    stop: stopSimulator,
    initializePrices,
  } = usePriceSimulator({
    volatility: 0.00015, // Realistic forex volatility
    updateInterval: 2000, // Update every 2 seconds
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showClosedPositions, setShowClosedPositions] = useState(false);

  // Initialize price simulator with market data
  useEffect(() => {
    const initialPrices = Object.entries(marketData).reduce((acc, [symbol, data]) => {
      acc[symbol] = data.currentPrice;
      return acc;
    }, {} as Record<string, number>);

    if (Object.keys(initialPrices).length > 0) {
      initializePrices(initialPrices);
    }
  }, [marketData, initializePrices]);

  // Update auto-trader prices from simulator
  useEffect(() => {
    if (simulatedPrices.size === 0) return;

    const priceData: Record<string, { currentPrice: number }> = {};
    simulatedPrices.forEach((priceInfo, symbol) => {
      priceData[symbol] = { currentPrice: priceInfo.currentPrice };
    });

    updatePrices(priceData);
  }, [simulatedPrices, updatePrices]);

  // Process signals when they change (if auto-trader is running)
  useEffect(() => {
    if (stats.isRunning && signals.length > 0) {
      processSignals(signals);
    }
  }, [signals, stats.isRunning, processSignals]);

  const handleStart = () => {
    console.log('🚀 Starting auto-trader and price simulator...');
    start();
    startSimulator();
    setTimeout(() => {
      console.log('✅ Simulator running check:', isSimulatorRunning);
    }, 100);
  };

  const handleStop = () => {
    stop();
    stopSimulator();
  };

  const handleReset = () => {
    if (window.confirm('Are you sure you want to reset all auto-trader data? This will clear all positions and statistics.')) {
      reset();
      stopSimulator();

      // Re-initialize prices from market data
      const initialPrices = Object.entries(marketData).reduce((acc, [symbol, data]) => {
        acc[symbol] = data.currentPrice;
        return acc;
      }, {} as Record<string, number>);

      if (Object.keys(initialPrices).length > 0) {
        initializePrices(initialPrices);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2 mb-2">
              <Activity className="w-6 h-6 text-blue-400" />
              AI Auto-Trader
            </h2>
            <p className="text-slate-400 text-sm">
              Automatically takes trades based on high-confidence signals
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
                showSettings
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>

            <button
              onClick={handleReset}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg flex items-center gap-2 transition-all"
              title="Reset all data"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>

            <button
              onClick={stats.isRunning ? handleStop : handleStart}
              className={`px-6 py-2 rounded-lg flex items-center gap-2 font-semibold transition-all ${
                stats.isRunning
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {stats.isRunning ? (
                <>
                  <Pause className="w-5 h-5" />
                  Stop Trading
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Trading
                </>
              )}
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-slate-900 rounded-lg p-4 space-y-4 mb-6">
            <h3 className="font-semibold text-lg mb-3">Configuration</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Min Confidence */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Minimum Confidence: {config.minConfidence}%
                </label>
                <input
                  type="range"
                  min="50"
                  max="90"
                  step="5"
                  value={config.minConfidence}
                  onChange={(e) => updateConfig({ minConfidence: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Max Positions */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Max Positions: {config.maxPositions}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={config.maxPositions}
                  onChange={(e) => updateConfig({ maxPositions: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Position Size */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Position Size: ${config.positionSize}
                </label>
                <input
                  type="range"
                  min="100"
                  max="5000"
                  step="100"
                  value={config.positionSize}
                  onChange={(e) => updateConfig({ positionSize: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Max Daily Trades */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Max Daily Trades: {config.maxDailyTrades}
                </label>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={config.maxDailyTrades}
                  onChange={(e) => updateConfig({ maxDailyTrades: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Time Limit */}
              <div>
                <label className="text-sm text-slate-400 mb-2 block">
                  Time Limit: {config.timeLimit} min
                </label>
                <input
                  type="range"
                  min="30"
                  max="480"
                  step="30"
                  value={config.timeLimit}
                  onChange={(e) => updateConfig({ timeLimit: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Status Indicator */}
        <div className={`p-3 rounded-lg flex items-center justify-between ${
          stats.isRunning
            ? 'bg-green-500/10 border border-green-500/30'
            : 'bg-slate-700 border border-slate-600'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              stats.isRunning ? 'bg-green-500 animate-pulse' : 'bg-slate-500'
            }`} />
            <span className="font-semibold">
              {stats.isRunning ? 'Auto-Trader is Active' : 'Auto-Trader is Paused'}
            </span>
          </div>
          {stats.isRunning && (
            <div className="text-sm text-slate-400">
              Scanning for signals with {config.minConfidence}%+ confidence
            </div>
          )}
        </div>
      </div>

      {/* Statistics Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {/* Virtual Balance */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Virtual Balance</span>
            <DollarSign className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">
            ${stats.virtualBalance.toLocaleString()}
          </div>
        </div>

        {/* Net P/L */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Net P/L</span>
            <BarChart3 className="w-4 h-4 text-purple-400" />
          </div>
          <div className={`text-2xl font-bold ${
            stats.netPL >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {stats.netPL >= 0 ? '+' : ''}{stats.netPL.toFixed(2)}
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Win Rate</span>
            <Target className="w-4 h-4 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-green-400">
            {stats.winRate.toFixed(1)}%
          </div>
        </div>

        {/* Total Trades */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Total Trades</span>
            <Activity className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold">
            {stats.totalTrades}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.winningTrades}W / {stats.losingTrades}L
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-400 text-sm">Open Positions</span>
            <Clock className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="text-2xl font-bold text-yellow-400">
            {stats.openPositions}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Max: {config.maxPositions}
          </div>
        </div>
      </div>

      {/* Open Positions */}
      {positions.open.length > 0 && (
        <div>
          <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Open Positions ({positions.open.length})
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {positions.open.map(position => (
              <PositionCard
                key={position.id}
                position={position}
                onClose={manualClosePosition}
              />
            ))}
          </div>
        </div>
      )}

      {/* Closed Positions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-slate-400" />
            Closed Positions ({positions.closed.length})
          </h3>
          {positions.closed.length > 5 && (
            <button
              onClick={() => setShowClosedPositions(!showClosedPositions)}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              {showClosedPositions ? 'Show Less' : 'Show All'}
            </button>
          )}
        </div>

        {positions.closed.length === 0 ? (
          <div className="bg-slate-800 rounded-lg p-8 text-center border border-slate-700">
            <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">
              No closed positions yet. Start the auto-trader to begin trading automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(showClosedPositions ? positions.closed : positions.closed.slice(0, 5))
              .map(position => (
                <PositionCard
                  key={position.id}
                  position={position}
                />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

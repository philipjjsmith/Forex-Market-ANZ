/**
 * Enhanced Trade Types
 * Phase 3: Integration - Type definitions for winning trades with all new metrics
 */

export interface NewsEvent {
  time: string;
  currency: string;
  event: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: 'jblanked' | 'myfxbook' | 'demo';
  affectsSymbol?: boolean;
  timeDiff?: string;
}

export interface ExecutionBreakdown {
  slippageScore: number;
  latencyScore: number;
  maeScore: number;
}

export interface StrategyComparison {
  avgProfit: number;
  winRate: number;
  avgDuration: number;
  percentile: number;
  rank: string;
}

export interface EnhancedTrade {
  // Basic trade info (existing)
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

  // Technical indicators (existing)
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

  // Candle data (existing)
  candles: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;

  // Strategy info (existing)
  strategy_name: string;
  strategy_version: string;
  created_at: string;
  duration: string;
  durationHours: number;
  achievedRR: number;

  // NEW: Execution quality metrics
  entry_slippage?: number;
  exit_slippage?: number;
  fill_latency?: number;

  // NEW: Trade analysis metrics
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
  maePercent: number;
  mfeRatio: number;
  break_even_time?: string;

  // NEW: Execution grading
  executionGrade: string; // A+, A, A-, B+, etc.
  executionScore: number; // 0-100
  executionBreakdown: ExecutionBreakdown;
  executionRecommendations: string[];

  // NEW: Market context
  newsEvents: NewsEvent[];
  session: 'ASIA' | 'LONDON' | 'NY' | 'LONDON_NY_OVERLAP' | 'OFF_HOURS';
  sessionName: string;
  volatility_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

  // NEW: Strategy comparison
  strategyComparison: StrategyComparison | null;
}

export interface SessionStats {
  session: 'ASIA' | 'LONDON' | 'NY' | 'LONDON_NY_OVERLAP';
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgProfit: number;
  totalPips: number;
  bestTrade: number;
  worstTrade: number;
  interpretation: string;
}

export interface SessionPerformance {
  sessions: SessionStats[];
  bestSession: 'ASIA' | 'LONDON' | 'NY' | 'LONDON_NY_OVERLAP';
  worstSession: 'ASIA' | 'LONDON' | 'NY' | 'LONDON_NY_OVERLAP';
  recommendation: string;
}

export interface StrategyStats {
  strategyName: string;
  strategyVersion: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  avgDuration: number;
  totalPips: number;
  bestTrade: number;
  worstTrade: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  sortinoRatio: number;
  interpretation: {
    sharpe: string;
    sortino: string;
    profitFactor: string;
  };
  streaks: {
    longestWinStreak: number;
    longestLossStreak: number;
    currentStreak: number;
  };
  declineAnalysis: {
    isDecline: boolean;
    recentWinRate: number;
    historicalWinRate: number;
    recommendation: string;
  };
}

export type ViewMode = 'beginner' | 'intermediate' | 'professional';

export interface WinningTradesDisplayProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

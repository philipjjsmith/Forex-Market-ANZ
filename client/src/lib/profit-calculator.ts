/**
 * Profit Calculator
 * Calculates USD profit based on account size, risk management, and signal outcomes
 */

interface SignalForProfit {
  confidence: number;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  outcome?: string;
  outcome_price?: number;
  profit_loss_pips?: number;
}

interface PerformanceData {
  confidence_bracket: string;
  win_rate: number;
  total_signals: number;
}

/**
 * Calculate optimal risk percentage based on confidence and historical performance
 */
export function calculateOptimalRisk(
  confidence: number,
  performanceData: PerformanceData[] = []
): number {
  // Find matching confidence bracket
  let bracket = '70-79';
  if (confidence >= 90) bracket = '90-100';
  else if (confidence >= 80) bracket = '80-89';

  // Look for historical performance for this bracket
  const performance = performanceData.find(p => p.confidence_bracket === bracket);

  // If we have enough data (10+ signals), adjust risk based on win rate
  // OPTION A: FXIFY-safe adaptive risk (never exceeds 1.5%)
  if (performance && performance.total_signals >= 10) {
    const winRate = performance.win_rate;

    if (winRate >= 70) {
      // High win rate - use maximum safe risk
      if (confidence >= 80) return 1.5; // 1.5% for HIGH tier even with great win rate
      return 0.0; // MEDIUM tier = paper trade
    } else if (winRate >= 60) {
      // Good win rate - use moderate risk
      if (confidence >= 80) return 1.5; // Stay at 1.5% for consistency
      return 0.0; // MEDIUM tier = paper trade
    } else if (winRate >= 50) {
      // Average win rate - use conservative risk
      if (confidence >= 80) return 1.5; // Maintain 1.5% for HIGH tier
      return 0.0; // MEDIUM tier = paper trade
    } else {
      // Poor win rate - reduce risk significantly
      if (confidence >= 80) return 1.0; // Reduce to 1.0% if underperforming
      return 0.0; // MEDIUM tier = paper trade
    }
  }

  // Default risk percentages (no historical data yet)
  // OPTION A: FXIFY-safe variable risk (matches signal-generator.ts)
  if (confidence >= 80) return 1.5; // 1.5% for HIGH tier (80+)
  return 0.0; // 0% for MEDIUM tier (70-79) - paper trade only
}

/**
 * Calculate position size in lots based on account size and risk
 */
export function calculatePositionSize(
  accountSize: number,
  riskPercent: number,
  stopLossDistance: number // in pips
): number {
  const riskAmount = accountSize * (riskPercent / 100);
  const pipValue = 10; // Standard: 1 standard lot = $10/pip for major pairs

  // Position size in lots = Risk Amount / (Stop Loss Distance × Pip Value)
  const positionSize = riskAmount / (stopLossDistance * pipValue);

  return positionSize;
}

/**
 * Calculate potential profit in USD for a pending signal
 */
export function calculatePotentialProfit(
  accountSize: number,
  signal: SignalForProfit,
  performanceData: PerformanceData[] = []
): {
  profitUSD: number;
  riskPercent: number;
  positionSize: number;
  riskUSD: number;
} {
  // Calculate distances in pips
  const pipValue = 0.0001;
  const stopLossDistance = Math.abs(signal.entry_price - signal.stop_loss) / pipValue;
  const tp1Distance = Math.abs(signal.tp1 - signal.entry_price) / pipValue;

  // Get optimal risk for this signal
  const riskPercent = calculateOptimalRisk(signal.confidence, performanceData);

  // Calculate position size
  const positionSize = calculatePositionSize(accountSize, riskPercent, stopLossDistance);

  // Calculate profit at TP1
  const profitUSD = positionSize * tp1Distance * 10; // $10/pip per standard lot
  const riskUSD = accountSize * (riskPercent / 100);

  return {
    profitUSD: Math.round(profitUSD * 100) / 100, // Round to 2 decimals
    riskPercent,
    positionSize: Math.round(positionSize * 100) / 100,
    riskUSD: Math.round(riskUSD * 100) / 100,
  };
}

/**
 * Calculate actual profit in USD for a completed signal
 */
export function calculateActualProfit(
  accountSize: number,
  signal: SignalForProfit,
  performanceData: PerformanceData[] = []
): {
  profitUSD: number;
  riskPercent: number;
  positionSize: number;
} {
  // If signal didn't complete or has no profit_loss_pips, return 0
  if (!signal.profit_loss_pips) {
    return { profitUSD: 0, riskPercent: 0, positionSize: 0 };
  }

  // Calculate distances in pips
  const pipValue = 0.0001;
  const stopLossDistance = Math.abs(signal.entry_price - signal.stop_loss) / pipValue;

  // Get optimal risk for this signal
  const riskPercent = calculateOptimalRisk(signal.confidence, performanceData);

  // Calculate position size
  const positionSize = calculatePositionSize(accountSize, riskPercent, stopLossDistance);

  // Calculate actual profit based on profit_loss_pips
  const profitUSD = positionSize * signal.profit_loss_pips * 10; // $10/pip per standard lot

  return {
    profitUSD: Math.round(profitUSD * 100) / 100, // Round to 2 decimals
    riskPercent,
    positionSize: Math.round(positionSize * 100) / 100,
  };
}

/**
 * Calculate total profit across all completed signals
 */
export function calculateTotalProfit(
  accountSize: number,
  completedSignals: SignalForProfit[],
  performanceData: PerformanceData[] = []
): {
  totalProfit: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
} {
  let totalProfit = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  completedSignals.forEach(signal => {
    const { profitUSD } = calculateActualProfit(accountSize, signal, performanceData);
    totalProfit += profitUSD;

    if (profitUSD > 0) winningTrades++;
    else if (profitUSD < 0) losingTrades++;
  });

  return {
    totalProfit: Math.round(totalProfit * 100) / 100,
    totalTrades: completedSignals.length,
    winningTrades,
    losingTrades,
  };
}

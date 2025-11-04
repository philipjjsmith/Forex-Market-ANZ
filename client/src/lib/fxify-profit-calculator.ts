/**
 * FXIFY Profit Calculator
 * Converts pip profits to real dollar amounts based on FXIFY account size
 */

export interface FxifyProfitCalculation {
  totalPips: number;
  totalDollars: number;
  monthlyDollars: number;
  yearlyDollars: number;
  accountSize: number;
  avgPipsPerTrade: number;
  avgDollarsPerTrade: number;
  projectedMonthlyTrades: number;
}

/**
 * Calculate real dollar profit from pips
 * @param totalPips Total profit in pips
 * @param totalTrades Number of trades
 * @param accountSize FXIFY account size (default $100,000)
 * @param avgTradesPerDay Average trades per day (default 3)
 * @returns Profit calculations in dollars
 */
export function calculateFxifyProfit(
  totalPips: number,
  totalTrades: number,
  accountSize: number = 100000,
  avgTradesPerDay: number = 3
): FxifyProfitCalculation {
  // Standard lot size for $100K account: 1.0 lot = $10/pip
  // Risk management: 1.5% per trade on $100K = $1,500
  // With proper position sizing: ~$10 per pip on average
  const dollarsPerPip = accountSize / 10000; // $10 per pip for $100K account

  const totalDollars = totalPips * dollarsPerPip;
  const avgPipsPerTrade = totalTrades > 0 ? totalPips / totalTrades : 0;
  const avgDollarsPerTrade = totalTrades > 0 ? totalDollars / totalTrades : 0;

  // Project monthly earnings
  const projectedMonthlyTrades = avgTradesPerDay * 21; // 21 trading days per month
  const monthlyDollars = avgDollarsPerTrade * projectedMonthlyTrades;
  const yearlyDollars = monthlyDollars * 12;

  return {
    totalPips,
    totalDollars,
    monthlyDollars,
    yearlyDollars,
    accountSize,
    avgPipsPerTrade,
    avgDollarsPerTrade,
    projectedMonthlyTrades,
  };
}

/**
 * Calculate profit after FXIFY profit split
 * @param grossProfit Gross profit before split
 * @param splitPercentage Your split percentage (default 80%)
 * @returns Net profit after split
 */
export function calculateNetProfit(
  grossProfit: number,
  splitPercentage: number = 80
): number {
  return grossProfit * (splitPercentage / 100);
}

/**
 * Format dollar amount with proper formatting
 */
export function formatDollars(amount: number): string {
  const sign = amount >= 0 ? '+' : '-';
  const abs = Math.abs(amount);

  if (abs >= 1000000) {
    return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  } else if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}K`;
  } else {
    return `${sign}$${abs.toFixed(0)}`;
  }
}

/**
 * Determine if performance meets FXIFY requirements
 */
export function meetsFxifyRequirements(
  winRate: number,
  profitFactor: number,
  maxDrawdownPips: number,
  accountSize: number = 100000
): {
  meetsRequirements: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // FXIFY requirements (2-Phase Challenge):
  // 1. Minimum 10% profit target (Phase 1) - not checked here as it's cumulative
  // 2. Max daily loss: 4% ($4,000 on $100K)
  // 3. Max total drawdown: 8% ($8,000 on $100K)
  // 4. Minimum 5 trading days

  // Check win rate (should be above breakeven with risk/reward)
  if (winRate < 40) {
    issues.push(`Win rate ${winRate.toFixed(1)}% is below recommended 40%`);
  }

  // Check profit factor (should be > 1.5 for consistent profitability)
  if (profitFactor < 1.5) {
    issues.push(`Profit factor ${profitFactor.toFixed(2)} is below recommended 1.5`);
  }

  // Check max drawdown (convert pips to dollars)
  const dollarsPerPip = accountSize / 10000;
  const maxDrawdownDollars = maxDrawdownPips * dollarsPerPip;
  const maxAllowedDrawdown = accountSize * 0.08; // 8% max drawdown

  if (maxDrawdownDollars > maxAllowedDrawdown) {
    issues.push(`Max drawdown $${maxDrawdownDollars.toFixed(0)} exceeds 8% limit ($${maxAllowedDrawdown.toFixed(0)})`);
  }

  return {
    meetsRequirements: issues.length === 0,
    issues,
  };
}

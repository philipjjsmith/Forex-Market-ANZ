import { motion } from 'framer-motion';
import { DollarSign, TrendingUp } from 'lucide-react';

interface ProfitCalculatorProps {
  profitPips: number;
  riskRewardRatio: number;
  stopLossPips: number;
}

export function ProfitCalculator({ profitPips, riskRewardRatio, stopLossPips }: ProfitCalculatorProps) {
  // Using 2% risk rule (standard professional practice)
  const riskPercent = 2;

  // Calculate profit percentage based on R/R ratio
  // If R/R is 1:1.5 and we risked 2%, we made 2% × 1.5 = 3%
  const profitPercent = riskPercent * riskRewardRatio;

  const accounts = [
    { size: 10000, label: '$10K' },
    { size: 50000, label: '$50K' },
    { size: 100000, label: '$100K' }
  ];

  const calculateProfit = (accountSize: number) => {
    return accountSize * (profitPercent / 100);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 backdrop-blur-sm border border-emerald-500/30 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 px-4 py-3 border-b border-emerald-500/30">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Profit on Your Account</h3>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Using 2% risk rule • {profitPips > 0 ? '+' : ''}{profitPips.toFixed(1)} pips • 1:{riskRewardRatio.toFixed(1)} R/R
        </p>
      </div>

      {/* Account Size Grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        {accounts.map((account, index) => {
          const profit = calculateProfit(account.size);
          return (
            <motion.div
              key={account.size}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="bg-slate-800/50 rounded-lg p-3 border border-slate-600 hover:border-emerald-500/50 transition-colors"
            >
              <div className="text-xs text-slate-400 mb-1">{account.label} Account</div>
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  ${profit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
              <div className="text-xs text-emerald-500 mt-1 font-semibold">
                +{profitPercent.toFixed(1)}%
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="bg-slate-800/30 px-4 py-2 border-t border-slate-600">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3 h-3 text-cyan-400" />
          <p className="text-xs text-slate-400">
            Based on risking <span className="text-cyan-400 font-semibold">{riskPercent}%</span> per trade with <span className="text-emerald-400 font-semibold">{stopLossPips.toFixed(1)} pip</span> stop loss
          </p>
        </div>
      </div>
    </motion.div>
  );
}

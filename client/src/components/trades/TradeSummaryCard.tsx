import { motion } from 'framer-motion';
import { Target, TrendingUp, TrendingDown, Activity, CheckCircle2 } from 'lucide-react';

interface TradeSummaryCardProps {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  targetHit: 1 | 2 | 3;
  profitPips: number;
  session?: string;
  confidence?: number;
  symbol: string;
}

export function TradeSummaryCard({
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  targetHit,
  profitPips,
  session,
  confidence,
  symbol
}: TradeSummaryCardProps) {
  // Calculate pips for each level
  const calculatePips = (price: number) => {
    const diff = (price - entry) * 10000; // Convert to pips
    return diff;
  };

  const slPips = calculatePips(stopLoss);
  const tp1Pips = calculatePips(tp1);
  const tp2Pips = calculatePips(tp2);
  const tp3Pips = calculatePips(tp3);

  // Calculate R:R ratios
  const riskPips = Math.abs(slPips);
  const rrActual = targetHit === 1 ? Math.abs(tp1Pips / slPips) :
                   targetHit === 2 ? Math.abs(tp2Pips / slPips) :
                   Math.abs(tp3Pips / slPips);
  const rrMax = Math.abs(tp3Pips / slPips);

  const formatPrice = (price: number) => price.toFixed(5);
  const formatPips = (pips: number) => {
    const sign = pips >= 0 ? '+' : '';
    return `${sign}${pips.toFixed(1)}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-700/50 to-slate-800/50 px-4 py-3 border-b border-slate-600">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Trade Breakdown</h3>
          </div>
          <div className="text-xs text-slate-400">
            {symbol} • {session || 'N/A'} • {confidence}% conf
          </div>
        </div>
      </div>

      {/* Trade Levels */}
      <div className="p-4 space-y-2">
        {/* TP3 */}
        <div className={`flex items-center justify-between p-2 rounded ${
          targetHit === 3 ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-emerald-500/10'
        }`}>
          <div className="flex items-center gap-2">
            {targetHit === 3 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {targetHit !== 3 && <Target className="w-4 h-4 text-emerald-400" />}
            <span className="text-xs font-medium text-slate-300">TP3</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-emerald-400 font-semibold">
              {formatPrice(tp3)}
            </span>
            <span className="text-xs font-semibold text-emerald-400 min-w-[70px] text-right">
              {formatPips(tp3Pips)} pips
            </span>
          </div>
        </div>

        {/* TP2 */}
        <div className={`flex items-center justify-between p-2 rounded ${
          targetHit === 2 ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-emerald-500/10'
        }`}>
          <div className="flex items-center gap-2">
            {targetHit === 2 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {targetHit !== 2 && <Target className="w-4 h-4 text-emerald-400" />}
            <span className="text-xs font-medium text-slate-300">TP2</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-emerald-400 font-semibold">
              {formatPrice(tp2)}
            </span>
            <span className="text-xs font-semibold text-emerald-400 min-w-[70px] text-right">
              {formatPips(tp2Pips)} pips
            </span>
          </div>
        </div>

        {/* TP1 */}
        <div className={`flex items-center justify-between p-2 rounded ${
          targetHit === 1 ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-emerald-500/10'
        }`}>
          <div className="flex items-center gap-2">
            {targetHit >= 1 && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {targetHit < 1 && <Target className="w-4 h-4 text-emerald-400" />}
            <span className="text-xs font-medium text-slate-300">TP1</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-emerald-400 font-semibold">
              {formatPrice(tp1)}
            </span>
            <span className="text-xs font-semibold text-emerald-400 min-w-[70px] text-right">
              {formatPips(tp1Pips)} pips
              {targetHit >= 1 && ' ✓'}
            </span>
          </div>
        </div>

        {/* ENTRY */}
        <div className="flex items-center justify-between p-2 rounded bg-slate-700/50 border border-slate-600">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-white" />
            <span className="text-xs font-bold text-white">ENTRY</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-white font-bold">
              {formatPrice(entry)}
            </span>
            <span className="text-xs text-slate-400 min-w-[70px] text-right">
              {confidence}% conf
            </span>
          </div>
        </div>

        {/* STOP LOSS */}
        <div className="flex items-center justify-between p-2 rounded bg-red-500/10">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-xs font-medium text-slate-300">STOP</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-red-400 font-semibold">
              {formatPrice(stopLoss)}
            </span>
            <span className="text-xs font-semibold text-red-400 min-w-[70px] text-right">
              {formatPips(slPips)} pips
            </span>
          </div>
        </div>
      </div>

      {/* Risk/Reward Footer */}
      <div className="bg-gradient-to-r from-slate-700/30 to-slate-800/30 px-4 py-3 border-t border-slate-600">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-xs text-slate-400 mb-1">R:R Actual</div>
            <div className="text-lg font-bold text-emerald-400">
              1:{rrActual.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500">
              (TP{targetHit} hit)
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">R:R Max</div>
            <div className="text-lg font-bold text-cyan-400">
              1:{rrMax.toFixed(1)}
            </div>
            <div className="text-xs text-slate-500">
              (TP3 potential)
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

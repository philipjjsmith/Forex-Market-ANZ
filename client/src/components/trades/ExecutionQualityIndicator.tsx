import { motion } from 'framer-motion';
import { Activity, Zap, TrendingDown, TrendingUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ExecutionQualityIndicatorProps {
  entrySlippage: number; // in pips
  exitSlippage: number; // in pips
  fillLatency: number; // in milliseconds
  mae: number; // Maximum Adverse Excursion in pips
  mfe: number; // Maximum Favorable Excursion in pips
}

export function ExecutionQualityIndicator({
  entrySlippage,
  exitSlippage,
  fillLatency,
  mae,
  mfe
}: ExecutionQualityIndicatorProps) {
  const totalSlippage = Math.abs(entrySlippage) + Math.abs(exitSlippage);

  // Determine slippage rating
  const slippageRating = totalSlippage < 0.5 ? 'Excellent' :
                         totalSlippage < 1.0 ? 'Good' :
                         totalSlippage < 2.0 ? 'Fair' : 'Poor';

  const slippageColor = totalSlippage < 0.5 ? 'text-green-400' :
                        totalSlippage < 1.0 ? 'text-lime-400' :
                        totalSlippage < 2.0 ? 'text-yellow-400' : 'text-red-400';

  // Determine latency rating
  const latencyRating = fillLatency < 100 ? 'Excellent' :
                        fillLatency < 200 ? 'Good' :
                        fillLatency < 500 ? 'Fair' : 'Poor';

  const latencyColor = fillLatency < 100 ? 'text-green-400' :
                       fillLatency < 200 ? 'text-lime-400' :
                       fillLatency < 500 ? 'text-yellow-400' : 'text-red-400';

  // Calculate MAE/MFE ratio
  const mfeRatio = mae > 0 ? (mfe / mae) : 0;
  const efficiencyRating = mfeRatio >= 5.0 ? 'Excellent' :
                           mfeRatio >= 3.0 ? 'Good' :
                           mfeRatio >= 2.0 ? 'Fair' : 'Poor';

  const efficiencyColor = mfeRatio >= 5.0 ? 'text-green-400' :
                          mfeRatio >= 3.0 ? 'text-lime-400' :
                          mfeRatio >= 2.0 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Slippage Indicator */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 dark:bg-black/20 backdrop-blur-sm border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors cursor-help"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">Slippage</span>
                </div>
                <span className={`text-xs font-semibold ${slippageColor}`}>
                  {slippageRating}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className={`text-2xl font-bold ${slippageColor}`}>
                    {totalSlippage.toFixed(1)}
                  </span>
                  <span className="text-xs text-gray-500">pips</span>
                </div>

                <div className="flex gap-2 text-xs">
                  <div className="flex-1">
                    <span className="text-gray-500">Entry:</span>
                    <span className={`ml-1 ${entrySlippage >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {entrySlippage >= 0 ? '+' : ''}{entrySlippage.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className="text-gray-500">Exit:</span>
                    <span className={`ml-1 ${exitSlippage >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {exitSlippage >= 0 ? '+' : ''}{exitSlippage.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>Slippage</strong> is the difference between expected and actual execution price.
              Positive = worse price, Negative = better price. Target: &lt;0.5 pips total.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Fill Latency Indicator */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white/5 dark:bg-black/20 backdrop-blur-sm border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors cursor-help"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">Fill Speed</span>
                </div>
                <span className={`text-xs font-semibold ${latencyColor}`}>
                  {latencyRating}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className={`text-2xl font-bold ${latencyColor}`}>
                    {fillLatency}
                  </span>
                  <span className="text-xs text-gray-500">ms</span>
                </div>

                {/* Latency bar */}
                <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((fillLatency / 500) * 100, 100)}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className={`h-full ${
                      fillLatency < 100 ? 'bg-green-500' :
                      fillLatency < 200 ? 'bg-lime-500' :
                      fillLatency < 500 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                  />
                </div>

                <p className="text-xs text-gray-500">
                  {fillLatency < 100 ? 'Professional-grade' :
                   fillLatency < 200 ? 'Good for day trading' :
                   fillLatency < 500 ? 'Standard retail' : 'Consider VPS'}
                </p>
              </div>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>Fill Latency</strong> measures how quickly your order is executed.
              &lt;100ms is excellent. High latency can cause missed opportunities.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* MAE/MFE Efficiency */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white/5 dark:bg-black/20 backdrop-blur-sm border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors cursor-help"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-300">Efficiency</span>
                </div>
                <span className={`text-xs font-semibold ${efficiencyColor}`}>
                  {efficiencyRating}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className={`text-2xl font-bold ${efficiencyColor}`}>
                    {mfeRatio.toFixed(1)}x
                  </span>
                  <span className="text-xs text-gray-500">MFE/MAE</span>
                </div>

                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingDown className="w-3 h-3 text-red-400" />
                      <span className="text-xs text-gray-500">MAE</span>
                    </div>
                    <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full bg-red-500" style={{ width: '100%' }} />
                    </div>
                    <span className="text-xs text-gray-400">{mae.toFixed(1)} pips</span>
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendingUp className="w-3 h-3 text-green-400" />
                      <span className="text-xs text-gray-500">MFE</span>
                    </div>
                    <div className="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full bg-green-500"
                      />
                    </div>
                    <span className="text-xs text-gray-400">{mfe.toFixed(1)} pips</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>MAE</strong> (Maximum Adverse Excursion): Largest drawdown during trade.<br />
              <strong>MFE</strong> (Maximum Favorable Excursion): Peak profit reached.<br />
              High MFE/MAE ratio (>3.0) indicates good profit capture.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

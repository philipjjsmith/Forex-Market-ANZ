import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface Candle {
  time: string;
  high: number;
  low: number;
  close: number;
}

interface MAEMFEChartProps {
  candles: Candle[];
  entryPrice: number;
  type: 'LONG' | 'SHORT';
  mae: number;
  mfe: number;
  symbol: string;
}

export function MAEMFEChart({ candles, entryPrice, type, mae, mfe, symbol }: MAEMFEChartProps) {
  // Calculate pip movement for each candle
  const pipFactor = symbol.includes('JPY') ? 100 : 10000;

  const chartData = candles.slice(0, 50).map((candle, index) => {
    let adverseMove, favorableMove;

    if (type === 'LONG') {
      adverseMove = (entryPrice - candle.low) * pipFactor;
      favorableMove = (candle.high - entryPrice) * pipFactor;
    } else {
      adverseMove = (candle.high - entryPrice) * pipFactor;
      favorableMove = (entryPrice - candle.low) * pipFactor;
    }

    return {
      index: index + 1,
      mae: adverseMove > 0 ? adverseMove : 0,
      mfe: favorableMove > 0 ? favorableMove : 0,
      time: new Date(candle.time).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  });

  const maxMAE = Math.max(...chartData.map(d => d.mae));
  const maxMFE = Math.max(...chartData.map(d => d.mfe));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Header Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-red-500/10 to-red-600/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-5 h-5 text-red-400" />
            <span className="text-sm font-semibold text-red-300">Maximum Adverse Excursion</span>
          </div>
          <div className="text-3xl font-bold text-red-400">
            {mae.toFixed(1)}
            <span className="text-lg text-red-400/60 ml-2">pips</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Worst drawdown: {((mae / maxMAE) * 100).toFixed(0)}% of peak adverse
          </p>
        </div>

        <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 border border-green-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            <span className="text-sm font-semibold text-green-300">Maximum Favorable Excursion</span>
          </div>
          <div className="text-3xl font-bold text-green-400">
            {mfe.toFixed(1)}
            <span className="text-lg text-green-400/60 ml-2">pips</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Peak profit: {((mfe / maxMFE) * 100).toFixed(0)}% of maximum favorable
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg p-4 border border-white/10">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">
          Trade Excursion Over Time
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis
              dataKey="index"
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
              label={{ value: 'Candle #', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
            />
            <YAxis
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
              label={{ value: 'Pips', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                border: '1px solid rgba(75, 85, 99, 0.3)',
                borderRadius: '8px',
                backdropFilter: 'blur(10px)'
              }}
              labelStyle={{ color: '#F3F4F6' }}
              itemStyle={{ fontSize: '12px' }}
              formatter={(value: number) => [`${value.toFixed(2)} pips`, '']}
              labelFormatter={(label) => `Candle #${label}`}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              iconType="line"
            />
            <ReferenceLine
              y={0}
              stroke="#6B7280"
              strokeDasharray="3 3"
              label={{
                value: 'Entry',
                position: 'right',
                fill: '#9CA3AF',
                fontSize: 12
              }}
            />
            <Line
              type="monotone"
              dataKey="mae"
              stroke="#EF4444"
              strokeWidth={2}
              dot={false}
              name="Adverse Movement"
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="mfe"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
              name="Favorable Movement"
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Interpretation */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg p-4 border border-white/10">
        <h4 className="text-sm font-semibold text-gray-300 mb-2">Interpretation</h4>
        <div className="space-y-2 text-sm text-gray-400">
          <p>
            <strong className="text-gray-300">MFE/MAE Ratio:</strong>{' '}
            {(mfe / mae).toFixed(2)}x
            {' - '}
            {mfe / mae >= 5.0 && 'Excellent profit capture. You efficiently captured most of the move.'}
            {mfe / mae >= 3.0 && mfe / mae < 5.0 && 'Good profit capture. Trade managed well overall.'}
            {mfe / mae >= 2.0 && mfe / mae < 3.0 && 'Fair profit capture. Consider tighter profit management.'}
            {mfe / mae < 2.0 && 'Gave back significant profits. Review exit strategy.'}
          </p>
          <p>
            <strong className="text-gray-300">MAE Analysis:</strong>{' '}
            {mae / Math.abs(entryPrice - (type === 'LONG' ? entryPrice - (mae / pipFactor) : entryPrice + (mae / pipFactor))) < 0.2
              ? 'Excellent entry timing with minimal drawdown.'
              : mae / Math.abs(entryPrice - (type === 'LONG' ? entryPrice - (mae / pipFactor) : entryPrice + (mae / pipFactor))) < 0.5
              ? 'Good entry with acceptable drawdown.'
              : 'Entry timing could be improved - experienced significant drawdown.'}
          </p>
          <p className="text-xs italic">
            Professional traders use MAE/MFE analysis to optimize entry timing and exit strategies. Low MAE = good entries. High MFE/MAE ratio = good exits.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

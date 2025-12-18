import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';

interface ComparisonData {
  currentTrade: {
    profit: number;
    duration: number;
    rr: number;
  };
  strategyAverage: {
    avgProfit: number;
    avgDuration: number;
    winRate: number;
  };
  percentile: number;
  rank: string;
}

interface ComparisonChartProps {
  data: ComparisonData;
  symbol: string;
}

export function ComparisonChart({ data, symbol }: ComparisonChartProps) {
  const chartData = [
    {
      metric: 'Profit (pips)',
      'This Trade': data.currentTrade.profit,
      'Strategy Avg': data.strategyAverage.avgProfit
    },
    {
      metric: 'Duration (hrs)',
      'This Trade': data.currentTrade.duration,
      'Strategy Avg': data.strategyAverage.avgDuration
    },
    {
      metric: 'R:R Ratio',
      'This Trade': data.currentTrade.rr,
      'Strategy Avg': 2.0 // Typical target
    }
  ];

  // Determine percentile color
  const percentileColor = data.percentile >= 90 ? 'text-green-400' :
                          data.percentile >= 75 ? 'text-lime-400' :
                          data.percentile >= 50 ? 'text-yellow-400' :
                          data.percentile >= 25 ? 'text-orange-400' : 'text-red-400';

  const percentileBg = data.percentile >= 90 ? 'from-green-500/20 to-emerald-600/20' :
                       data.percentile >= 75 ? 'from-lime-500/20 to-green-600/20' :
                       data.percentile >= 50 ? 'from-yellow-500/20 to-amber-600/20' :
                       data.percentile >= 25 ? 'from-orange-500/20 to-red-600/20' : 'from-red-500/20 to-red-700/20';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      {/* Header with percentile rank */}
      <div className={`relative overflow-hidden rounded-lg p-6 bg-gradient-to-br ${percentileBg} border border-white/10`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">
              Performance vs Strategy Average
            </h3>
            <p className="text-sm text-gray-300">
              {symbol} • ICT 3-Timeframe Strategy
            </p>
          </div>

          <div className="text-right">
            <div className={`text-4xl font-bold ${percentileColor}`}>
              {data.percentile.toFixed(0)}th
            </div>
            <div className="text-sm text-gray-300">Percentile</div>
            <div className="mt-1 px-3 py-1 bg-white/10 rounded-full">
              <span className="text-xs font-semibold text-white">{data.rank}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Bar Chart */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg p-4 border border-white/10">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
            <XAxis
              dataKey="metric"
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
            />
            <YAxis
              stroke="#9CA3AF"
              style={{ fontSize: '12px' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(17, 24, 39, 0.9)',
                border: '1px solid rgba(75, 85, 99, 0.3)',
                borderRadius: '8px',
                backdropFilter: 'blur(10px)'
              }}
              labelStyle={{ color: '#F3F4F6' }}
              itemStyle={{ color: '#D1D5DB' }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              iconType="circle"
            />
            <Bar dataKey="This Trade" fill="#3B82F6" radius={[8, 8, 0, 0]}>
              {chartData.map((entry, index) => {
                const isBetter = entry['This Trade'] > entry['Strategy Avg'];
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={isBetter ? '#10B981' : '#3B82F6'}
                  />
                );
              })}
            </Bar>
            <Bar dataKey="Strategy Avg" fill="#6B7280" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Performance Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400 mb-1">Profit Comparison</div>
          <div className={`text-lg font-bold ${
            data.currentTrade.profit > data.strategyAverage.avgProfit ? 'text-green-400' : 'text-gray-300'
          }`}>
            {data.currentTrade.profit > data.strategyAverage.avgProfit ? '+' : ''}
            {((data.currentTrade.profit / data.strategyAverage.avgProfit - 1) * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500">vs average</div>
        </div>

        <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400 mb-1">Duration</div>
          <div className="text-lg font-bold text-gray-300">
            {data.currentTrade.duration.toFixed(1)}h
          </div>
          <div className="text-xs text-gray-500">
            Avg: {data.strategyAverage.avgDuration.toFixed(1)}h
          </div>
        </div>

        <div className="bg-white/5 dark:bg-black/20 rounded-lg p-3 border border-white/10">
          <div className="text-xs text-gray-400 mb-1">Strategy Win Rate</div>
          <div className="text-lg font-bold text-gray-300">
            {data.strategyAverage.winRate.toFixed(0)}%
          </div>
          <div className="text-xs text-gray-500">Historical</div>
        </div>
      </div>
    </motion.div>
  );
}

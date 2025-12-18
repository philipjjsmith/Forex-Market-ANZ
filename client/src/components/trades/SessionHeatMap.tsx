import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SessionStats {
  session: string;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgProfit: number;
}

interface SessionHeatMapProps {
  sessions: SessionStats[];
  currentSession?: string;
}

export function SessionHeatMap({ sessions, currentSession }: SessionHeatMapProps) {
  // Find session stats or create default
  const getSessionStats = (sessionName: string): SessionStats => {
    return sessions.find(s => s.session === sessionName) || {
      session: sessionName,
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      avgProfit: 0
    };
  };

  const asiaStats = getSessionStats('ASIA');
  const londonStats = getSessionStats('LONDON');
  const nyStats = getSessionStats('NY');
  const overlapStats = getSessionStats('LONDON_NY_OVERLAP');

  // Get color based on win rate
  const getHeatColor = (winRate: number, totalTrades: number) => {
    if (totalTrades === 0) return 'bg-gray-800/50 border-gray-700/30';

    if (winRate >= 75) return 'bg-green-600/60 border-green-500/40';
    if (winRate >= 60) return 'bg-lime-600/60 border-lime-500/40';
    if (winRate >= 50) return 'bg-yellow-600/60 border-yellow-500/40';
    if (winRate >= 40) return 'bg-orange-600/60 border-orange-500/40';
    return 'bg-red-600/60 border-red-500/40';
  };

  const getTextColor = (winRate: number, totalTrades: number) => {
    if (totalTrades === 0) return 'text-gray-500';

    if (winRate >= 75) return 'text-green-100';
    if (winRate >= 60) return 'text-lime-100';
    if (winRate >= 50) return 'text-yellow-100';
    if (winRate >= 40) return 'text-orange-100';
    return 'text-red-100';
  };

  const SessionCard = ({ stats, position }: { stats: SessionStats; position: number }) => {
    const isCurrentSession = currentSession === stats.session;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: position * 0.1 }}
              className={`relative ${getHeatColor(stats.winRate, stats.totalTrades)}
                         border-2 rounded-lg p-4 backdrop-blur-sm
                         hover:scale-105 transition-transform cursor-help
                         ${isCurrentSession ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900' : ''}`}
            >
              {isCurrentSession && (
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-cyan-400 rounded-full animate-pulse" />
              )}

              <div className="flex flex-col items-center justify-center h-full min-h-[120px]">
                <span className={`text-xs font-medium uppercase tracking-wider mb-2 ${
                  stats.totalTrades === 0 ? 'text-gray-500' : 'text-white/80'
                }`}>
                  {stats.session === 'LONDON_NY_OVERLAP' ? 'Overlap' :
                   stats.session.charAt(0) + stats.session.slice(1).toLowerCase()}
                </span>

                {stats.totalTrades > 0 ? (
                  <>
                    <div className={`text-4xl font-bold ${getTextColor(stats.winRate, stats.totalTrades)}`}>
                      {stats.winRate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-white/60 mt-1">
                      {stats.totalTrades} trade{stats.totalTrades !== 1 ? 's' : ''}
                    </div>
                    <div className={`text-xs mt-2 ${
                      stats.avgProfit > 0 ? 'text-green-300' : 'text-red-300'
                    }`}>
                      {stats.avgProfit > 0 ? '+' : ''}{stats.avgProfit.toFixed(1)} pips avg
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-gray-500">No data</div>
                )}
              </div>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">
                {stats.session === 'ASIA' && 'Asian Session (23:00-08:00 UTC)'}
                {stats.session === 'LONDON' && 'London Session (07:00-16:00 UTC)'}
                {stats.session === 'NY' && 'New York Session (12:00-21:00 UTC)'}
                {stats.session === 'LONDON_NY_OVERLAP' && 'London/NY Overlap (12:00-16:00 UTC)'}
              </p>
              {stats.totalTrades > 0 ? (
                <>
                  <p className="text-sm">
                    Win Rate: {stats.winRate.toFixed(1)}%
                  </p>
                  <p className="text-sm">
                    Wins: {stats.winningTrades} | Losses: {stats.losingTrades}
                  </p>
                  <p className="text-sm">
                    Avg Profit: {stats.avgProfit > 0 ? '+' : ''}{stats.avgProfit.toFixed(1)} pips
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-400">No trades in this session yet</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-200">Trading Session Performance</h3>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="flex gap-1 items-center">
            <div className="w-3 h-3 bg-green-600 rounded" />
            <span>&gt;75%</span>
          </div>
          <div className="flex gap-1 items-center">
            <div className="w-3 h-3 bg-lime-600 rounded" />
            <span>60-75%</span>
          </div>
          <div className="flex gap-1 items-center">
            <div className="w-3 h-3 bg-yellow-600 rounded" />
            <span>50-60%</span>
          </div>
          <div className="flex gap-1 items-center">
            <div className="w-3 h-3 bg-orange-600 rounded" />
            <span>40-50%</span>
          </div>
          <div className="flex gap-1 items-center">
            <div className="w-3 h-3 bg-red-600 rounded" />
            <span>&lt;40%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SessionCard stats={asiaStats} position={0} />
        <SessionCard stats={londonStats} position={1} />
        <SessionCard stats={nyStats} position={2} />
        <SessionCard stats={overlapStats} position={3} />
      </div>

      {/* Session characteristics info */}
      <div className="mt-6 p-4 bg-white/5 dark:bg-black/20 rounded-lg border border-white/10">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Session Characteristics</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-purple-400 font-medium">Asia:</span>
            <span className="text-gray-400 ml-2">Lower volatility, range trading</span>
          </div>
          <div>
            <span className="text-blue-400 font-medium">London:</span>
            <span className="text-gray-400 ml-2">High volatility, strong trends</span>
          </div>
          <div>
            <span className="text-indigo-400 font-medium">New York:</span>
            <span className="text-gray-400 ml-2">USD pairs active, high volume</span>
          </div>
          <div>
            <span className="text-cyan-400 font-medium">Overlap:</span>
            <span className="text-gray-400 ml-2">Highest liquidity globally</span>
          </div>
        </div>
      </div>
    </div>
  );
}

import { AlertCircle, TrendingUp, Clock, Newspaper } from 'lucide-react';
import { motion } from 'framer-motion';

interface NewsEvent {
  time: string;
  currency: string;
  event: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  timeDiff?: string;
}

interface MarketContextBadgeProps {
  newsEvents: NewsEvent[];
  session: string;
  volatilityLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
}

export function MarketContextBadge({ newsEvents, session, volatilityLevel }: MarketContextBadgeProps) {
  // Get high impact events only
  const highImpactEvents = newsEvents.filter(e => e.impact === 'HIGH');

  // Impact color mapping
  const impactColors = {
    HIGH: 'bg-red-500/20 text-red-400 border-red-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    LOW: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  };

  // Volatility color mapping
  const volatilityColors = {
    LOW: 'bg-green-500/20 text-green-400 border-green-500/30',
    MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    EXTREME: 'bg-red-500/20 text-red-400 border-red-500/30'
  };

  // Session color mapping
  const sessionColors = {
    ASIA: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    LONDON: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    NY: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    LONDON_NY_OVERLAP: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    OFF_HOURS: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  };

  const sessionColor = sessionColors[session as keyof typeof sessionColors] || sessionColors.OFF_HOURS;

  return (
    <div className="flex flex-wrap gap-3">
      {/* High Impact News Events */}
      {highImpactEvents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col gap-2"
        >
          {highImpactEvents.slice(0, 3).map((event, index) => (
            <div
              key={index}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${impactColors[event.impact]} backdrop-blur-sm`}
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold truncate">
                  {event.event}
                </span>
                <span className="text-xs opacity-75">
                  {event.currency} • {event.timeDiff || 'at entry'}
                </span>
              </div>
            </div>
          ))}

          {highImpactEvents.length > 3 && (
            <div className="text-xs text-gray-400 px-3">
              +{highImpactEvents.length - 3} more events
            </div>
          )}
        </motion.div>
      )}

      {/* Volatility Level Badge */}
      {volatilityLevel && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${volatilityColors[volatilityLevel]} backdrop-blur-sm h-fit`}
        >
          <TrendingUp className="w-4 h-4" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase">
              {volatilityLevel} Volatility
            </span>
            <span className="text-xs opacity-75">
              {volatilityLevel === 'LOW' && 'Stable market conditions'}
              {volatilityLevel === 'MEDIUM' && 'Normal market activity'}
              {volatilityLevel === 'HIGH' && 'Increased volatility'}
              {volatilityLevel === 'EXTREME' && 'Very high volatility'}
            </span>
          </div>
        </motion.div>
      )}

      {/* Trading Session Badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${sessionColor} backdrop-blur-sm h-fit`}
      >
        <Clock className="w-4 h-4" />
        <div className="flex flex-col">
          <span className="text-xs font-semibold">
            {session === 'LONDON_NY_OVERLAP' ? 'London/NY Overlap' :
             session === 'ASIA' ? 'Asian Session' :
             session === 'LONDON' ? 'London Session' :
             session === 'NY' ? 'New York Session' :
             'Off-Hours'}
          </span>
          <span className="text-xs opacity-75">
            {session === 'LONDON_NY_OVERLAP' && 'Highest liquidity'}
            {session === 'ASIA' && 'Lower volatility'}
            {session === 'LONDON' && 'High activity'}
            {session === 'NY' && 'USD pairs active'}
            {session === 'OFF_HOURS' && 'Low liquidity'}
          </span>
        </div>
      </motion.div>

      {/* News Count Indicator */}
      {newsEvents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm h-fit"
        >
          <Newspaper className="w-4 h-4 text-gray-400" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-gray-300">
              {newsEvents.length} Events
            </span>
            <span className="text-xs text-gray-500">
              ±2 hours window
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

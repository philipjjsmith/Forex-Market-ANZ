import { motion } from 'framer-motion';
import { Newspaper, AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface NewsEvent {
  event: string;
  timeDiff: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface NewsImpactSectionProps {
  newsEvents: NewsEvent[];
  tradeType: 'LONG' | 'SHORT';
  session?: string;
}

export function NewsImpactSection({ newsEvents, tradeType, session }: NewsImpactSectionProps) {
  // If no news events, show that market was calm
  if (!newsEvents || newsEvents.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-lg p-4"
      >
        <div className="flex items-center gap-2 mb-2">
          <Newspaper className="w-4 h-4 text-slate-400" />
          <h4 className="text-sm font-semibold text-slate-300">Market Conditions</h4>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Minus className="w-4 h-4 text-slate-500" />
          <span>No major news events during this trade • Clean technical setup</span>
        </div>
      </motion.div>
    );
  }

  // Separate high impact from others
  const highImpactNews = newsEvents.filter(e => e.impact === 'HIGH');
  const otherNews = newsEvents.filter(e => e.impact !== 'HIGH');

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'HIGH':
        return 'text-red-400 border-red-500/30 bg-red-500/10';
      case 'MEDIUM':
        return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
      default:
        return 'text-slate-400 border-slate-500/30 bg-slate-500/10';
    }
  };

  const getImpactIcon = (impact: string) => {
    switch (impact) {
      case 'HIGH':
        return AlertCircle;
      case 'MEDIUM':
        return TrendingUp;
      default:
        return Minus;
    }
  };

  const getTradeImpactAnalysis = () => {
    if (highImpactNews.length === 0) {
      return 'Normal volatility • News events had minimal market impact';
    }

    const newsCount = highImpactNews.length;
    const eventName = highImpactNews[0].event;
    const timing = highImpactNews[0].timeDiff;

    if (newsCount === 1) {
      return `${eventName} ${timing} created ${tradeType === 'LONG' ? 'bullish' : 'bearish'} momentum • High volatility window`;
    } else {
      return `${newsCount} major events influenced market • Increased volatility favored ${tradeType.toLowerCase()} direction`;
    }
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
            <Newspaper className="w-4 h-4 text-cyan-400" />
            <h4 className="text-sm font-semibold text-white">News Impact Analysis</h4>
          </div>
          {highImpactNews.length > 0 && (
            <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-semibold">
              {highImpactNews.length} High Impact
            </span>
          )}
        </div>
      </div>

      {/* News Events */}
      <div className="p-4 space-y-3">
        {/* High Impact Events */}
        {highImpactNews.map((news, index) => {
          const Icon = getImpactIcon(news.impact);
          return (
            <div
              key={`high-${index}`}
              className={`flex items-start gap-3 p-3 rounded-lg border ${getImpactColor(news.impact)}`}
            >
              <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{news.event}</div>
                <div className="text-xs text-slate-400 mt-1">{news.timeDiff}</div>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 font-semibold">
                HIGH
              </span>
            </div>
          );
        })}

        {/* Other Events */}
        {otherNews.map((news, index) => {
          const Icon = getImpactIcon(news.impact);
          return (
            <div
              key={`other-${index}`}
              className={`flex items-start gap-3 p-2 rounded-lg border ${getImpactColor(news.impact)}`}
            >
              <Icon className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-300">{news.event}</div>
                <div className="text-xs text-slate-500 mt-0.5">{news.timeDiff}</div>
              </div>
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-600/20 text-slate-400 font-medium">
                {news.impact}
              </span>
            </div>
          );
        })}

        {/* Impact Analysis */}
        <div className="mt-4 pt-3 border-t border-slate-600">
          <div className="flex items-start gap-2">
            {tradeType === 'LONG' ? (
              <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400 mt-0.5" />
            )}
            <p className="text-xs text-slate-300 leading-relaxed">
              <span className="font-semibold text-white">Market Impact:</span> {getTradeImpactAnalysis()}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

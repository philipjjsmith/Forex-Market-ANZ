import { motion } from 'framer-motion';
import { Calendar, Clock, TrendingUp, Target, Award } from 'lucide-react';

interface TradeNarrativeProps {
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  outcome: string;
  outcomePrice: number;
  profitPips: number;
  duration: string;
  session: string;
  newsEvents: Array<{ event: string; timeDiff: string; impact: string }>;
  confidence: number;
}

export function TradeNarrative({
  symbol,
  type,
  entry,
  outcome,
  outcomePrice,
  profitPips,
  duration,
  session,
  newsEvents,
  confidence
}: TradeNarrativeProps) {
  // Generate narrative text
  const sessionName = session === 'LONDON_NY_OVERLAP' ? 'London/NY overlap' :
                      session === 'ASIA' ? 'Asian' :
                      session === 'LONDON' ? 'London' :
                      session === 'NY' ? 'New York' : 'off-hours';

  const highImpactNews = newsEvents.filter(e => e.impact === 'HIGH');

  const generateStory = () => {
    let story = `This ${type.toLowerCase()} trade on ${symbol} entered during the ${sessionName} session at ${entry.toFixed(5)}.`;

    if (highImpactNews.length > 0) {
      const newsDesc = highImpactNews.length === 1 ? `the ${highImpactNews[0].event}` : `${highImpactNews.length} major economic events`;
      story += ` Market conditions were influenced by ${newsDesc}, which occurred ${highImpactNews[0].timeDiff}.`;
    }

    story += ` With ${confidence}% confidence, the setup aligned across multiple timeframes, indicating strong directional bias.`;

    if (outcome.includes('TP')) {
      const tpLevel = outcome.includes('TP3') ? 'third' : outcome.includes('TP2') ? 'second' : 'first';
      story += ` The trade successfully reached its ${tpLevel} take profit target at ${outcomePrice.toFixed(5)}, securing ${profitPips > 0 ? '+' : ''}${profitPips.toFixed(1)} pips`;
    } else if (outcome === 'STOP_HIT') {
      story += ` The trade hit the stop loss at ${outcomePrice.toFixed(5)}, resulting in a ${profitPips.toFixed(1)} pip loss`;
    }

    story += ` after ${duration}.`;

    if (profitPips > 50) {
      story += ` This was an exceptional result, capturing significant market movement efficiently.`;
    } else if (profitPips > 20) {
      story += ` A solid profit that validates the strategy's edge in these market conditions.`;
    }

    return story;
  };

  // Timeline events
  const timelineEvents = [
    {
      icon: Calendar,
      title: 'Entry Setup',
      description: `${confidence}% confidence ${type.toLowerCase()} signal during ${sessionName} session`,
      color: 'text-blue-400'
    },
    ...(highImpactNews.length > 0 ? [{
      icon: TrendingUp,
      title: 'Market Event',
      description: `${highImpactNews[0].event} ${highImpactNews[0].timeDiff}`,
      color: 'text-yellow-400'
    }] : []),
    {
      icon: Target,
      title: 'Execution',
      description: `Entry at ${entry.toFixed(5)}`,
      color: 'text-green-400'
    },
    {
      icon: Award,
      title: 'Outcome',
      description: `${outcome.replace('_', ' ')} at ${outcomePrice.toFixed(5)} (+${profitPips.toFixed(1)} pips)`,
      color: profitPips > 0 ? 'text-emerald-400' : 'text-red-400'
    },
    {
      icon: Clock,
      title: 'Duration',
      description: duration,
      color: 'text-purple-400'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Narrative Story */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-white/5 to-white/10 dark:from-black/20 dark:to-black/30 rounded-lg p-6 border border-white/10"
      >
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1 h-6 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full" />
          Trade Story
        </h3>
        <p className="text-gray-300 leading-relaxed text-sm">
          {generateStory()}
        </p>
      </motion.div>

      {/* Timeline */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg p-6 border border-white/10">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">Trade Timeline</h4>
        <div className="space-y-4">
          {timelineEvents.map((event, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-start gap-3"
            >
              <div className={`mt-0.5 ${event.color}`}>
                <event.icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{event.title}</div>
                <div className="text-xs text-gray-400 mt-0.5">{event.description}</div>
              </div>
              {index < timelineEvents.length - 1 && (
                <div className="absolute left-[10px] top-8 w-px h-8 bg-gradient-to-b from-gray-600 to-transparent" />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

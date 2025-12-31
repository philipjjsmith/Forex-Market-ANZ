import { useState } from 'react';
import { ChevronDown, ChevronRight, TrendingUp, BarChart3, Clock, Calculator } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface LessonSection {
  title: string;
  icon: any;
  content: string[];
  color: string;
}

const INTERMEDIATE_LESSONS: LessonSection[] = [
  {
    title: 'Multi-Timeframe Analysis (MTF)',
    icon: TrendingUp,
    color: 'text-cyan-400',
    content: [
      '📊 ICT 3-Timeframe Rule',
      '',
      'Higher Timeframes: Weekly + Daily + 4H',
      '→ Must ALL align for high-probability setup',
      '→ This is your TREND direction',
      '',
      'Lower Timeframe: 1H',
      '→ Used for ENTRY TIMING only',
      '→ Pullbacks (1H opposite to HTF) are GOOD!',
      '',
      'Why it works:',
      '• 4:1 or 5:1 timeframe ratios reduce false signals',
      '• London/NY sessions show clearest MTF alignment',
      '• 65-75% win rate when 3 HTFs agree',
      '',
      'Example combinations:',
      'Day Trading: 15M / 1H / 4H',
      'Swing Trading: 1H / 4H / Daily',
    ]
  },
  {
    title: 'Chart Pattern Recognition',
    icon: BarChart3,
    color: 'text-emerald-400',
    content: [
      '📈 Key Reversal Patterns',
      '',
      'HEAD & SHOULDERS (Bearish Reversal)',
      '• 3 peaks: Left shoulder, Head (highest), Right shoulder',
      '• Neckline = Support that breaks downward',
      '• Volume MUST increase on neckline break',
      '',
      'DOUBLE TOP (Bearish Reversal)',
      '• 2 equal highs with valley between',
      '• Confirms when price breaks support',
      '• Target: Distance from peak to valley',
      '',
      'ASCENDING TRIANGLE (Bullish Continuation)',
      '• Flat resistance + rising support',
      '• Breakout direction: Upward (70% probability)',
      '• Best during uptrends',
      '',
      '⚠️ Volume = Confirmation',
      'Low volume breakout = Likely false signal',
      'High volume breakout = High probability move',
    ]
  },
  {
    title: 'Session-Based Trading',
    icon: Clock,
    color: 'text-purple-400',
    content: [
      '🌍 Trading Session Analysis',
      '',
      'ASIAN SESSION (12AM-9AM EST)',
      '• Lower volatility, range-bound',
      '• Best for: EUR/JPY, AUD/JPY',
      '• Avg movement: 30-50 pips',
      '',
      'LONDON SESSION (3AM-12PM EST)',
      '• Highest volatility, strong trends',
      '• Best for: EUR/USD, GBP/USD',
      '• Avg movement: 80-150 pips',
      '',
      'NY SESSION (8AM-5PM EST)',
      '• USD pairs dominate',
      '• Best for: USD/JPY, EUR/USD',
      '• Economic news drives moves',
      '',
      '🔥 LONDON/NY OVERLAP (8AM-12PM EST)',
      '• 70% of ALL forex volume occurs here',
      '• Most liquid period of the day',
      '• EUR/USD moves 80-150 pips',
      '• Best for breakout strategies',
      '',
      'Your strategy may work in London but fail in Asia!',
      'Track performance by session.',
    ]
  },
  {
    title: 'Risk Management Calculator',
    icon: Calculator,
    color: 'text-amber-400',
    content: [
      '💰 Position Sizing Formula',
      '',
      'NEVER risk more than 1-2% per trade!',
      '',
      'Formula:',
      'Position Size = (Account × Risk%) / (SL in pips × Pip Value)',
      '',
      'Example:',
      'Account: $10,000',
      'Risk: 2% ($200)',
      'Stop Loss: 50 pips',
      'Pip Value: $10/pip (1 lot EUR/USD)',
      '',
      'Position = $200 / (50 × $10) = 0.4 lots',
      '',
      'Quick Reference:',
      '$1,000 account @ 2% risk = $20 per trade',
      '$5,000 account @ 2% risk = $100 per trade',
      '$10,000 account @ 2% risk = $200 per trade',
      '',
      'Why 1-2%?',
      '• Protects capital during losing streaks',
      '• 10 losses in a row = Only 10-20% drawdown',
      '• Allows strategy to perform over time',
    ]
  }
];

export function IntermediateSidebar() {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  return (
    <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2">
      <div className="bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 rounded-lg border border-cyan-500/30 p-4">
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          Intermediate Trading Skills
        </h3>
        <p className="text-xs text-slate-400">
          Master multi-timeframe analysis, pattern recognition, and professional risk management
        </p>
      </div>

      {INTERMEDIATE_LESSONS.map((lesson, index) => (
        <div key={index} className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
          <Collapsible open={expandedSection === index} onOpenChange={() => setExpandedSection(expandedSection === index ? null : index)}>
            <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors">
              <div className="flex items-center gap-2">
                <lesson.icon className={`w-4 h-4 ${lesson.color}`} />
                <span className="text-sm font-semibold text-slate-200">{lesson.title}</span>
              </div>
              {expandedSection === index ?
                <ChevronDown className="w-4 h-4 text-slate-400" /> :
                <ChevronRight className="w-4 h-4 text-slate-400" />
              }
            </CollapsibleTrigger>

            <CollapsibleContent>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-4 pb-4 pt-2"
              >
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-600">
                  {lesson.content.map((line, lineIndex) => {
                    if (line === '') {
                      return <div key={lineIndex} className="h-2" />;
                    }

                    // Detect headers (lines starting with emoji or all caps)
                    const isHeader = /^[📊📈🌍💰🔥⚠️]/.test(line) || /^[A-Z\s&():]+$/.test(line);
                    const isBullet = line.startsWith('•') || line.startsWith('→');

                    if (isHeader) {
                      return (
                        <div key={lineIndex} className="text-xs font-bold text-white mt-3 mb-1 first:mt-0">
                          {line}
                        </div>
                      );
                    }

                    if (isBullet) {
                      return (
                        <div key={lineIndex} className="text-xs text-slate-300 leading-relaxed ml-2">
                          {line}
                        </div>
                      );
                    }

                    return (
                      <div key={lineIndex} className="text-xs text-slate-400 leading-relaxed">
                        {line}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ))}

      {/* Pro Tip */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 rounded-lg border border-emerald-500/30 p-4">
        <div className="flex items-start gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-emerald-400 mb-1">Pro Tip</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Start with TWO timeframes (4H + 1H), then add complexity. Consistency beats switching strategies!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

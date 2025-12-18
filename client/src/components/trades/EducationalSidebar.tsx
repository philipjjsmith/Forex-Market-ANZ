import { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface GlossaryTerm {
  term: string;
  definition: string;
  example?: string;
}

const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: 'Sharpe Ratio',
    definition: 'Measures risk-adjusted returns. Higher is better. Shows how much return you get per unit of risk taken.',
    example: '>2.0 is excellent, 1.0-2.0 is good, <1.0 needs improvement'
  },
  {
    term: 'Sortino Ratio',
    definition: 'Similar to Sharpe but only considers downside volatility. Better indicator since upside volatility is good.',
    example: '>3.0 is exceptional, 2.0-3.0 is excellent'
  },
  {
    term: 'Profit Factor',
    definition: 'Total winning trades divided by total losing trades. Must be >1.0 to be profitable.',
    example: '>2.0 is excellent, 1.5-2.0 is good, <1.0 is losing'
  },
  {
    term: 'MAE (Maximum Adverse Excursion)',
    definition: 'The worst point your trade went against you before closing. Helps identify if stops are too tight.',
    example: 'If MAE is 80% of your stop distance, entry timing needs work'
  },
  {
    term: 'MFE (Maximum Favorable Excursion)',
    definition: 'The best profit point reached during the trade. High MFE with low final profit means you gave back gains.',
    example: 'MFE/MAE ratio >3.0 shows good profit capture'
  },
  {
    term: 'Slippage',
    definition: 'Difference between expected and actual fill price. Positive = worse price, negative = better price.',
    example: '<0.5 pips total slippage is excellent'
  },
  {
    term: 'R-Multiple',
    definition: 'Actual profit divided by initial risk. A 2R trade means you made 2x your risk.',
    example: 'Risked 10 pips, made 30 pips = 3R trade'
  },
  {
    term: 'Expectancy',
    definition: 'Average amount you expect to make per trade. Must be positive to be profitable long-term.',
    example: '>10 pips expectancy is excellent'
  }
];

const MINI_LESSONS = [
  {
    title: 'Understanding Risk-Adjusted Returns',
    content: 'Sharpe and Sortino ratios measure how efficiently you generate returns relative to risk. A high win rate with huge drawdowns might have a low Sharpe ratio, while consistent smaller wins have a high ratio. This is why professional traders focus on risk-adjusted metrics, not just total profit.'
  },
  {
    title: 'Reading Execution Quality',
    content: 'Execution quality affects every trade. Even a great strategy fails with poor execution. Watch for: 1) Slippage under 0.5 pips, 2) Fill latency under 200ms, 3) MAE staying below 50% of stop distance. Grade A execution can turn a B strategy into consistent profits.'
  },
  {
    title: 'Trading Sessions Matter',
    content: 'Each session has unique characteristics. Asian: lower volatility, range-bound. London: high volatility, strong trends. NY: USD pairs dominate. Overlap (12-16 UTC): highest liquidity. Your strategy might work great in London but fail in Asia. Track session-specific performance.'
  }
];

export function EducationalSidebar({ mode = 'beginner' }: { mode?: 'beginner' | 'professional' }) {
  const [openGlossary, setOpenGlossary] = useState(false);
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);

  if (mode === 'professional') {
    return null; // Hide in professional mode
  }

  return (
    <div className="space-y-4">
      {/* Glossary Section */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg border border-white/10 overflow-hidden">
        <Collapsible open={openGlossary} onOpenChange={setOpenGlossary}>
          <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-semibold text-gray-200">Trading Glossary</span>
            </div>
            {openGlossary ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-4 pb-4 space-y-2">
              {GLOSSARY_TERMS.map((item) => (
                <div key={item.term} className="border-b border-white/5 pb-2">
                  <button
                    onClick={() => setExpandedTerm(expandedTerm === item.term ? null : item.term)}
                    className="w-full text-left flex items-start gap-2 hover:bg-white/5 rounded p-2 transition-colors"
                  >
                    <HelpCircle className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-200">{item.term}</span>
                      <AnimatePresence>
                        {expandedTerm === item.term && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                              {item.definition}
                            </p>
                            {item.example && (
                              <p className="text-xs text-blue-400 mt-1 italic">
                                Example: {item.example}
                              </p>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Mini Lessons */}
      <div className="bg-white/5 dark:bg-black/20 rounded-lg border border-white/10 p-4">
        <h4 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-purple-400" />
          Quick Lessons
        </h4>
        <div className="space-y-2">
          {MINI_LESSONS.map((lesson, index) => (
            <div key={index} className="border-b border-white/5 pb-2 last:border-0">
              <button
                onClick={() => setExpandedLesson(expandedLesson === index ? null : index)}
                className="w-full text-left hover:bg-white/5 rounded p-2 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-200">{lesson.title}</span>
                  {expandedLesson === index ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                </div>
                <AnimatePresence>
                  {expandedLesson === index && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="text-xs text-gray-400 mt-2 leading-relaxed overflow-hidden"
                    >
                      {lesson.content}
                    </motion.p>
                  )}
                </AnimatePresence>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

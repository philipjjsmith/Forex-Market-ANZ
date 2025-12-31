import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, Target, BarChart2, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface LessonSection {
  title: string;
  icon: any;
  content: string[];
  color: string;
}

const PROFESSIONAL_LESSONS: LessonSection[] = [
  {
    title: 'Smart Money Concepts (ICT)',
    icon: Building2,
    color: 'text-blue-400',
    content: [
      '🏦 How Institutions Move Markets',
      '',
      'SMART MONEY = Banks, Hedge Funds, Institutions',
      'They control 90%+ of forex volume',
      '',
      'Key Concepts (ICT Methodology):',
      '',
      'ORDER BLOCKS',
      '• Last bullish/bearish candle before major move',
      '• Where institutions placed large orders',
      '• Price often returns to "mitigate" these zones',
      '• Entry: Wait for price to retest order block',
      '',
      'FAIR VALUE GAPS (FVG)',
      '• Gaps left when price moves too fast',
      '• Market often retraces to "fill the gap"',
      '• Entry opportunity when price returns to FVG',
      '',
      'LIQUIDITY ZONES',
      '• Equal highs/lows = Liquidity traps',
      '• Stop losses cluster at obvious levels',
      '• Institutions "hunt liquidity" before reversing',
      '• Don\'t place stops at obvious levels!',
      '',
      'KILLZONES (High Probability Windows):',
      'London: 2AM-5AM EST',
      'New York: 7AM-10AM EST',
      '→ When institutions make their moves',
      '',
      '2025 Update: More prop firms require ICT knowledge',
    ]
  },
  {
    title: 'Order Blocks & Liquidity',
    icon: Target,
    color: 'text-emerald-400',
    content: [
      '📍 Institutional Footprints',
      '',
      'ORDER BLOCKS vs LIQUIDITY ZONES',
      '',
      'Order Blocks:',
      '• Laser-focused (single candle wide)',
      '• Specific price where institutions traded',
      '• Identified by: liquidity sweeps, imbalances',
      '• Works across Forex, Crypto, Indices, Stocks',
      '',
      'Liquidity Zones:',
      '• Broader market trends',
      '• Support/Resistance clusters',
      '• Where retail stop losses accumulate',
      '',
      'How to Trade Order Blocks:',
      '',
      '1. Identify the Setup',
      '   → Strong move (50+ pips in 1-2 candles)',
      '   → Last opposite candle before move = Order Block',
      '',
      '2. Wait for Retest',
      '   → Price returns to order block zone',
      '   → Enter on touch with tight stop (5-10 pips)',
      '',
      '3. Confirmation Signals',
      '   → Volume spike on retest',
      '   → Candlestick reversal pattern (pin bar, engulfing)',
      '   → Higher timeframe alignment',
      '',
      'Risk/Reward: Often 1:5+ (tight stop, big target)',
    ]
  },
  {
    title: 'Backtesting Metrics Deep Dive',
    icon: BarChart2,
    color: 'text-purple-400',
    content: [
      '📊 Beyond Win Rate: What REALLY Matters',
      '',
      'WIN RATE (Misleading Alone!)',
      '• 90% win rate can LOSE money if losses &gt; wins',
      '• 40% win rate can WIN money with 1:3 R/R',
      '',
      'PROFIT FACTOR (Most Important)',
      'Formula: Gross Profit / Gross Loss',
      '• PF &lt; 1.0 = Losing strategy',
      '• PF 1.5-2.0 = Good strategy',
      '• PF &gt; 2.0 = Excellent strategy',
      '• PF &gt; 4.0 = Likely curve-fitted (beware!)',
      '',
      'Why PF &gt; Win Rate:',
      'Shows efficiency of profits vs losses',
      'Directly measures profitability',
      '',
      'EXPECTANCY ($ Per Trade)',
      'Formula: (Win% × Avg Win) - (Loss% × Avg Loss)',
      '• Must be POSITIVE long-term',
      '• &gt;10 pips = Excellent',
      '• Tells you average expected profit',
      '',
      'SHARPE RATIO (Risk-Adjusted Return)',
      '• &gt;2.0 = Excellent',
      '• 1.0-2.0 = Good',
      '• &lt;1.0 = Needs improvement',
      '• Measures return per unit of risk taken',
      '',
      'SORTINO RATIO (Better than Sharpe)',
      '• Only considers DOWNSIDE volatility',
      '• Upside volatility is good, so ignore it',
      '• &gt;3.0 = Exceptional',
      '• &gt;2.0 = Excellent',
      '',
      'Pro Tip:',
      'Evaluate Profit Factor FIRST (&gt;1.5)',
      'Then check Expectancy (&gt;0)',
      'Win Rate is last priority',
    ]
  },
  {
    title: 'Trading Psychology & Discipline',
    icon: Brain,
    color: 'text-amber-400',
    content: [
      '🧠 Psychology = 80% of Trading Success',
      '',
      'RISK MANAGEMENT PSYCHOLOGY',
      '',
      '1% Rule Psychology:',
      '• 10 losses in a row = Only 10% drawdown',
      '• Keeps you in the game mentally',
      '• Prevents revenge trading after losses',
      '',
      'Overconfidence Trap:',
      '• Winning streak → Increase position size',
      '• One big loss wipes out 10 wins',
      '• ALWAYS stick to 1-2% risk',
      '',
      'EMOTIONAL DISCIPLINE',
      '',
      'Fear & Greed Cycle:',
      'Fear → Miss entries → FOMO → Chase price → Loss',
      'Greed → Hold winners too long → Give back gains',
      '',
      'Solution: Rules-Based Trading',
      '• Entry rules (no discretion)',
      '• Exit rules (take profit at TP, not emotion)',
      '• Risk rules (1-2% always)',
      '',
      'POSITION SIZING DISCIPLINE',
      '',
      'Fixed % vs Fixed $ Amount:',
      '✅ Fixed %: Grows with account, shrinks with losses',
      '❌ Fixed $: Can blow account during drawdowns',
      '',
      'Psychology of Stop Losses:',
      '• Moving stops = Breaking rules = Losses',
      '• Institutions HUNT retail stops at obvious levels',
      '• Use ATR-based stops, not round numbers',
      '',
      'Pro Mindset:',
      '"I\'m not predicting the market,',
      ' I\'m executing a statistical edge',
      ' with proper risk management."',
      '',
      'Trading is 20% strategy, 80% psychology',
      'Master your mind, master the markets',
    ]
  }
];

export function ProfessionalSidebar() {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  return (
    <div className="space-y-4 max-h-[800px] overflow-y-auto pr-2">
      <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-lg border border-blue-500/30 p-4">
        <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-400" />
          Professional Trading Mastery
        </h3>
        <p className="text-xs text-slate-400">
          Institutional concepts, advanced metrics, and the psychology that separates pros from amateurs
        </p>
      </div>

      {PROFESSIONAL_LESSONS.map((lesson, index) => (
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
                    const isHeader = /^[🏦📍📊🧠✅❌]/.test(line) || /^[A-Z\s&():]+$/.test(line);
                    const isBullet = line.startsWith('•') || line.startsWith('→');
                    const isNumbered = /^\d+\./.test(line);

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

                    if (isNumbered) {
                      return (
                        <div key={lineIndex} className="text-xs font-semibold text-emerald-400 leading-relaxed mt-2">
                          {line}
                        </div>
                      );
                    }

                    // Special formatting for formulas
                    if (line.includes('Formula:') || line.includes('=')) {
                      return (
                        <div key={lineIndex} className="text-xs font-mono text-cyan-400 leading-relaxed bg-slate-800/50 p-1 rounded">
                          {line}
                        </div>
                      );
                    }

                    // Quotes
                    if (line.startsWith('"')) {
                      return (
                        <div key={lineIndex} className="text-xs italic text-purple-300 leading-relaxed ml-2">
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
      <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-lg border border-purple-500/30 p-4">
        <div className="flex items-start gap-2">
          <Brain className="w-4 h-4 text-purple-400 mt-0.5" />
          <div>
            <div className="text-xs font-bold text-purple-400 mb-1">Elite Trader Mindset</div>
            <p className="text-xs text-slate-300 leading-relaxed">
              The difference between a good trader and a funded trader isn't strategy—it's discipline, psychology, and understanding institutional behavior.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

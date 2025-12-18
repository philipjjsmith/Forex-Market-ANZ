import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Trophy, TrendingUp } from 'lucide-react';

interface PerformanceScoreCardProps {
  grade: string; // A+, A, A-, B+, B, etc.
  score: number; // 0-100
  tier: 'HIGH' | 'MEDIUM';
  confidence: number; // 70-100
}

export function PerformanceScoreCard({ grade, score, tier, confidence }: PerformanceScoreCardProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    // Animate score counter from 0 to actual score
    let start = 0;
    const duration = 1000; // 1 second
    const increment = score / (duration / 16); // 60fps

    const timer = setInterval(() => {
      start += increment;
      if (start >= score) {
        setAnimatedScore(score);
        clearInterval(timer);
      } else {
        setAnimatedScore(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [score]);

  // Color scheme based on grade
  const gradeColors = {
    'A+': 'from-green-500 to-emerald-600',
    'A': 'from-green-500 to-emerald-600',
    'A-': 'from-green-400 to-emerald-500',
    'B+': 'from-lime-500 to-green-600',
    'B': 'from-lime-500 to-green-600',
    'B-': 'from-lime-400 to-green-500',
    'C+': 'from-yellow-500 to-amber-600',
    'C': 'from-yellow-500 to-amber-600',
    'C-': 'from-yellow-400 to-amber-500',
    'D+': 'from-orange-500 to-red-600',
    'D': 'from-orange-500 to-red-600',
    'F': 'from-red-500 to-red-700'
  };

  const gradeColor = gradeColors[grade as keyof typeof gradeColors] || 'from-gray-500 to-gray-600';

  const gradeTextColor = {
    'A+': 'text-green-500',
    'A': 'text-green-500',
    'A-': 'text-green-400',
    'B+': 'text-lime-500',
    'B': 'text-lime-500',
    'B-': 'text-lime-400',
    'C+': 'text-yellow-500',
    'C': 'text-yellow-500',
    'C-': 'text-yellow-400',
    'D+': 'text-orange-500',
    'D': 'text-orange-500',
    'F': 'text-red-500'
  };

  const textColor = gradeTextColor[grade as keyof typeof gradeTextColor] || 'text-gray-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative backdrop-blur-md bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 rounded-xl p-6 shadow-2xl overflow-hidden"
    >
      {/* Background gradient overlay */}
      <div className={`absolute inset-0 bg-gradient-to-br ${gradeColor} opacity-5`} />

      <div className="relative z-10 flex items-center justify-between">
        {/* Left side: Grade display */}
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center">
            <Trophy className={`w-6 h-6 ${textColor} mb-2`} />
            <div className={`text-6xl font-bold ${textColor} leading-none`}>
              {grade}
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 mt-2 uppercase tracking-wider">
              Execution Grade
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-white dark:text-gray-100">
                {animatedScore}
              </span>
              <span className="text-xl text-gray-400 dark:text-gray-500">/100</span>
            </div>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              Quality Score
            </span>

            {/* Progress bar */}
            <div className="mt-3 w-48 bg-gray-700/50 dark:bg-gray-800/50 rounded-full h-2.5 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={`h-full bg-gradient-to-r ${gradeColor} rounded-full`}
              />
            </div>
          </div>
        </div>

        {/* Right side: Tier badge */}
        <div className="flex flex-col items-end gap-2">
          <div className={`px-6 py-3 rounded-full ${
            tier === 'HIGH'
              ? 'bg-gradient-to-r from-blue-500 to-purple-600'
              : 'bg-gradient-to-r from-slate-500 to-slate-600'
          } shadow-lg`}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">
                {tier === 'HIGH' ? 'LIVE TRADING' : 'PRACTICE SIGNAL'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-white/10 dark:bg-black/20 rounded-full">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((bar) => (
                <div
                  key={bar}
                  className={`w-1 rounded-sm ${
                    tier === 'HIGH' && bar <= 5
                      ? 'bg-gradient-to-t from-blue-400 to-cyan-300 h-4'
                      : tier === 'MEDIUM' && bar <= 3
                      ? 'bg-gradient-to-t from-slate-400 to-slate-300 h-3'
                      : 'bg-gray-600/30 h-2'
                  }`}
                  style={{ height: tier === 'HIGH' && bar <= 5 ? `${bar * 3}px` : tier === 'MEDIUM' && bar <= 3 ? `${bar * 2.5}px` : '6px' }}
                />
              ))}
            </div>
            <span className="text-xs font-medium text-gray-300 dark:text-gray-400">
              {confidence}%
            </span>
          </div>
        </div>
      </div>

      {/* Bottom interpretation text */}
      <div className="relative z-10 mt-4 pt-4 border-t border-white/10 dark:border-white/5">
        <p className="text-sm text-gray-300 dark:text-gray-400">
          {score >= 95 && "Outstanding execution - institutional-grade quality"}
          {score >= 90 && score < 95 && "Excellent execution - professional standard"}
          {score >= 85 && score < 90 && "Very good execution - minor improvements possible"}
          {score >= 80 && score < 85 && "Good execution - solid performance"}
          {score >= 70 && score < 80 && "Above average - some areas need attention"}
          {score >= 60 && score < 70 && "Average execution - notable room for improvement"}
          {score < 60 && "Below average - execution issues impacting performance"}
        </p>
      </div>
    </motion.div>
  );
}

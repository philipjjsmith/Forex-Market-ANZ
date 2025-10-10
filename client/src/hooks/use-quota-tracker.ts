import { useState, useEffect, useCallback } from 'react';

interface AnalysisQuota {
  count: number;
  resetDate: string; // YYYY-MM-DD in UTC
  lastAnalysis: string; // ISO timestamp
}

const STORAGE_KEY = 'analysis_quota';
const DAILY_LIMIT = 24;

export function useQuotaTracker() {
  const [remainingAnalyses, setRemainingAnalyses] = useState(DAILY_LIMIT);
  const [resetTime, setResetTime] = useState<Date | null>(null);

  // Get current UTC date string (YYYY-MM-DD)
  const getCurrentUTCDate = (): string => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  // Get next midnight UTC
  const getNextMidnightUTC = (): Date => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow;
  };

  // Load quota from localStorage
  const loadQuota = useCallback((): AnalysisQuota => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        // Initialize new quota
        const quota: AnalysisQuota = {
          count: 0,
          resetDate: getCurrentUTCDate(),
          lastAnalysis: '',
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(quota));
        return quota;
      }

      const quota: AnalysisQuota = JSON.parse(stored);
      const currentDate = getCurrentUTCDate();

      // Reset if it's a new day
      if (quota.resetDate !== currentDate) {
        const newQuota: AnalysisQuota = {
          count: 0,
          resetDate: currentDate,
          lastAnalysis: '',
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newQuota));
        return newQuota;
      }

      return quota;
    } catch (error) {
      console.error('Error loading quota:', error);
      return {
        count: 0,
        resetDate: getCurrentUTCDate(),
        lastAnalysis: '',
      };
    }
  }, []);

  // Initialize quota on mount
  useEffect(() => {
    const quota = loadQuota();
    setRemainingAnalyses(DAILY_LIMIT - quota.count);
    setResetTime(getNextMidnightUTC());

    // Check for quota reset every minute
    const interval = setInterval(() => {
      const quota = loadQuota();
      setRemainingAnalyses(DAILY_LIMIT - quota.count);
      setResetTime(getNextMidnightUTC());
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [loadQuota]);

  // Use one analysis quota
  const useAnalysis = useCallback((): boolean => {
    const quota = loadQuota();

    if (quota.count >= DAILY_LIMIT) {
      console.warn('⚠️  Daily analysis limit reached');
      return false;
    }

    const newQuota: AnalysisQuota = {
      count: quota.count + 1,
      resetDate: quota.resetDate,
      lastAnalysis: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newQuota));
    setRemainingAnalyses(DAILY_LIMIT - newQuota.count);

    console.log(`✅ Analysis used (${newQuota.count}/${DAILY_LIMIT})`);
    return true;
  }, [loadQuota]);

  // Check if user can analyze
  const canAnalyze = remainingAnalyses > 0;

  // Get time until reset
  const getTimeUntilReset = (): string => {
    if (!resetTime) return '...';

    const now = new Date();
    const diff = resetTime.getTime() - now.getTime();

    if (diff <= 0) return 'soon';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return {
    remainingAnalyses,
    canAnalyze,
    useAnalysis,
    dailyLimit: DAILY_LIMIT,
    timeUntilReset: getTimeUntilReset(),
    resetTime,
  };
}

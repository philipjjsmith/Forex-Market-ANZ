/**
 * React Query Hook: Session Performance
 * Fetches win rate and performance breakdown by trading session
 */

import { useQuery } from '@tanstack/react-query';
import type { SessionPerformance } from '@/types/enhanced-trade';

interface UseSessionPerformanceOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

export function useSessionPerformance({
  enabled = true,
  refetchInterval
}: UseSessionPerformanceOptions = {}) {
  return useQuery<SessionPerformance>({
    queryKey: ['session-performance'],
    queryFn: async () => {
      const response = await fetch('/api/signals/session-performance', {
        credentials: 'include', // Include auth cookies
      });

      if (!response.ok) {
        throw new Error('Failed to fetch session performance');
      }

      return response.json();
    },
    enabled,
    staleTime: 10 * 60 * 1000, // Consider data fresh for 10 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchInterval, // Optional auto-refetch
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

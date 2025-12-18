/**
 * React Query Hook: Strategy Statistics
 * Fetches comprehensive statistics for a specific trading strategy
 */

import { useQuery } from '@tanstack/react-query';
import type { StrategyStats } from '@/types/enhanced-trade';

interface UseStrategyStatsOptions {
  strategyName: string;
  enabled?: boolean;
}

export function useStrategyStats({ strategyName, enabled = true }: UseStrategyStatsOptions) {
  return useQuery<StrategyStats>({
    queryKey: ['strategy-stats', strategyName],
    queryFn: async () => {
      const response = await fetch(`/api/signals/strategy-stats/${encodeURIComponent(strategyName)}`, {
        credentials: 'include', // Include auth cookies
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Strategy not found or no trades available');
        }
        throw new Error('Failed to fetch strategy statistics');
      }

      return response.json();
    },
    enabled: enabled && !!strategyName,
    staleTime: 15 * 60 * 1000, // Consider data fresh for 15 minutes (stats change slowly)
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

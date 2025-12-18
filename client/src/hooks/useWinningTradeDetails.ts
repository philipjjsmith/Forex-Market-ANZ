/**
 * React Query Hook: Winning Trade Details
 * Fetches comprehensive trade analysis including MAE/MFE, execution quality, news events
 */

import { useQuery } from '@tanstack/react-query';
import type { EnhancedTrade } from '@/types/enhanced-trade';

interface UseWinningTradeDetailsOptions {
  signalId: string;
  enabled?: boolean;
}

export function useWinningTradeDetails({ signalId, enabled = true }: UseWinningTradeDetailsOptions) {
  return useQuery<EnhancedTrade>({
    queryKey: ['winning-trade-details', signalId],
    queryFn: async () => {
      const response = await fetch(`/api/signals/winning-trade-details/${signalId}`, {
        credentials: 'include', // Include auth cookies
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Trade not found');
        }
        throw new Error('Failed to fetch trade details');
      }

      return response.json();
    },
    enabled: enabled && !!signalId,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 2, // Retry failed requests twice
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
  });
}

/**
 * Prefetch trade details for better UX
 * Call this when user hovers over a trade card
 */
export function usePrefetchWinningTradeDetails() {
  const queryClient = useQueryClient();

  return (signalId: string) => {
    queryClient.prefetchQuery({
      queryKey: ['winning-trade-details', signalId],
      queryFn: async () => {
        const response = await fetch(`/api/signals/winning-trade-details/${signalId}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to prefetch trade details');
        }

        return response.json();
      },
      staleTime: 5 * 60 * 1000,
    });
  };
}

// Re-export for convenience
import { useQueryClient } from '@tanstack/react-query';

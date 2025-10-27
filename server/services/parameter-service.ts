import { db } from '../db';
import { sql } from 'drizzle-orm';

/**
 * Parameter Service
 * Fetches approved strategy parameters for symbols
 * Milestone 3C: Recommendation Approval System
 */

export interface StrategyParams {
  fastMA: number;
  slowMA: number;
  atrMultiplier: number;
  version: string;
}

class ParameterService {
  private cache: Map<string, { params: StrategyParams | null; timestamp: number }> = new Map();
  private CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get approved parameters for a symbol
   * Returns null if no approved recommendations exist (use defaults)
   */
  async getApprovedParameters(symbol: string): Promise<StrategyParams | null> {
    // Check cache first
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.params;
    }

    try {
      // Query most recent approved recommendation for this symbol
      const result = await db.execute(sql`
        SELECT
          suggested_changes,
          new_strategy_version
        FROM strategy_adaptations
        WHERE symbol = ${symbol}
          AND status = 'approved'
          AND applied_at IS NOT NULL
        ORDER BY applied_at DESC
        LIMIT 1
      `);

      if (!result || (result as any[]).length === 0) {
        // No approved parameters, use defaults
        this.cache.set(symbol, { params: null, timestamp: Date.now() });
        return null;
      }

      const rec = (result as any[])[0];
      const changes = rec.suggested_changes;

      const params: StrategyParams = {
        fastMA: changes.fastMA_period?.to || 20,
        slowMA: changes.slowMA_period?.to || 50,
        atrMultiplier: changes.atr_multiplier?.to || 2.0,
        version: rec.new_strategy_version || '1.0.0',
      };

      // Cache the result
      this.cache.set(symbol, { params, timestamp: Date.now() });

      return params;
    } catch (error) {
      console.error(`❌ Error fetching approved parameters for ${symbol}:`, error);
      return null; // Fall back to defaults on error
    }
  }

  /**
   * Clear cache for a symbol (call after approve/rollback)
   */
  clearCache(symbol?: string): void {
    if (symbol) {
      this.cache.delete(symbol);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get default parameters
   */
  getDefaultParameters(): StrategyParams {
    return {
      fastMA: 20,
      slowMA: 50,
      atrMultiplier: 2.0,
      version: '1.0.0',
    };
  }
}

// Export singleton instance
export const parameterService = new ParameterService();

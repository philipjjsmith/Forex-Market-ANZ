/**
 * Twelve Data API Service
 * Fetches real historical forex candle data
 *
 * v2.0.0: Uses file-based persistent cache (node-persist)
 * - Cache survives server restarts and deployments
 * - Reduces API usage from ~550/day to ~280/day
 * - Stores cache in .node-persist directory
 */

import nodePersist from 'node-persist';

// Create dedicated storage instance for Twelve Data
const storage = nodePersist.create();

interface UsageStats {
  date: string;        // Format: 'YYYY-MM-DD'
  callsToday: number;
  creditsUsed: number; // Track actual credits (some calls cost more)
}

interface TwelveDataCandle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CacheEntry {
  candles: Candle[];
  timestamp: number;
}

export class TwelveDataAPI {
  private baseUrl: string;
  private apiKey: string;
  private cacheInitialized: Promise<void>;
  private lastApiCallTime: number = 0;
  private readonly API_CALL_DELAY_MS = 8000; // 8 seconds between calls (free tier: 8/min)

  constructor() {
    this.baseUrl = 'https://api.twelvedata.com';
    this.apiKey = process.env.TWELVE_DATA_KEY || '';

    // Initialize persistent storage (survives server restarts)
    this.cacheInitialized = storage.init({
      dir: '.node-persist/twelve-data',
      stringify: JSON.stringify,
      parse: JSON.parse,
      encoding: 'utf8',
      logging: false,
      ttl: false, // We handle TTL manually for fine-grained control
      expiredInterval: 2 * 60 * 1000, // Clean up expired items every 2 minutes
      forgiveParseErrors: true
    }).then(() => {
      console.log('💾 Twelve Data file-based cache initialized');
    });

    // Initialize daily usage counter
    this.resetDailyUsageIfNeeded().catch(console.error);

    if (!this.apiKey) {
      console.warn('⚠️  TWELVE_DATA_KEY not set in environment variables');
    }
  }

  /**
   * Get cache TTL based on timeframe interval
   * Higher timeframes change less frequently, so cache longer
   * This reduces API calls dramatically while keeping data fresh
   *
   * @param interval - Timeframe interval (e.g., "1week", "1day", "4h", "1h", "5min")
   * @returns Cache TTL in milliseconds
   */
  private getCacheTTL(interval: string): number {
    // Weekly candles update once per week - cache for 6 hours
    if (interval === '1week' || interval === '1w') {
      return 6 * 60 * 60 * 1000; // 6 hours
    }

    // Daily candles update once per day - cache for 4 hours
    if (interval === '1day' || interval === '1d') {
      return 4 * 60 * 60 * 1000; // 4 hours
    }

    // 4-hour candles update every 4 hours - cache for 2 hours
    if (interval === '4h') {
      return 2 * 60 * 60 * 1000; // 2 hours
    }

    // 1-hour candles update every hour - cache for 30 minutes
    if (interval === '1h') {
      return 30 * 60 * 1000; // 30 minutes
    }

    // Lower timeframes (5min, 15min, 30min) - cache for 15 minutes
    return 15 * 60 * 1000; // 15 minutes (default)
  }

  /**
   * Reset daily usage counter if it's a new day (UTC)
   */
  private async resetDailyUsageIfNeeded(): Promise<void> {
    await this.cacheInitialized;

    const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'
    const usage = await storage.getItem('daily-usage') as UsageStats | undefined;

    // Reset if new day (UTC)
    if (!usage || usage.date !== today) {
      await storage.setItem('daily-usage', {
        date: today,
        callsToday: 0,
        creditsUsed: 0
      });
      console.log(`📊 Reset Twelve Data usage counter (new day: ${today})`);
    }
  }

  /**
   * Increment usage counter after each API call
   */
  private async incrementUsageCounter(): Promise<void> {
    await this.cacheInitialized;
    await this.resetDailyUsageIfNeeded();

    const usage = await storage.getItem('daily-usage') as UsageStats;
    usage.callsToday += 1;
    usage.creditsUsed += 1; // Each time_series call = 1 credit

    await storage.setItem('daily-usage', usage);

    // Warning if approaching limit
    if (usage.callsToday >= 750) {
      console.warn(`⚠️  Twelve Data usage: ${usage.callsToday}/800 (${800 - usage.callsToday} remaining)`);
    }
  }

  /**
   * Get current usage statistics
   */
  async getUsageStats(): Promise<{ callsToday: number; limit: number }> {
    await this.cacheInitialized;
    await this.resetDailyUsageIfNeeded();

    const usage = await storage.getItem('daily-usage') as UsageStats;
    return {
      callsToday: usage?.callsToday || 0,
      limit: 800
    };
  }

  /**
   * Fetch historical candles for a forex pair
   * @param symbol - Forex pair (e.g., "EUR/USD")
   * @param interval - Candle interval (e.g., "5min", "15min", "1h")
   * @param outputsize - Number of candles to return (max 5000)
   */
  async fetchHistoricalCandles(
    symbol: string,
    interval: string = '5min',
    outputsize: number = 1440
  ): Promise<Candle[]> {
    // Ensure cache is initialized before using it
    await this.cacheInitialized;

    const cacheKey = `${symbol}-${interval}`;

    // Get interval-specific cache TTL (longer for higher timeframes)
    const cacheTTL = this.getCacheTTL(interval);

    // Check persistent cache first
    const cached = await storage.getItem(cacheKey) as CacheEntry | undefined;
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
      console.log(`✅ Cache hit for ${cacheKey} (age: ${cacheAgeMinutes}min, TTL: ${Math.round(cacheTTL / (60 * 1000))}min)`);

      // Deserialize Date objects from JSON
      const candles = cached.candles.map(c => ({
        ...c,
        timestamp: new Date(c.timestamp)
      }));
      return candles;
    }

    try {
      console.log(`🌐 Fetching ${outputsize} ${interval} candles for ${symbol} from Twelve Data...`);

      // Global rate limiter — enforces 8s between ALL API calls regardless of caller
      const timeSinceLastCall = Date.now() - this.lastApiCallTime;
      if (this.lastApiCallTime > 0 && timeSinceLastCall < this.API_CALL_DELAY_MS) {
        const waitMs = this.API_CALL_DELAY_MS - timeSinceLastCall;
        console.log(`⏳ Rate limiting: waiting ${waitMs}ms before Twelve Data API call...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      this.lastApiCallTime = Date.now();

      const url = `${this.baseUrl}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${this.apiKey}`;

      const response = await fetch(url);

      // Handle HTTP-level 429 before the generic !response.ok check — enables stale cache fallback
      if (response.status === 429) {
        console.warn(`⚠️  HTTP 429 rate limit for ${symbol}. Attempting stale cache...`);
        if (cached && cached.candles.length > 0) {
          const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
          console.log(`✅ Using stale cache for ${cacheKey} (age: ${cacheAgeMinutes}min) due to HTTP 429`);
          return cached.candles.map(c => ({ ...c, timestamp: new Date(c.timestamp) }));
        }
        throw new Error(`HTTP 429 rate limit and no cached data available for ${symbol}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.status === 'error') {
        if (data.message?.includes('API key')) {
          throw new Error('Invalid Twelve Data API key');
        }
        if (data.message?.includes('limit')) {
          // JSON-level rate limit — try stale cache
          console.warn(`⚠️  API rate limit reached for ${symbol}. Attempting to use cached data...`);

          if (cached && cached.candles.length > 0) {
            const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
            console.log(`✅ Using stale cache for ${cacheKey} (age: ${cacheAgeMinutes}min) due to rate limit`);
            return cached.candles.map(c => ({ ...c, timestamp: new Date(c.timestamp) }));
          } else {
            // No cache available at all
            throw new Error(`API rate limit reached (800/day) and no cached data available for ${symbol}`);
          }
        }
        throw new Error(data.message || 'API error occurred');
      }

      if (!data.values || !Array.isArray(data.values)) {
        throw new Error('Invalid response from Twelve Data');
      }

      // Convert to our candle format (Twelve Data returns newest first, so reverse)
      const candles: Candle[] = data.values
        .map((item: TwelveDataCandle) => ({
          timestamp: new Date(item.datetime),
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: item.volume ? parseFloat(item.volume) : 1000,
        }))
        .reverse(); // Oldest first for strategy analysis

      // Track API usage
      await this.incrementUsageCounter();

      // Store in persistent file-based cache
      await storage.setItem(cacheKey, {
        candles,
        timestamp: Date.now(),
      });

      console.log(`✅ Fetched ${candles.length} real candles for ${symbol} (saved to persistent cache)`);
      return candles;

    } catch (error) {
      console.error(`❌ Error fetching historical candles for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Fetch candles for all major forex pairs
   */
  async fetchAllPairs(interval: string = '5min', outputsize: number = 1440): Promise<Map<string, Candle[]>> {
    const pairs = ['EUR/USD', 'USD/CHF']; // Optimized: EUR/USD (60% WR) + USD/CHF (25% WR) - based on historical performance
    const candlesMap = new Map<string, Candle[]>();

    for (const pair of pairs) {
      try {
        const candles = await this.fetchHistoricalCandles(pair, interval, outputsize);
        candlesMap.set(pair, candles);

        // Rate limiting - Twelve Data free tier: 8 calls/minute
        await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds between calls
      } catch (error) {
        console.error(`❌ Failed to fetch ${pair}:`, error);
      }
    }

    return candlesMap;
  }

  /**
   * Clear persistent cache
   */
  async clearCache() {
    await this.cacheInitialized;
    await storage.clear();
    console.log('🗑️  Twelve Data persistent cache cleared');
  }

  /**
   * Get cache statistics from persistent storage
   */
  async getCacheStats() {
    await this.cacheInitialized;

    const keys = await storage.keys();
    const entries = [];

    for (const key of keys) {
      const entry = await storage.getItem(key) as CacheEntry | undefined;
      if (entry) {
        entries.push({
          pair: key,
          candleCount: entry.candles.length,
          age: Math.round((Date.now() - entry.timestamp) / 1000),
        });
      }
    }

    return {
      size: keys.length,
      entries,
    };
  }
}

// Export singleton instance
export const twelveDataAPI = new TwelveDataAPI();

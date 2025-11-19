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

      const url = `${this.baseUrl}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${this.apiKey}`;

      const response = await fetch(url);

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
          // Rate limit hit - try to use cached data even if expired
          console.warn(`⚠️  API rate limit reached for ${symbol}. Attempting to use cached data...`);

          if (cached && cached.candles.length > 0) {
            const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
            console.log(`✅ Using stale cache for ${cacheKey} (age: ${cacheAgeMinutes}min) due to rate limit`);

            // Return stale cache data
            const candles = cached.candles.map(c => ({
              ...c,
              timestamp: new Date(c.timestamp)
            }));
            return candles;
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
    const pairs = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'];
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

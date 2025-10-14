import { Request, Response } from 'express';

interface ForexQuote {
  symbol: string;
  fromCurrency: string;
  toCurrency: string;
  exchangeRate: number;
  bidPrice: number;
  askPrice: number;
  lastRefreshed: string;
  timezone: string;
}

interface CacheEntry {
  data: ForexQuote;
  timestamp: number;
}

export class ExchangeRateAPI {
  private baseUrl: string;
  private apiKey: string;
  private cache: Map<string, CacheEntry>;
  private cacheTTL: number; // 15 minutes in milliseconds

  constructor() {
    this.baseUrl = 'https://v6.exchangerate-api.com/v6';
    this.apiKey = process.env.FOREX_API_KEY || '';
    this.cache = new Map();
    this.cacheTTL = 15 * 60 * 1000; // 15 minutes - optimized for free API tier

    if (!this.apiKey) {
      console.warn('⚠️  FOREX_API_KEY not set in environment variables');
    }
  }

  /**
   * Fetch forex quote from ExchangeRate-API or cache
   */
  private async fetchQuote(fromCurrency: string, toCurrency: string): Promise<ForexQuote> {
    const cacheKey = `${fromCurrency}/${toCurrency}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`✅ Cache hit for ${cacheKey}`);
      return cached.data;
    }

    // Fetch from API - ExchangeRate-API format: /v6/{api_key}/pair/{from}/{to}
    const url = `${this.baseUrl}/${this.apiKey}/pair/${fromCurrency}/${toCurrency}`;

    try {
      console.log(`🌐 Fetching ${cacheKey} from ExchangeRate-API...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.result === 'error') {
        if (data['error-type'] === 'quota-reached') {
          throw new Error('⏳ Monthly API limit reached (1,500 requests). Data updates every 15 minutes via cache. Please try again in a few minutes.');
        }
        throw new Error(data['error-type'] || 'API error occurred');
      }

      if (data.result !== 'success') {
        throw new Error('Invalid API response');
      }

      // ExchangeRate-API provides conversion rate
      // We'll simulate bid/ask spread (typical forex spread is ~0.0001 or 1 pip)
      const rate = data.conversion_rate;
      const spread = rate * 0.0001; // 1 pip spread
      const bidPrice = rate - spread / 2;
      const askPrice = rate + spread / 2;

      const quote: ForexQuote = {
        symbol: `${fromCurrency}/${toCurrency}`,
        fromCurrency: fromCurrency,
        toCurrency: toCurrency,
        exchangeRate: rate,
        bidPrice: bidPrice,
        askPrice: askPrice,
        lastRefreshed: new Date(data.time_last_update_unix * 1000).toISOString(),
        timezone: 'UTC',
      };

      // Store in cache
      this.cache.set(cacheKey, {
        data: quote,
        timestamp: Date.now(),
      });

      console.log(`✅ Fetched ${cacheKey}: ${quote.exchangeRate}`);
      return quote;
    } catch (error) {
      console.error(`❌ Error fetching ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Fetch all forex pairs (5 API calls or use cache)
   */
  async fetchAllQuotes(): Promise<ForexQuote[]> {
    const pairs = [
      { from: 'EUR', to: 'USD' },
      { from: 'GBP', to: 'USD' },
      { from: 'USD', to: 'JPY' },
      { from: 'AUD', to: 'USD' },
      { from: 'USD', to: 'CHF' },
    ];

    try {
      const quotes = await Promise.all(
        pairs.map(({ from, to }) => this.fetchQuote(from, to))
      );

      return quotes;
    } catch (error) {
      console.error('❌ Error fetching forex quotes:', error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        pair: key,
        age: Math.round((Date.now() - entry.timestamp) / 1000),
        rate: entry.data.exchangeRate,
      })),
    };
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️  Cache cleared');
  }
}

// Export singleton instance
export const exchangeRateAPI = new ExchangeRateAPI();

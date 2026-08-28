/**
 * v2.0.0: Uses file-based persistent cache (node-persist)
 * - Cache survives server restarts and deployments
 * - Frankfurter.app is unlimited, but caching improves performance
 */

import { Request, Response } from 'express';
import nodePersist from 'node-persist';

// Create dedicated storage instance for Forex Quotes
const storage = nodePersist.create();

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
  private cacheTTL: number; // 15 minutes in milliseconds
  private cacheInitialized: Promise<void>;

  constructor() {
    this.baseUrl = 'https://api.frankfurter.app';
    this.apiKey = ''; // Frankfurter.app doesn't require API key
    this.cacheTTL = 15 * 60 * 1000; // 15 minutes cache

    // Initialize persistent storage (survives server restarts)
    this.cacheInitialized = storage.init({
      dir: '.node-persist/forex-quotes',
      stringify: JSON.stringify,
      parse: JSON.parse,
      encoding: 'utf8',
      logging: false,
      ttl: false, // We handle TTL manually
      expiredInterval: 2 * 60 * 1000,
      forgiveParseErrors: true
    }).then(() => {
      console.log('💾 Forex quotes file-based cache initialized');
    });
  }

  /**
   * Fetch forex quote from Frankfurter.app or cache
   */
  private async fetchQuote(fromCurrency: string, toCurrency: string): Promise<ForexQuote> {
    // Ensure cache is initialized
    await this.cacheInitialized;

    const cacheKey = `${fromCurrency}/${toCurrency}`;

    // Check persistent cache first
    const cached = await storage.getItem(cacheKey) as CacheEntry | undefined;
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`✅ Cache hit for ${cacheKey}`);
      return cached.data;
    }

    // Fetch from Frankfurter.app - Format: /latest?from={from}&to={to}
    const url = `${this.baseUrl}/latest?from=${fromCurrency}&to=${toCurrency}`;

    try {
      console.log(`🌐 Fetching ${cacheKey} from Frankfurter.app...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Frankfurter.app response format: { amount: 1.0, base: "EUR", date: "2025-10-24", rates: { "USD": 1.1612 } }
      if (!data.rates || !data.rates[toCurrency]) {
        throw new Error('Invalid API response - missing rates data');
      }

      // Extract the exchange rate
      const rate = data.rates[toCurrency];

      // Simulate bid/ask spread (typical forex spread is ~0.0001 or 1 pip)
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
        lastRefreshed: `${data.date}T00:00:00.000Z`, // Frankfurter returns YYYY-MM-DD format
        timezone: 'UTC',
      };

      // Store in persistent cache
      await storage.setItem(cacheKey, {
        data: quote,
        timestamp: Date.now(),
      });

      console.log(`✅ Fetched ${cacheKey}: ${quote.exchangeRate} (saved to persistent cache)`);
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
    // Pairs re-expanded 2026-08-28 on CORRECTED evidence.
    // The previous list (EUR/USD + USD/CHF only) was chosen from the OLD validator's record,
    // which a full replay showed was wrong on 131 of 306 production rows — 37 recorded losses
    // were actually wins against only 2 the other way. Every pair elimination rested on it:
    //   USD/JPY  banned for "0% win rate" — corrected: 37.5% WR, +98.4 pips (2nd best by pips)
    //   GBP/USD  banned for "19.6% win rate" — same broken measurement
    //   EUR/USD  KEPT for a claimed "60% WR" — corrected: 30.0% WR, -187.9 pips (WORST pair)
    // The selection was exactly backwards. Nothing executes today, so more pairs simply means
    // more sample, and sample size is the binding constraint on ever proving an edge.
    // Quota checked: generation only runs in the 6h of kill zones, so ~42 calls/symbol/day.
    // 5 pairs = ~352/day against the 800/day free tier.
    const pairs = [
      { from: 'EUR', to: 'USD' },
      { from: 'USD', to: 'CHF' },
      { from: 'USD', to: 'JPY' },
      { from: 'GBP', to: 'USD' },
      { from: 'AUD', to: 'USD' },
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
          age: Math.round((Date.now() - entry.timestamp) / 1000),
          rate: entry.data.exchangeRate,
        });
      }
    }

    return {
      size: keys.length,
      entries,
    };
  }

  /**
   * Clear persistent cache (useful for testing)
   */
  async clearCache() {
    await this.cacheInitialized;
    await storage.clear();
    console.log('🗑️  Persistent cache cleared');
  }
}

// Export singleton instance
export const exchangeRateAPI = new ExchangeRateAPI();

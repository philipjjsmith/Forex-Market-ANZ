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

export class AlphaVantageAPI {
  private baseUrl: string;
  private apiKey: string;
  private cache: Map<string, CacheEntry>;
  private cacheTTL: number; // 5 minutes in milliseconds

  constructor() {
    this.baseUrl = process.env.FOREX_API_BASE_URL || 'https://www.alphavantage.co/query';
    this.apiKey = process.env.FOREX_API_KEY || '';
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes

    if (!this.apiKey) {
      console.warn('⚠️  FOREX_API_KEY not set in environment variables');
    }
  }

  /**
   * Fetch forex quote from Alpha Vantage API or cache
   */
  private async fetchQuote(fromCurrency: string, toCurrency: string): Promise<ForexQuote> {
    const cacheKey = `${fromCurrency}/${toCurrency}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`✅ Cache hit for ${cacheKey}`);
      return cached.data;
    }

    // Fetch from API
    const url = `${this.baseUrl}?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${this.apiKey}`;

    try {
      console.log(`🌐 Fetching ${cacheKey} from Alpha Vantage...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Check for API error messages
      if (data.Note) {
        throw new Error('API rate limit reached. Please try again later.');
      }

      if (data.Error) {
        throw new Error(data.Error);
      }

      if (data.Information) {
        throw new Error(data.Information);
      }

      if (!data['Realtime Currency Exchange Rate']) {
        throw new Error('Invalid API response format');
      }

      const rateData = data['Realtime Currency Exchange Rate'];
      const quote: ForexQuote = {
        symbol: `${fromCurrency}/${toCurrency}`,
        fromCurrency: rateData['1. From_Currency Code'],
        toCurrency: rateData['3. To_Currency Code'],
        exchangeRate: parseFloat(rateData['5. Exchange Rate']),
        bidPrice: parseFloat(rateData['8. Bid Price']),
        askPrice: parseFloat(rateData['9. Ask Price']),
        lastRefreshed: rateData['6. Last Refreshed'],
        timezone: rateData['7. Time Zone'],
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
export const alphaVantageAPI = new AlphaVantageAPI();

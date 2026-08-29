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

/**
 * Parse a Twelve Data `datetime` string as UTC.
 *
 * Twelve Data returns intraday timestamps as "YYYY-MM-DD HH:MM:SS" with no zone
 * designator. Per ECMA-262 that non-ISO form is parsed as LOCAL time, so on any host
 * that is not UTC every candle silently shifts by the host offset while `created_at`
 * stays true UTC — corrupting outcome validation with no error.
 *
 * Daily/weekly bars return "YYYY-MM-DD", which the spec already treats as UTC.
 */
function parseTwelveDataUTC(datetime: string): Date {
  if (typeof datetime !== 'string' || !datetime.trim()) {
    throw new Error(`Twelve Data returned an empty datetime: ${JSON.stringify(datetime)}`);
  }

  const s = datetime.trim().replace(' ', 'T');

  // Only append 'Z' when there is no zone designator already. An earlier version appended it
  // unconditionally, so a value that already carried one — "2026-06-19T07:20:00Z" or
  // "...+00:00" — became "...ZZ" and parsed as Invalid Date. That NaN then flowed into
  // outcomeTime and threw RangeError at .toISOString(), leaving the signal permanently
  // PENDING. Unreachable under Twelve Data's documented format today, which is exactly why
  // it would be missed if the API ever changed.
  const hasZone = /[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const iso = hasZone ? s : (s.length <= 10 ? `${s}T00:00:00Z` : `${s}Z`);

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unparseable Twelve Data datetime: "${datetime}" (as "${iso}")`);
  }
  return d;
}

/**
 * Is this bar timestamped inside hours when the forex market is SHUT?
 *
 * Twelve Data returns a continuous 24/7 forex series. Verified 2026-08-29 against live
 * production fetches: 28.5% of 1H bars, 28.6% of 4H and 29.0% of DAILY bars land in closed
 * hours, and NONE of them are flat — Saturday 2026-08-22 carries 288 five-minute bars spanning
 * 11.5 pips and opening exactly at Friday's close. They are not traded prices.
 *
 * Measured harm, over 1020 real kill-zone moments:
 *   - 6.3% of fire / do-not-fire decisions change once they are removed
 *   - confidence shifts by a median of 3 points
 *   - 2 of 67 recorded outcomes were STOP_HIT resolved on a Sunday: fabricated losses
 * (Trend gates proved robust — daily/4H/1H direction flipped 0 times.)
 *
 * The forex week runs Sunday ~21:00 UTC to Friday ~21:00 UTC.
 *
 * DAILY bars need no special case despite Twelve Data labelling them by the date they END:
 * a bar labelled Saturday spans Fri 21:00 -> Sat 21:00 (entirely shut) and one labelled Monday
 * spans Sun 21:00 -> Mon 21:00 (the real Monday session), so the same rule keeps the right bars.
 *
 * WEEKLY and MONTHLY are never filtered — one bar spans a whole period, so its label says
 * nothing about whether the market was open, and 1week measured 0/52 affected anyway.
 */
export function isMarketClosed(d: Date): boolean {
  const dow = d.getUTCDay();
  const h = d.getUTCHours();
  return dow === 6                     // Saturday
      || (dow === 0 && h < 21)         // Sunday before the open
      || (dow === 5 && h >= 21);       // Friday after the close
}

/** Intervals whose bars carry a meaningful open/closed timestamp. */
function isFilterableInterval(interval: string): boolean {
  return !/week|month/i.test(interval);
}

export class TwelveDataAPI {
  /** cacheKey -> how the most recent read of that key was satisfied. Used for provenance. */
  static lastFetchMeta = new Map<string, { source: 'live' | 'cache' | 'stale-cache'; ageMinutes: number; at: number }>();

  /** Provenance accessor: how was the last read of this exact series satisfied? */
  static getFetchMeta(symbol: string, interval: string, outputsize: number) {
    return TwelveDataAPI.lastFetchMeta.get(`${symbol}-${interval}-${outputsize}`) ?? null;
  }

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

    // NOTE: outputsize is part of the key on purpose. Without it the 5-minute outcome
    // validator (200 bars) and the 15-minute signal generator (1440 bars) collided on the
    // same key, so the generator silently analysed 200 candles where it asked for 1440 —
    // and the `length < 100` guard passed, so it failed silently.
    const cacheKey = `${symbol}-${interval}-${outputsize}`;

    // Provenance: record HOW this array was obtained. Cache age was previously invisible, and
    // it is the mechanism behind unreproducible signals — two signals 23h apart once carried
    // byte-identical indicators because a stale 1H snapshot was served across days.
    const recordMeta = (source: 'live' | 'cache' | 'stale-cache', ageMs: number) => {
      TwelveDataAPI.lastFetchMeta.set(cacheKey, { source, ageMinutes: Math.round(ageMs / 60000), at: Date.now() });
    };

    // Get interval-specific cache TTL (longer for higher timeframes)
    const cacheTTL = this.getCacheTTL(interval);

    // Check persistent cache first
    const cached = await storage.getItem(cacheKey) as CacheEntry | undefined;
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
      recordMeta('cache', Date.now() - cached.timestamp);
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

      // timezone=UTC is required — without it Twelve Data returns exchange-local datetimes
      // with no zone designator, which JS then parses as host-local. (Case-sensitive.)
      // Over-request, because ~28.5% of what Twelve Data returns is market-closed filler that
      // is about to be dropped. Without this the caller silently receives ~1030 real bars where
      // it asked for 1440 — and array LENGTH is load-bearing: ema() seeds from the SMA of the
      // first `period` elements and iterates the whole array, so a short array changes every
      // indicator. Costs no extra API call, only a larger payload on the same request.
      const requestSize = isFilterableInterval(interval)
        ? Math.min(5000, Math.ceil(outputsize / 0.7))
        : outputsize;
      const url = `${this.baseUrl}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${requestSize}&timezone=UTC&apikey=${this.apiKey}`;

      const response = await fetch(url);

      // Handle HTTP-level 429 before the generic !response.ok check — enables stale cache fallback
      if (response.status === 429) {
        console.warn(`⚠️  HTTP 429 rate limit for ${symbol}. Attempting stale cache...`);
        if (cached && cached.candles.length > 0) {
          const cacheAgeMinutes = Math.round((Date.now() - cached.timestamp) / (60 * 1000));
          recordMeta('stale-cache', Date.now() - cached.timestamp);
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
            recordMeta('stale-cache', Date.now() - cached.timestamp);
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
          timestamp: parseTwelveDataUTC(item.datetime),
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: item.volume ? parseFloat(item.volume) : 1000,
        }))
        .reverse(); // Oldest first for strategy analysis

      // Drop market-closed bars, then hand back exactly what the caller asked for.
      const realCandles = isFilterableInterval(interval)
        ? candles.filter(c => !isMarketClosed(c.timestamp))
        : candles;
      const trimmed = realCandles.length > outputsize
        ? realCandles.slice(realCandles.length - outputsize)
        : realCandles;
      if (isFilterableInterval(interval)) {
        const dropped = candles.length - realCandles.length;
        if (dropped > 0) {
          console.log(`🧹 ${symbol} ${interval}: dropped ${dropped} market-closed bars, returning ${trimmed.length}/${outputsize}`);
        }
      }

      // Track API usage
      await this.incrementUsageCounter();

      // Cache the FILTERED array. Caching the raw one would reintroduce the market-closed bars
      // on every subsequent cache hit, which is most reads.
      await storage.setItem(cacheKey, {
        candles: trimmed,
        timestamp: Date.now(),
      });

      recordMeta('live', 0);
      console.log(`✅ Fetched ${trimmed.length} real candles for ${symbol} (saved to persistent cache)`);
      return trimmed;

    } catch (error) {
      console.error(`❌ Error fetching historical candles for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Fetch candles for an EXACT time window, anchored by date.
   *
   * This is the correct primitive for outcome validation. `fetchHistoricalCandles` returns
   * "the most recent N bars", which is not tied to the trade at all — a trade resolved days
   * ago may not overlap the returned window whatsoever.
   *
   * Deliberately NOT cached: every call is a different window, so a cache would only grow
   * without ever being hit, and stale data here silently produces wrong outcomes.
   *
   * @param startUtc inclusive window start (the signal's created_at)
   * @param endUtc   inclusive window end (min(now, expires_at))
   * @returns candles ascending by time, or [] when the window holds no bars (weekend/gap)
   */
  async fetchCandlesInWindow(
    symbol: string,
    interval: string,
    startUtc: Date,
    endUtc: Date
  ): Promise<Candle[]> {
    // Twelve Data wants "YYYY-MM-DD HH:MM:SS"; it interprets it in the `timezone` we pass.
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

    // Global rate limiter — shared with every other caller (free tier: 8 calls/min)
    const sinceLast = Date.now() - this.lastApiCallTime;
    if (this.lastApiCallTime > 0 && sinceLast < this.API_CALL_DELAY_MS) {
      await new Promise(r => setTimeout(r, this.API_CALL_DELAY_MS - sinceLast));
    }
    this.lastApiCallTime = Date.now();

    const url =
      `${this.baseUrl}/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${interval}` +
      `&start_date=${encodeURIComponent(fmt(startUtc))}` +
      `&end_date=${encodeURIComponent(fmt(endUtc))}` +
      `&timezone=UTC&order=asc&apikey=${this.apiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Twelve Data window fetch failed for ${symbol}: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      // "no data" for an empty window is a normal answer, not a failure.
      if (/no data/i.test(data.message || '')) return [];
      throw new Error(data.message || 'Twelve Data window fetch error');
    }

    await this.incrementUsageCounter();

    if (!data.values || !Array.isArray(data.values)) return [];

    // order=asc means Twelve Data already returns oldest-first — do NOT reverse.
    //
    // Market-closed bars are dropped here too, and this is not cosmetic: the outcome validator
    // scans this series for stop/target touches, so a synthetic Saturday bar can book a
    // STOP_HIT that never happened. Measured: 2 of 67 resolved outcomes were stop-outs dated to
    // a Sunday, both losses, no fabricated wins — the same asymmetry as the validator bug fixed
    // in 5895423.
    const windowCandles = data.values.map((item: TwelveDataCandle) => ({
      timestamp: parseTwelveDataUTC(item.datetime),
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: item.volume ? parseFloat(item.volume) : 1000,
    }));

    return isFilterableInterval(interval)
      ? windowCandles.filter((c: Candle) => !isMarketClosed(c.timestamp))
      : windowCandles;
  }

  /**
   * Fetch candles for all major forex pairs
   */
  async fetchAllPairs(interval: string = '5min', outputsize: number = 1440): Promise<Map<string, Candle[]>> {
    // See exchangerate-api.ts for why this list was re-expanded on corrected evidence.
    const pairs = ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD'];
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

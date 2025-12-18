/**
 * Economic Calendar Service
 * Fetches and caches economic events from JBlanked and Myfxbook APIs
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

interface EconomicEvent {
  time: string;              // ISO 8601 timestamp
  currency: string;          // e.g., "USD", "EUR", "GBP"
  event: string;             // Event name (e.g., "Non-Farm Payrolls")
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  actual: string | null;     // Actual value released
  forecast: string | null;   // Market forecast
  previous: string | null;   // Previous value
  source: 'jblanked' | 'myfxbook' | 'demo';
  affectsSymbol?: boolean;   // Added when filtering by symbol
  timeDiff?: string;         // Added when filtering by time (e.g., "-30 minutes")
}

interface CachedEvents {
  events: EconomicEvent[];
  timestamp: number;
}

export class EconomicCalendarService {
  private cache = new Map<string, CachedEvents>();
  private lastJBlankedCall = 0;
  private readonly RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes (JBlanked limit: 1 req/5min)
  private readonly CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
  private readonly HIGH_IMPACT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for upcoming high-impact

  /**
   * Get economic events relevant to a specific trade
   * @param tradeTime When the trade was entered
   * @param symbol Trading pair (e.g., "GBPUSD")
   * @returns Events ±2 hours of trade time affecting the symbol's currencies
   */
  async getEventsForTrade(tradeTime: Date, symbol: string): Promise<EconomicEvent[]> {
    const dateKey = tradeTime.toISOString().split('T')[0]; // YYYY-MM-DD

    // Check cache first
    const cached = this.cache.get(dateKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return this.filterEventsBySymbolAndTime(cached.events, tradeTime, symbol);
    }

    // Fetch from API
    let events: EconomicEvent[] = [];

    // Try JBlanked (respect rate limit)
    if (Date.now() - this.lastJBlankedCall > this.RATE_LIMIT_MS) {
      try {
        events = await this.fetchFromJBlanked(tradeTime);
        this.lastJBlankedCall = Date.now();
      } catch (error) {
        console.warn("⚠️  JBlanked API failed, falling back to Myfxbook", error);
      }
    }

    // Fallback to Myfxbook if JBlanked failed or rate limited
    if (events.length === 0) {
      try {
        events = await this.fetchFromMyfxbook(tradeTime);
      } catch (error) {
        console.error("⚠️  Both APIs failed, using demo data", error);
        events = this.getDemoEvents(tradeTime);
      }
    }

    // Cache results
    this.cache.set(dateKey, {
      events,
      timestamp: Date.now()
    });

    return this.filterEventsBySymbolAndTime(events, tradeTime, symbol);
  }

  /**
   * Fetch events from JBlanked Calendar API
   * Requires JBLANKED_API_KEY environment variable
   */
  private async fetchFromJBlanked(date: Date): Promise<EconomicEvent[]> {
    const apiKey = process.env.JBLANKED_API_KEY;

    if (!apiKey || apiKey === 'your_jblanked_api_key_here') {
      throw new Error('JBLANKED_API_KEY not configured');
    }

    const dateStr = date.toISOString().split('T')[0];
    const url = `https://api.jblanked.com/calendar?date=${dateStr}`;

    console.log(`📅 Fetching events from JBlanked for ${dateStr}...`);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`JBlanked API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Parse JBlanked response format
    if (!data.events || !Array.isArray(data.events)) {
      throw new Error('Invalid JBlanked response format');
    }

    return data.events.map((e: any) => ({
      time: e.datetime || e.time,
      currency: e.currency,
      event: e.title || e.event,
      impact: this.normalizeImpact(e.impact),
      actual: e.actual || null,
      forecast: e.forecast || null,
      previous: e.previous || null,
      source: 'jblanked'
    }));
  }

  /**
   * Fetch events from Myfxbook XML feed (backup API)
   * No API key required, unlimited requests
   */
  private async fetchFromMyfxbook(date: Date): Promise<EconomicEvent[]> {
    const dateStr = date.toISOString().split('T')[0];
    const url = `https://www.myfxbook.com/community/calendar/get-data?date=${dateStr}`;

    console.log(`📅 Fetching events from Myfxbook for ${dateStr}...`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Myfxbook API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Invalid Myfxbook response format');
    }

    return data.map((e: any) => ({
      time: e.date,
      currency: e.country,
      event: e.title,
      impact: this.normalizeImpact(e.impact),
      actual: e.actual || null,
      forecast: e.forecast || null,
      previous: e.previous || null,
      source: 'myfxbook'
    }));
  }

  /**
   * Normalize impact level from various API formats
   */
  private normalizeImpact(impact: any): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (typeof impact === 'string') {
      const upper = impact.toUpperCase();
      if (upper === 'HIGH' || upper === '3') return 'HIGH';
      if (upper === 'MEDIUM' || upper === '2') return 'MEDIUM';
      return 'LOW';
    }

    if (typeof impact === 'number') {
      if (impact >= 3) return 'HIGH';
      if (impact === 2) return 'MEDIUM';
      return 'LOW';
    }

    return 'LOW';
  }

  /**
   * Filter events by symbol currencies and time window
   * @param events All events for the day
   * @param tradeTime Trade entry time
   * @param symbol Trading pair (e.g., "GBPUSD")
   * @returns Events ±2 hours of trade time affecting the symbol
   */
  private filterEventsBySymbolAndTime(
    events: EconomicEvent[],
    tradeTime: Date,
    symbol: string
  ): EconomicEvent[] {
    // Extract currencies from symbol (e.g., GBPUSD -> GBP, USD)
    const currencies = [symbol.slice(0, 3), symbol.slice(3, 6)];

    // Filter events ±2 hours of trade time
    const twoHours = 2 * 60 * 60 * 1000;
    const startTime = tradeTime.getTime() - twoHours;
    const endTime = tradeTime.getTime() + twoHours;

    return events
      .filter(event => {
        const eventTime = new Date(event.time).getTime();
        const isInTimeRange = eventTime >= startTime && eventTime <= endTime;
        const affectsSymbol = currencies.includes(event.currency);

        return isInTimeRange && affectsSymbol;
      })
      .map(event => {
        const eventTime = new Date(event.time);
        const diffMs = eventTime.getTime() - tradeTime.getTime();
        const diffMins = Math.round(diffMs / 60000);

        // Add metadata for UI display
        return {
          ...event,
          affectsSymbol: true,
          timeDiff: this.formatTimeDiff(diffMins)
        };
      })
      .sort((a, b) => {
        // Sort by impact (HIGH first) then by proximity to trade time
        const impactOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
        if (impactDiff !== 0) return impactDiff;

        // Then by time proximity
        const aTime = new Date(a.time).getTime();
        const bTime = new Date(b.time).getTime();
        const aDiff = Math.abs(aTime - tradeTime.getTime());
        const bDiff = Math.abs(bTime - tradeTime.getTime());
        return aDiff - bDiff;
      });
  }

  /**
   * Format time difference for UI display
   */
  private formatTimeDiff(diffMins: number): string {
    if (diffMins === 0) return "at entry";

    const absMins = Math.abs(diffMins);
    const prefix = diffMins < 0 ? "-" : "+";

    if (absMins < 60) {
      return `${prefix}${absMins} min${absMins !== 1 ? 's' : ''}`;
    }

    const hours = Math.floor(absMins / 60);
    const mins = absMins % 60;

    if (mins === 0) {
      return `${prefix}${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return `${prefix}${hours}h ${mins}m`;
  }

  /**
   * Get demo events for testing (when APIs are unavailable)
   */
  private getDemoEvents(date: Date): EconomicEvent[] {
    const baseTime = new Date(date);
    baseTime.setHours(13, 30, 0, 0); // 1:30 PM UTC (typical NFP time)

    return [
      {
        time: baseTime.toISOString(),
        currency: 'USD',
        event: 'Non-Farm Payrolls',
        impact: 'HIGH',
        actual: '216K',
        forecast: '175K',
        previous: '199K',
        source: 'demo'
      },
      {
        time: new Date(baseTime.getTime() - 30 * 60 * 1000).toISOString(), // 30 mins before
        currency: 'USD',
        event: 'Unemployment Rate',
        impact: 'HIGH',
        actual: '3.7%',
        forecast: '3.8%',
        previous: '3.8%',
        source: 'demo'
      },
      {
        time: new Date(baseTime.getTime() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours after
        currency: 'EUR',
        event: 'ECB Interest Rate Decision',
        impact: 'HIGH',
        actual: null, // Not released yet
        forecast: '4.50%',
        previous: '4.25%',
        source: 'demo'
      }
    ];
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear();
    console.log('🗑️  Economic calendar cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const economicCalendarService = new EconomicCalendarService();

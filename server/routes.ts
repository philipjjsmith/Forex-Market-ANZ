import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { exchangeRateAPI } from "./services/exchangerate-api";

export async function registerRoutes(app: Express): Promise<Server> {
  // Forex API routes
  app.get("/api/forex/quotes", async (req, res) => {
    try {
      console.log('📊 Fetching forex quotes...');
      const quotes = await exchangeRateAPI.fetchAllQuotes();

      res.json({
        success: true,
        data: quotes,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('❌ Error in /api/forex/quotes:', error);

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch forex quotes',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Cache stats endpoint (for debugging)
  app.get("/api/forex/cache-stats", (req, res) => {
    const stats = exchangeRateAPI.getCacheStats();
    res.json({
      success: true,
      data: stats,
    });
  });

  // Historical data endpoint for learning simulator
  app.get("/api/forex/historical/:pair", async (req, res) => {
    try {
      const { pair } = req.params;

      // Parse pair like "EUR-USD" into from/to currencies
      const currencies = pair.split('-');
      if (currencies.length !== 2) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pair format. Use format: EUR-USD',
        });
      }

      const [fromSymbol, toSymbol] = currencies;

      // Use Alpha Vantage for historical data (we still have the API key)
      const apiKey = process.env.ALPHA_VANTAGE_KEY || '5ES11PSM60ESIMHH';
      const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&apikey=${apiKey}&outputsize=compact`;

      console.log(`📈 Fetching historical data for ${fromSymbol}/${toSymbol}...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Alpha Vantage API error: ${response.status}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.Note || data.Information) {
        return res.status(429).json({
          success: false,
          error: 'API rate limit reached. Please try again later.',
        });
      }

      if (!data['Time Series FX (Daily)']) {
        throw new Error('Invalid response from Alpha Vantage');
      }

      // Convert to array of candles
      const timeSeries = data['Time Series FX (Daily)'];
      const candles = Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
        date,
        open: parseFloat(values['1. open']),
        high: parseFloat(values['2. high']),
        low: parseFloat(values['3. low']),
        close: parseFloat(values['4. close']),
      })).reverse(); // Oldest first

      res.json({
        success: true,
        data: {
          pair: `${fromSymbol}/${toSymbol}`,
          candles,
          count: candles.length,
        },
      });

    } catch (error: any) {
      console.error('❌ Error fetching historical data:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch historical data',
      });
    }
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}

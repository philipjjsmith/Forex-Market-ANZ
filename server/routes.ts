import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { exchangeRateAPI } from "./services/exchangerate-api";
import { insertUserSchema } from "@shared/schema";
import { generateToken } from "./jwt";
import { requireAuth } from "./auth-middleware";
import bcrypt from "bcrypt";
import { registerSignalRoutes } from "./routes/signals";
import { registerAdminRoutes } from "./routes/admin";
import { registerAIRoutes } from "./routes/ai-insights";
import { signalGenerator } from "./services/signal-generator";
import { outcomeValidator } from "./services/outcome-validator";
import { aiAnalyzer } from "./services/ai-analyzer";
import { backtester } from "./services/backtester";

export async function registerRoutes(app: Express): Promise<Server> {
  // ========== CRON/SCHEDULED JOB ENDPOINTS ==========
  // These endpoints are pinged by UptimeRobot or cron services to trigger automated tasks
  // This architecture works on Render free tier (which sleeps after 15min of inactivity)

  /**
   * Signal Generation Cron (every 15 minutes)
   * Triggered by: UptimeRobot every 5 minutes (rate-limited to 15min)
   */
  app.get("/api/cron/generate-signals", async (req, res) => {
    try {
      const lastRun = signalGenerator.getLastRunTime();
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;

      // Only run if 15+ minutes since last run
      if (lastRun > 0 && now - lastRun < fifteenMinutes) {
        const minutesAgo = Math.round((now - lastRun) / 60000);
        const nextRunIn = Math.round((fifteenMinutes - (now - lastRun)) / 60000);

        return res.json({
          skipped: true,
          message: `Last run was ${minutesAgo} minute(s) ago`,
          nextRunIn: `${nextRunIn} minute(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger generation (non-blocking)
      signalGenerator.generateSignals().catch(error => {
        console.error('Error in signal generation:', error);
      });

      res.json({
        success: true,
        message: 'Signal generation triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (generate-signals):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Outcome Validation Cron (every 5 minutes)
   * Triggered by: UptimeRobot every 5 minutes
   */
  app.get("/api/cron/validate-outcomes", async (req, res) => {
    try {
      const lastRun = outcomeValidator.getLastRunTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      // Only run if 5+ minutes since last run
      if (lastRun > 0 && now - lastRun < fiveMinutes) {
        const minutesAgo = Math.round((now - lastRun) / 60000);
        const nextRunIn = Math.round((fiveMinutes - (now - lastRun)) / 60000);

        return res.json({
          skipped: true,
          message: `Last run was ${minutesAgo} minute(s) ago`,
          nextRunIn: `${nextRunIn} minute(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger validation (non-blocking)
      outcomeValidator.validatePendingSignals().catch(error => {
        console.error('Error in outcome validation:', error);
      });

      res.json({
        success: true,
        message: 'Outcome validation triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (validate-outcomes):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * AI Analysis Cron (every 6 hours)
   * Triggered by: External cron service (cron-job.org) every 6 hours
   */
  app.get("/api/cron/analyze-ai", async (req, res) => {
    try {
      const lastRun = aiAnalyzer.getLastRunTime();
      const now = Date.now();
      const sixHours = 6 * 60 * 60 * 1000;

      // Only run if 6+ hours since last run
      if (lastRun > 0 && now - lastRun < sixHours) {
        const hoursAgo = ((now - lastRun) / (60 * 60 * 1000)).toFixed(1);
        const nextRunIn = ((sixHours - (now - lastRun)) / (60 * 60 * 1000)).toFixed(1);

        return res.json({
          skipped: true,
          message: `Last run was ${hoursAgo} hour(s) ago`,
          nextRunIn: `${nextRunIn} hour(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger analysis (non-blocking)
      aiAnalyzer.analyzeAllSymbols().catch(error => {
        console.error('Error in AI analysis:', error);
      });

      res.json({
        success: true,
        message: 'AI analysis triggered',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (analyze-ai):', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Backtesting Cron (every 24 hours)
   * Triggered by: UptimeRobot every 24 hours
   * Analyzes historical signals and generates optimization recommendations
   */
  app.get("/api/cron/run-backtesting", async (req, res) => {
    try {
      const lastRun = backtester.getLastRunTime();
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      // Only run if 24+ hours since last run
      if (lastRun > 0 && now - lastRun < twentyFourHours) {
        const hoursAgo = ((now - lastRun) / (60 * 60 * 1000)).toFixed(1);
        const nextRunIn = ((twentyFourHours - (now - lastRun)) / (60 * 60 * 1000)).toFixed(1);

        return res.json({
          skipped: true,
          message: `Last run was ${hoursAgo} hour(s) ago`,
          nextRunIn: `${nextRunIn} hour(s)`,
          lastRun: new Date(lastRun).toISOString()
        });
      }

      // Trigger backtesting (non-blocking)
      backtester.backtestAllSymbols().catch(error => {
        console.error('Error in backtesting:', error);
      });

      res.json({
        success: true,
        message: 'Backtesting triggered - analyzing historical signals for optimization opportunities',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Cron error (run-backtesting):', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Register signal tracking routes
  registerSignalRoutes(app);

  // Register admin routes
  registerAdminRoutes(app);

  // Register AI insights routes
  registerAIRoutes(app);

  // ========== AUTHENTICATION ROUTES ==========

  // Register new user
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validation = insertUserSchema.safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({
          success: false,
          error: validation.error.errors[0].message,
        });
      }

      const { username, email, password } = validation.data;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Email already registered',
        });
      }

      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken',
        });
      }

      // Create user (password will be hashed in storage)
      const user = await storage.createUser({ username, email, password });

      // Generate JWT token
      const token = generateToken(user);

      console.log('✅ Registration successful:', email);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('❌ Registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Registration failed',
      });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required',
        });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);

      if (!user) {
        console.log('❌ Login failed: User not found for email:', email);
        return res.status(401).json({
          success: false,
          error: 'Incorrect email or password',
        });
      }

      // Check if user signed up with Google (no password)
      if (!user.password) {
        console.log('❌ Login failed: User has no password (Google account)');
        return res.status(401).json({
          success: false,
          error: 'Please sign in with Google',
        });
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        console.log('❌ Login failed: Password mismatch');
        return res.status(401).json({
          success: false,
          error: 'Incorrect email or password',
        });
      }

      // Generate JWT token
      const token = generateToken(user);

      console.log('✅ Login successful for:', email);

      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error: any) {
      console.error('❌ Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed',
      });
    }
  });

  // Logout (JWT is stateless - just client-side token removal)
  app.post("/api/auth/logout", (req, res) => {
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  });

  // Get current user (requires JWT authentication)
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      // requireAuth middleware already validated token and attached user info
      const user = await storage.getUser(req.userId!);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error('❌ /api/auth/me error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user',
      });
    }
  });

  // Forgot password - simplified version without email
  app.post("/api/auth/forgot-password", async (req, res) => {
    res.json({
      success: true,
      message: 'Password reset functionality coming soon',
    });
  });

  // ========== FOREX API ROUTES ==========

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

      // Fallback to mock data if API fails (for development/testing)
      console.log('⚠️  Using mock forex data as fallback');
      const mockQuotes = [
        {
          symbol: 'EUR/USD',
          fromCurrency: 'EUR',
          toCurrency: 'USD',
          exchangeRate: 1.0850,
          bidPrice: 1.0849,
          askPrice: 1.0851,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'GBP/USD',
          fromCurrency: 'GBP',
          toCurrency: 'USD',
          exchangeRate: 1.2650,
          bidPrice: 1.2649,
          askPrice: 1.2651,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'USD/JPY',
          fromCurrency: 'USD',
          toCurrency: 'JPY',
          exchangeRate: 149.50,
          bidPrice: 149.49,
          askPrice: 149.51,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'AUD/USD',
          fromCurrency: 'AUD',
          toCurrency: 'USD',
          exchangeRate: 0.6520,
          bidPrice: 0.6519,
          askPrice: 0.6521,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
        {
          symbol: 'USD/CHF',
          fromCurrency: 'USD',
          toCurrency: 'CHF',
          exchangeRate: 0.8750,
          bidPrice: 0.8749,
          askPrice: 0.8751,
          lastRefreshed: new Date().toISOString(),
          timezone: 'UTC',
        },
      ];

      res.json({
        success: true,
        data: mockQuotes,
        timestamp: new Date().toISOString(),
        mock: true,
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

      // Parse pair like "EUR-USD" into "EUR/USD" format for Twelve Data
      const currencies = pair.split('-');
      if (currencies.length !== 2) {
        return res.status(400).json({
          success: false,
          error: 'Invalid pair format. Use format: EUR-USD',
        });
      }

      const symbol = `${currencies[0]}/${currencies[1]}`; // e.g., "EUR/USD"

      // Use Twelve Data for historical data (800 calls/day free tier)
      const apiKey = process.env.TWELVE_DATA_KEY || 'demo';
      const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=100&apikey=${apiKey}`;

      console.log(`📈 Fetching historical data for ${symbol}...`);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Twelve Data API error: ${response.status}`);
      }

      const data = await response.json();

      // Check for API errors
      if (data.status === 'error') {
        return res.status(400).json({
          success: false,
          error: data.message || 'Error fetching historical data',
        });
      }

      if (!data.values || !Array.isArray(data.values)) {
        throw new Error('Invalid response from Twelve Data');
      }

      // Convert to our candle format (Twelve Data returns newest first, so reverse it)
      const candles = data.values.map((item: any) => ({
        date: item.datetime,
        open: parseFloat(item.open),
        high: parseFloat(item.high),
        low: parseFloat(item.low),
        close: parseFloat(item.close),
      })).reverse(); // Oldest first

      res.json({
        success: true,
        data: {
          pair: symbol,
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

  /**
   * On-Demand Signal Analysis (v3.1.0)
   * Allows manual signal generation for specific symbol
   * Uses ICT 3-Timeframe methodology with real Twelve Data candles
   */
  app.post("/api/signals/analyze", async (req, res) => {
    try {
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: 'Symbol is required'
        });
      }

      // Validate symbol
      const validSymbols = ['EUR/USD', 'USD/JPY']; // Top 2 pairs by volume
      if (!validSymbols.includes(symbol)) {
        return res.status(400).json({
          success: false,
          error: `Invalid symbol. Must be one of: ${validSymbols.join(', ')}`
        });
      }

      // Generate signal using v3.1.0 ICT methodology
      const result = await signalGenerator.generateSignalForSymbol(symbol);

      res.json({
        success: true,
        signal: result?.signal || null,
        candles: result?.candles || [],
        message: result?.signal
          ? `Generated ${result.signal.tier} tier signal with ${result.signal.confidence}% confidence`
          : 'No signal generated (market conditions not aligned)'
      });

    } catch (error: any) {
      console.error('❌ Error in on-demand analysis:', error);

      // Check if it's a rate limit error
      const isRateLimit = error.message?.includes('rate limit');
      const statusCode = isRateLimit ? 429 : 500;

      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to analyze market',
        isRateLimit: isRateLimit
      });
    }
  });

  /**
   * ADX Sensitivity Test (Admin/Debug endpoint)
   * Tests multiple ADX thresholds to validate system robustness
   * Used for parameter sensitivity analysis (industry best practice)
   */
  app.post("/api/admin/test-adx-sensitivity", async (req, res) => {
    try {
      const { symbol } = req.body;

      if (!symbol) {
        return res.status(400).json({
          success: false,
          error: 'Symbol is required'
        });
      }

      const validSymbols = ['EUR/USD', 'USD/JPY']; // Top 2 pairs by volume
      if (!validSymbols.includes(symbol)) {
        return res.status(400).json({
          success: false,
          error: `Invalid symbol. Must be one of: ${validSymbols.join(', ')}`
        });
      }

      console.log(`\n🧪 ADX SENSITIVITY TEST for ${symbol}`);
      console.log(`${'='.repeat(60)}\n`);

      // Test multiple ADX thresholds: [20, 22, 25, 27, 30]
      const thresholds = [20, 22, 25, 27, 30];
      const results = [];

      for (const threshold of thresholds) {
        console.log(`\n🔬 Testing ADX Threshold: ${threshold}`);
        console.log(`${'-'.repeat(60)}`);

        const result = await signalGenerator.testAdxThreshold(symbol, threshold);
        results.push(result);
      }

      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ ADX Sensitivity Test Complete\n`);

      res.json({
        success: true,
        symbol,
        results,
        recommendation: analyzeResults(results)
      });

    } catch (error: any) {
      console.error('❌ Error in ADX sensitivity test:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to run sensitivity test'
      });
    }
  });

  // Helper function to analyze test results
  function analyzeResults(results: any[]) {
    const signalCounts = results.map(r => ({
      threshold: r.threshold,
      signalGenerated: r.signal !== null,
      confidence: r.signal?.confidence || 0
    }));

    const lowestWithSignal = signalCounts.find(r => r.signalGenerated);
    const highestQuality = signalCounts.reduce((max, r) =>
      r.confidence > max.confidence ? r : max,
      { threshold: 0, confidence: 0 }
    );

    return {
      summary: `Tested ${results.length} ADX thresholds`,
      lowestThresholdWithSignal: lowestWithSignal?.threshold || 'None',
      highestQualityThreshold: highestQuality.threshold || 'None',
      highestConfidence: highestQuality.confidence,
      recommendation: lowestWithSignal
        ? `System can generate signals. ADX ${lowestWithSignal.threshold} allows signals, but ADX 25 (industry standard) is recommended for profitability.`
        : 'No signals at any threshold - market conditions genuinely poor (W+D+4H not aligned)'
    };
  }

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}

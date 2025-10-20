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

export async function registerRoutes(app: Express): Promise<Server> {
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

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}

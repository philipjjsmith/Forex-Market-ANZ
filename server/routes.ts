import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { exchangeRateAPI } from "./services/exchangerate-api";
import passport from "./passport-config";
import { insertUserSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
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

      // Log the user in automatically
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: 'Failed to log in after registration',
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
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: 'Authentication error',
        });
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: info?.message || 'Invalid credentials',
        });
      }

      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: 'Login failed',
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
      });
    })(req, res, next);
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: 'Logout failed',
        });
      }

      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    });
  });

  // Get current user
  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
    }

    const user = req.user as any;
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });
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

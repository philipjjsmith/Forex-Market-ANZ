import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { alphaVantageAPI } from "./services/alphavantage-api";

export async function registerRoutes(app: Express): Promise<Server> {
  // Forex API routes
  app.get("/api/forex/quotes", async (req, res) => {
    try {
      console.log('📊 Fetching forex quotes...');
      const quotes = await alphaVantageAPI.fetchAllQuotes();

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
    const stats = alphaVantageAPI.getCacheStats();
    res.json({
      success: true,
      data: stats,
    });
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}

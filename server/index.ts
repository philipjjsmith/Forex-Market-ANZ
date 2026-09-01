import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import cors from "cors";
import passport from "./passport-config";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { supabase } from "./supabase";
import { outcomeValidator } from "./services/outcome-validator";
import { signalGenerator } from "./services/signal-generator";
import { aiAnalyzer } from "./services/ai-analyzer";

// CORS Configuration Active - Build v3

// Custom Supabase session store (avoids PostgreSQL direct connection issues)
class SupabaseSessionStore extends session.Store {
  async get(sid: string, callback: (err?: any, session?: any) => void) {
    try {
      console.log('🔍 Session GET:', sid);
      const { data, error } = await supabase
        .from('sessions')
        .select('sess, expire')
        .eq('sid', sid)
        .single();

      if (error) {
        console.log('❌ Session GET error:', error.message);
        return callback(null, null);
      }

      if (!data) {
        console.log('⚠️  Session not found:', sid);
        return callback(null, null);
      }

      if (data.expire && new Date(data.expire) < new Date()) {
        console.log('⏰ Session expired:', sid);
        return callback(null, null);
      }

      console.log('✅ Session found:', sid);
      callback(null, data.sess);
    } catch (err) {
      console.error('❌ Session GET exception:', err);
      callback(err);
    }
  }

  async set(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const expire = session.cookie?.expires ? new Date(session.cookie.expires) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      console.log('💾 Session SET:', sid, 'expire:', expire);

      const { error } = await supabase
        .from('sessions')
        .upsert({
          sid,
          sess: session,
          expire: expire.toISOString(),
        });

      if (error) {
        console.error('❌ Session SET error:', error);
        throw error;
      }

      console.log('✅ Session saved:', sid);
      callback?.();
    } catch (err) {
      console.error('❌ Session SET exception:', err);
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      console.log('🗑️  Session DESTROY:', sid);
      await supabase
        .from('sessions')
        .delete()
        .eq('sid', sid);

      callback?.();
    } catch (err) {
      console.error('❌ Session DESTROY exception:', err);
      callback?.(err);
    }
  }
}

const app = express();

// CORS middleware - MUST be before session/passport and body parsers
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);

    // The API's own origin is on this list deliberately.
    //
    // Render serves the built SPA as well as the API, and index.html marks both bundles
    // `crossorigin` — so a browser loading the app from the Render domain requests its own
    // assets in CORS mode, with an Origin header. Without the entry below the app rejects its
    // own origin, both assets return 500 "Not allowed by CORS", #root never mounts, and the
    // page is BLANK. curl shows 200 for the same URLs because curl sends no Origin, so the
    // usual health check says everything is fine.
    //
    // That cost real time on 2026-09-01: the Render URL was read as "the site is down" while
    // the actual front-end (Cloudflare Pages, below) was serving correctly the whole time.
    // Diagnose this class of fault with `curl -H "Origin: <the site>"`, never a plain curl.
    const allowedOrigins = [
      'https://forex-market-anz.pages.dev',      // Cloudflare Pages — the real front-end
      'https://forex-market-anz.onrender.com',   // Render — API, and the SPA copy it also serves
      'http://localhost:5000',
      'http://localhost:5173'
    ];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // CRITICAL: Allow cookies to be sent
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Explicit OPTIONS handler for all routes (backup CORS handling)
app.options('*', cors());

// Session configuration with Supabase REST API store
app.use(session({
  store: new SupabaseSessionStore(),
  secret: process.env.SESSION_SECRET || 'forex-secret-key-change-in-production',
  resave: true, // Force session save on every request
  saveUninitialized: true, // Create session for every request
  name: 'forex.sid',
  proxy: true,
  rolling: true,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'none',
    path: '/',
  },
}));

// Initialize Passport and session
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);

    // ========== AUTOMATED SERVICES NOW USE HTTP CRON ENDPOINTS ==========
    // Services are triggered by HTTP requests instead of setInterval
    // This works reliably on Render free tier (which sleeps after 15min)
    //
    // Cron Endpoints:
    // - /api/cron/generate-signals (every 15 min via UptimeRobot)
    // - /api/cron/validate-outcomes (every 5 min via UptimeRobot)
    // - /api/cron/analyze-ai (every 6 hours via cron-job.org)
    //
    // See server/routes.ts for endpoint implementations

    console.log('✅ Server started - automated services ready');
    console.log('📡 Cron endpoints available:');
    console.log('   GET /api/cron/generate-signals (15 min intervals)');
    console.log('   GET /api/cron/validate-outcomes (5 min intervals)');
    console.log('   GET /api/cron/analyze-ai (6 hour intervals)');
    console.log('');
    console.log('⚠️  Configure UptimeRobot to ping these endpoints for 24/7 operation');
  });
})();

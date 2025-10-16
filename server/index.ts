import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "./passport-config";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { supabase } from "./supabase";

// CORS Configuration Active - Build v2

// Custom Supabase session store (avoids PostgreSQL direct connection issues)
class SupabaseSessionStore extends session.Store {
  async get(sid: string, callback: (err?: any, session?: any) => void) {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('sess, expire')
        .eq('sid', sid)
        .single();

      if (error || !data) {
        return callback(null, null);
      }

      if (data.expire && new Date(data.expire) < new Date()) {
        return callback(null, null);
      }

      callback(null, data.sess);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const expire = session.cookie?.expires ? new Date(session.cookie.expires) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const { error } = await supabase
        .from('sessions')
        .upsert({
          sid,
          sess: session,
          expire: expire.toISOString(),
        });

      if (error) throw error;
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      await supabase
        .from('sessions')
        .delete()
        .eq('sid', sid);

      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS middleware - MUST be before session/passport
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://forex-market-anz.pages.dev',
    'http://localhost:5000',
    'http://localhost:5173'
  ];

  const origin = req.headers.origin;

  // Always set CORS headers for allowed origins
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Session configuration with Supabase REST API store
app.use(session({
  store: new SupabaseSessionStore(),
  secret: process.env.SESSION_SECRET || 'forex-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  name: 'forex.sid', // Custom session cookie name
  proxy: true, // Trust proxy (required for Render)
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Allow cross-site in production
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
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader } from './jwt';
import { storage } from './storage';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      username?: string;
    }
  }
}

/**
 * Middleware to require JWT authentication
 * Attaches user info to req if valid token provided
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractTokenFromHeader(req.headers.authorization);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'No authentication token provided',
    });
  }

  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    });
  }

  // Verify user still exists in database
  const user = await storage.getUser(payload.userId);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'User not found',
    });
  }

  // Attach user info to request
  req.userId = payload.userId;
  req.userEmail = payload.email;
  req.username = payload.username;

  next();
}

/**
 * Optional auth middleware - doesn't fail if no token
 * Just attaches user info if valid token provided
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractTokenFromHeader(req.headers.authorization);

  if (token) {
    const payload = verifyToken(token);

    if (payload) {
      const user = await storage.getUser(payload.userId);
      if (user) {
        req.userId = payload.userId;
        req.userEmail = payload.email;
        req.username = payload.username;
      }
    }
  }

  next();
}

/**
 * Middleware to require admin role
 * Must be used AFTER requireAuth middleware
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // First check if user is authenticated
  if (!req.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
    });
  }

  // Get user from database to check role
  const user = await storage.getUser(req.userId);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'User not found',
    });
  }

  // Check if user has admin role
  if (user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Admin privileges required.',
    });
  }

  // User is admin, allow access
  next();
}

/**
 * Shared-secret guard for machine-called endpoints (UptimeRobot cron).
 *
 * These cannot use `requireAuth` — there is no user and no JWT. They were completely
 * unauthenticated, which mattered because `/api/cron/generate-signals` writes production rows
 * and its siblings mutate outcomes.
 *
 * DELIBERATE TRADE-OFF: this enforces ONLY when CRON_SECRET is set. Failing closed on an unset
 * variable would stop live signal generation the moment this deploys, before the operator has had
 * any chance to add the secret to Render and UptimeRobot — trading an exposure for an outage.
 * While unset it logs loudly on every call so the gap cannot be forgotten.
 *
 * Accepts `X-Cron-Key: <secret>` or `?key=<secret>` (UptimeRobot can only send a URL).
 */
export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    console.warn(
      `[SECURITY] ${req.path} served WITHOUT authentication — CRON_SECRET is not set. ` +
      `Anyone can trigger this endpoint. Set CRON_SECRET in Render and append ?key=<secret> to the UptimeRobot monitor.`
    );
    return next();
  }

  const supplied = (req.headers['x-cron-key'] as string | undefined) ?? (req.query.key as string | undefined);
  if (supplied !== expected) {
    console.warn(`[SECURITY] rejected unauthenticated call to ${req.path}`);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

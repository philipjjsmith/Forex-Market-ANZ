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

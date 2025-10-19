// API Configuration - handles different URLs for dev vs production

const getApiBaseUrl = (): string => {
  if (import.meta.env.PROD) {
    // Production: Frontend on Cloudflare Pages, Backend on Render
    return 'https://forex-market-anz.onrender.com';
  }
  // Development: Both frontend and backend on localhost:5000
  return '';
};

export const API_BASE_URL = getApiBaseUrl();

export const API_ENDPOINTS = {
  // Forex endpoints
  FOREX_QUOTES: `${API_BASE_URL}/api/forex/quotes`,
  FOREX_HISTORICAL: (pair: string) => `${API_BASE_URL}/api/forex/historical/${pair}`,
  FOREX_CACHE_STATS: `${API_BASE_URL}/api/forex/cache-stats`,

  // Auth endpoints (already handled in auth.ts)
  AUTH_REGISTER: `${API_BASE_URL}/api/auth/register`,
  AUTH_LOGIN: `${API_BASE_URL}/api/auth/login`,
  AUTH_LOGOUT: `${API_BASE_URL}/api/auth/logout`,
  AUTH_ME: `${API_BASE_URL}/api/auth/me`,

  // Signal tracking endpoints
  SIGNALS_TRACK: `${API_BASE_URL}/api/signals/track`,
  SIGNALS_ACTIVE: `${API_BASE_URL}/api/signals/active`,
  SIGNALS_PERFORMANCE: `${API_BASE_URL}/api/signals/performance`,
  SIGNALS_HISTORY: `${API_BASE_URL}/api/signals/history`,
  SIGNALS_CLOSE: (signalId: string) => `${API_BASE_URL}/api/signals/${signalId}/close`,

  // Admin endpoints
  ADMIN_HEALTH: `${API_BASE_URL}/api/admin/health`,
  ADMIN_LOGS: `${API_BASE_URL}/api/admin/logs`,
  ADMIN_TRIGGER_GENERATION: `${API_BASE_URL}/api/admin/trigger-generation`,
};

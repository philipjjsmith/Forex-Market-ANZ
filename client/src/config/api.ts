// API Configuration - handles different URLs for dev vs production

const getApiBaseUrl = (): string => {
  // Development: Use relative paths (Vite dev server proxies to local Express)
  if (import.meta.env.DEV) {
    return '';
  }
  // Production: ALWAYS use absolute Render URL (bypasses Cloudflare Pages)
  // This prevents Cloudflare Pages from trying to serve /api/* as static files (which causes 405)
  return 'https://forex-market-anz.onrender.com';
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
  SIGNALS_ANALYZE: `${API_BASE_URL}/api/signals/analyze`,
  SIGNALS_ACTIVE: `${API_BASE_URL}/api/signals/active`,
  SIGNALS_PERFORMANCE: `${API_BASE_URL}/api/signals/performance`,
  SIGNALS_HISTORY: `${API_BASE_URL}/api/signals/history`,
  SIGNALS_CLOSE: (signalId: string) => `${API_BASE_URL}/api/signals/${signalId}/close`,

  // Admin endpoints
  ADMIN_HEALTH: `${API_BASE_URL}/api/admin/health`,
  ADMIN_LOGS: `${API_BASE_URL}/api/admin/logs`,
  ADMIN_TRIGGER_GENERATION: `${API_BASE_URL}/api/admin/trigger-generation`,
  ADMIN_GROWTH_STATS: `${API_BASE_URL}/api/admin/growth-stats`,
  ADMIN_GROWTH_STATS_DUAL: `${API_BASE_URL}/api/admin/growth-stats-dual`,

  // AI Insights endpoints
  AI_INSIGHTS: `${API_BASE_URL}/api/ai/insights`,
  AI_INSIGHTS_SYMBOL: (symbol: string) => `${API_BASE_URL}/api/ai/insights/${symbol}`,
  AI_RECOMMENDATIONS: `${API_BASE_URL}/api/ai/recommendations`,
  AI_RECOMMENDATION_APPROVE: (id: string) => `${API_BASE_URL}/api/ai/recommendations/${id}/approve`,
  AI_RECOMMENDATION_REJECT: (id: string) => `${API_BASE_URL}/api/ai/recommendations/${id}/reject`,
  AI_ANALYZE: `${API_BASE_URL}/api/ai/analyze`,
  AI_PERFORMANCE: (symbol: string) => `${API_BASE_URL}/api/ai/performance/${symbol}`,
};

/**
 * Auto-Trader API Client
 * Handles communication with the backend for database persistence
 */

import { AutoTradePosition, AutoTraderStats } from './auto-trader';

const API_BASE = '/api/auto-trader';

export class AutoTraderAPI {
  // Save a new trade
  static async saveTrade(trade: AutoTradePosition): Promise<void> {
    const response = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        trade: {
          id: trade.id,
          userId: '', // Will be set by server from auth
          signalId: trade.signalId,
          symbol: trade.symbol,
          type: trade.type,
          entryPrice: trade.entryPrice,
          entryTime: new Date(trade.entryTime),
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          confidence: trade.confidence,
          positionSize: trade.positionSize,
          status: trade.status,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save trade');
    }
  }

  // Update a trade (when closed)
  static async updateTrade(trade: AutoTradePosition): Promise<void> {
    const response = await fetch(`${API_BASE}/trades/${trade.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        updates: {
          exitPrice: trade.exitPrice,
          exitTime: trade.exitTime ? new Date(trade.exitTime) : undefined,
          exitReason: trade.exitReason,
          profitLoss: trade.profitLoss,
          status: trade.status,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update trade');
    }
  }

  // Create a new trading session
  static async createSession(
    startingBalance: number,
    config: any
  ): Promise<string> {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        session: {
          userId: '', // Will be set by server
          startTime: new Date(),
          startingBalance,
          config,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    const data = await response.json();
    return data.data.sessionId;
  }

  // Update session stats
  static async updateSession(
    sessionId: string,
    stats: AutoTraderStats
  ): Promise<void> {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        updates: {
          endTime: stats.isRunning ? undefined : new Date(),
          endingBalance: stats.virtualBalance,
          totalTrades: stats.totalTrades,
          winningTrades: stats.winningTrades,
          losingTrades: stats.losingTrades,
          totalProfit: stats.totalProfit,
          totalLoss: stats.totalLoss,
          netPL: stats.netPL,
          winRate: stats.winRate,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update session');
    }
  }

  // Update strategy metrics (for learning)
  static async updateMetrics(
    symbol: string,
    confidence: number,
    won: boolean,
    profitLoss: number
  ): Promise<void> {
    const response = await fetch(`${API_BASE}/metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        symbol,
        confidence,
        won,
        profitLoss,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update metrics');
    }
  }

  // Get all trades
  static async getTrades(limit = 100): Promise<any[]> {
    const response = await fetch(`${API_BASE}/trades?limit=${limit}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch trades');
    }

    const data = await response.json();
    return data.data;
  }

  // Get trading sessions
  static async getSessions(limit = 20): Promise<any[]> {
    const response = await fetch(`${API_BASE}/sessions?limit=${limit}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch sessions');
    }

    const data = await response.json();
    return data.data;
  }

  // Get strategy metrics
  static async getMetrics(): Promise<any[]> {
    const response = await fetch(`${API_BASE}/metrics`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch metrics');
    }

    const data = await response.json();
    return data.data;
  }

  // Get performance summary
  static async getPerformanceSummary(days = 30): Promise<any> {
    const response = await fetch(`${API_BASE}/performance?days=${days}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch performance summary');
    }

    const data = await response.json();
    return data.data;
  }
}

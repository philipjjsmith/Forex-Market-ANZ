/**
 * Auto-Trader Database Persistence Service
 * Handles saving and retrieving auto-trader data from the database
 */

import { db } from '../db';
import { autoTrades, autoTraderSessions, strategyMetrics } from '@shared/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export interface TradeData {
  id: string;
  userId: string;
  signalId: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: Date;
  stopLoss: number;
  takeProfit: number;
  exitPrice?: number;
  exitTime?: Date;
  exitReason?: 'HIT_TP' | 'HIT_SL' | 'MANUAL' | 'TIME_LIMIT';
  profitLoss?: number;
  confidence: number;
  positionSize: number;
  status: 'OPEN' | 'CLOSED';
}

export interface SessionData {
  id?: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  startingBalance: number;
  endingBalance?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  totalProfit?: number;
  totalLoss?: number;
  netPL?: number;
  winRate?: number;
  config: any;
}

export class AutoTraderDB {
  // ========== TRADES ==========

  async saveTrade(trade: TradeData): Promise<void> {
    await db.insert(autoTrades).values({
      id: trade.id,
      userId: trade.userId,
      signalId: trade.signalId,
      symbol: trade.symbol,
      type: trade.type,
      entryPrice: trade.entryPrice.toString(),
      entryTime: trade.entryTime,
      stopLoss: trade.stopLoss.toString(),
      takeProfit: trade.takeProfit.toString(),
      exitPrice: trade.exitPrice?.toString(),
      exitTime: trade.exitTime,
      exitReason: trade.exitReason,
      profitLoss: trade.profitLoss?.toString(),
      confidence: trade.confidence,
      positionSize: trade.positionSize.toString(),
      status: trade.status,
    });
  }

  async updateTrade(tradeId: string, updates: Partial<TradeData>): Promise<void> {
    const updateData: any = {};

    if (updates.exitPrice !== undefined) updateData.exitPrice = updates.exitPrice.toString();
    if (updates.exitTime !== undefined) updateData.exitTime = updates.exitTime;
    if (updates.exitReason !== undefined) updateData.exitReason = updates.exitReason;
    if (updates.profitLoss !== undefined) updateData.profitLoss = updates.profitLoss.toString();
    if (updates.status !== undefined) updateData.status = updates.status;

    await db.update(autoTrades)
      .set(updateData)
      .where(eq(autoTrades.id, tradeId));
  }

  async getTrades(userId: string, limit = 100): Promise<any[]> {
    return await db.select()
      .from(autoTrades)
      .where(eq(autoTrades.userId, userId))
      .orderBy(desc(autoTrades.entryTime))
      .limit(limit);
  }

  async getOpenTrades(userId: string): Promise<any[]> {
    return await db.select()
      .from(autoTrades)
      .where(and(
        eq(autoTrades.userId, userId),
        eq(autoTrades.status, 'OPEN')
      ));
  }

  async getClosedTrades(userId: string, limit = 50): Promise<any[]> {
    return await db.select()
      .from(autoTrades)
      .where(and(
        eq(autoTrades.userId, userId),
        eq(autoTrades.status, 'CLOSED')
      ))
      .orderBy(desc(autoTrades.exitTime))
      .limit(limit);
  }

  // ========== SESSIONS ==========

  async createSession(session: SessionData): Promise<string> {
    const result = await db.insert(autoTraderSessions)
      .values({
        userId: session.userId,
        startTime: session.startTime,
        startingBalance: session.startingBalance.toString(),
        config: session.config,
      })
      .returning({ id: autoTraderSessions.id });

    return result[0].id;
  }

  async updateSession(sessionId: string, updates: Partial<SessionData>): Promise<void> {
    const updateData: any = {};

    if (updates.endTime !== undefined) updateData.endTime = updates.endTime;
    if (updates.endingBalance !== undefined) updateData.endingBalance = updates.endingBalance.toString();
    if (updates.totalTrades !== undefined) updateData.totalTrades = updates.totalTrades;
    if (updates.winningTrades !== undefined) updateData.winningTrades = updates.winningTrades;
    if (updates.losingTrades !== undefined) updateData.losingTrades = updates.losingTrades;
    if (updates.totalProfit !== undefined) updateData.totalProfit = updates.totalProfit.toString();
    if (updates.totalLoss !== undefined) updateData.totalLoss = updates.totalLoss.toString();
    if (updates.netPL !== undefined) updateData.netPL = updates.netPL.toString();
    if (updates.winRate !== undefined) updateData.winRate = updates.winRate.toString();

    await db.update(autoTraderSessions)
      .set(updateData)
      .where(eq(autoTraderSessions.id, sessionId));
  }

  async getSessions(userId: string, limit = 20): Promise<any[]> {
    return await db.select()
      .from(autoTraderSessions)
      .where(eq(autoTraderSessions.userId, userId))
      .orderBy(desc(autoTraderSessions.startTime))
      .limit(limit);
  }

  async getActiveSession(userId: string): Promise<any | null> {
    const sessions = await db.select()
      .from(autoTraderSessions)
      .where(and(
        eq(autoTraderSessions.userId, userId),
        sql`${autoTraderSessions.endTime} IS NULL`
      ))
      .limit(1);

    return sessions.length > 0 ? sessions[0] : null;
  }

  // ========== STRATEGY METRICS ==========

  async updateStrategyMetrics(userId: string, symbol: string, confidence: number, won: boolean, profitLoss: number): Promise<void> {
    const confidenceRange = this.getConfidenceRange(confidence);

    // Try to get existing metrics
    const existing = await db.select()
      .from(strategyMetrics)
      .where(and(
        eq(strategyMetrics.userId, userId),
        eq(strategyMetrics.symbol, symbol),
        eq(strategyMetrics.confidenceRange, confidenceRange)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing metrics
      const current = existing[0];
      const newTotalTrades = Number(current.totalTrades) + 1;
      const newWinningTrades = Number(current.winningTrades) + (won ? 1 : 0);
      const newLosingTrades = Number(current.losingTrades) + (won ? 0 : 1);

      const currentAvgProfit = parseFloat(current.avgProfit || '0');
      const currentAvgLoss = parseFloat(current.avgLoss || '0');

      const newAvgProfit = won
        ? ((currentAvgProfit * Number(current.winningTrades)) + profitLoss) / newWinningTrades
        : currentAvgProfit;

      const newAvgLoss = !won
        ? ((currentAvgLoss * Number(current.losingTrades)) + Math.abs(profitLoss)) / newLosingTrades
        : currentAvgLoss;

      const newWinRate = (newWinningTrades / newTotalTrades) * 100;
      const newProfitFactor = newAvgLoss > 0 ? (newWinningTrades * newAvgProfit) / (newLosingTrades * newAvgLoss) : 0;

      await db.update(strategyMetrics)
        .set({
          totalTrades: newTotalTrades,
          winningTrades: newWinningTrades,
          losingTrades: newLosingTrades,
          avgProfit: newAvgProfit.toString(),
          avgLoss: newAvgLoss.toString(),
          winRate: newWinRate.toString(),
          profitFactor: newProfitFactor.toString(),
          lastUpdated: new Date(),
        })
        .where(eq(strategyMetrics.id, current.id));
    } else {
      // Create new metrics
      await db.insert(strategyMetrics).values({
        userId,
        symbol,
        confidenceRange,
        totalTrades: 1,
        winningTrades: won ? 1 : 0,
        losingTrades: won ? 0 : 1,
        avgProfit: won ? profitLoss.toString() : '0',
        avgLoss: won ? '0' : Math.abs(profitLoss).toString(),
        winRate: won ? '100' : '0',
        profitFactor: '0',
      });
    }
  }

  async getStrategyMetrics(userId: string): Promise<any[]> {
    return await db.select()
      .from(strategyMetrics)
      .where(eq(strategyMetrics.userId, userId))
      .orderBy(desc(strategyMetrics.winRate));
  }

  async getSymbolMetrics(userId: string, symbol: string): Promise<any[]> {
    return await db.select()
      .from(strategyMetrics)
      .where(and(
        eq(strategyMetrics.userId, userId),
        eq(strategyMetrics.symbol, symbol)
      ));
  }

  private getConfidenceRange(confidence: number): string {
    if (confidence >= 90) return '90-100';
    if (confidence >= 80) return '80-89';
    if (confidence >= 70) return '70-79';
    if (confidence >= 60) return '60-69';
    return '50-59';
  }

  // ========== ANALYTICS ==========

  async getPerformanceSummary(userId: string, days = 30): Promise<any> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const trades = await db.select()
      .from(autoTrades)
      .where(and(
        eq(autoTrades.userId, userId),
        eq(autoTrades.status, 'CLOSED'),
        sql`${autoTrades.exitTime} >= ${cutoffDate}`
      ));

    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => parseFloat(t.profitLoss || '0') > 0);
    const losingTrades = trades.filter(t => parseFloat(t.profitLoss || '0') < 0);

    const totalProfit = winningTrades.reduce((sum, t) => sum + parseFloat(t.profitLoss || '0'), 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.profitLoss || '0'), 0));

    return {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      totalProfit,
      totalLoss,
      netPL: totalProfit - totalLoss,
      winRate: totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0,
      avgProfit: winningTrades.length > 0 ? totalProfit / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? totalLoss / losingTrades.length : 0,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : 0,
    };
  }
}

export const autoTraderDB = new AutoTraderDB();

/**
 * signal-stats.ts — ArgoFX Signal Performance Queries
 *
 * Pure DB query functions used by telegram-notifier.ts and outcome-validator.ts
 * to attach live performance stats to every Telegram message.
 *
 * All queries filter data_quality = 'production' to exclude legacy/test signals.
 */

import { db } from '../db';
import { sql } from 'drizzle-orm';

// ─── Month Win Count ──────────────────────────────────────────────────────────

/**
 * Returns the number of winning trades (TP hit) this calendar month (UTC).
 */
export async function getMonthWinCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM signal_history
    WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')
      AND data_quality = 'production'
      AND outcome_time >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
  `);
  return ((result as any)[0]?.count as number) ?? 0;
}

// ─── Month Loss Count ─────────────────────────────────────────────────────────

/**
 * Returns the number of losing trades (stop hit) this calendar month (UTC).
 */
export async function getMonthLossCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM signal_history
    WHERE outcome = 'STOP_HIT'
      AND data_quality = 'production'
      AND outcome_time >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
  `);
  return ((result as any)[0]?.count as number) ?? 0;
}

// ─── Month Net Pips ───────────────────────────────────────────────────────────

/**
 * Returns the net pip total for live trades this calendar month (UTC).
 * Positive = net winning month, negative = net losing month.
 */
export async function getMonthNetPips(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(SUM(profit_loss_pips), 0)::float AS net_pips
    FROM signal_history
    WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')
      AND data_quality = 'production'
      AND trade_live = true
      AND outcome_time >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
  `);
  return ((result as any)[0]?.net_pips as number) ?? 0;
}

// ─── Current Streak ───────────────────────────────────────────────────────────

/**
 * Returns the current consecutive win or loss streak for live production signals.
 * Positive integer = win streak (e.g. +3 = 3 wins in a row)
 * Negative integer = loss streak (e.g. -2 = 2 losses in a row)
 * Zero = no resolved signals yet
 */
export async function getCurrentStreak(): Promise<number> {
  const result = await db.execute(sql`
    SELECT outcome
    FROM signal_history
    WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')
      AND data_quality = 'production'
      AND trade_live = true
    ORDER BY outcome_time DESC
    LIMIT 20
  `);

  const rows = result as any[];
  if (!rows.length) return 0;

  const firstIsWin = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(rows[0].outcome);
  let streak = 0;

  for (const row of rows) {
    const isWin = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(row.outcome);
    if (isWin === firstIsWin) {
      streak++;
    } else {
      break;
    }
  }

  return firstIsWin ? streak : -streak;
}

// ─── Signal Number ────────────────────────────────────────────────────────────

/**
 * Returns the sequential signal number for a given signal_id.
 * e.g. "Signal #47" — the 47th production signal tracked since the system started.
 * Counts all production signals created at or before this signal's created_at.
 * Includes EXPIRED signals (they occupied a slot in time).
 */
export async function getSignalNumber(signalId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS signal_number
    FROM signal_history
    WHERE data_quality = 'production'
      AND created_at <= (
        SELECT created_at
        FROM signal_history
        WHERE signal_id = ${signalId}
        LIMIT 1
      )
  `);
  return ((result as any)[0]?.signal_number as number) ?? 1;
}

// ─── Week Stats ───────────────────────────────────────────────────────────────

/**
 * Returns aggregated stats for the current calendar week (Monday–Sunday UTC).
 * Used for the weekly summary Telegram post every Friday at 22:00 UTC.
 */
export async function getWeekStats(): Promise<{
  wins: number;
  losses: number;
  expired: number;
  netPips: number;
}> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT'))::int AS wins,
      COUNT(*) FILTER (WHERE outcome = 'STOP_HIT')::int                          AS losses,
      COUNT(*) FILTER (WHERE outcome = 'EXPIRED')::int                           AS expired,
      COALESCE(
        SUM(profit_loss_pips) FILTER (
          WHERE trade_live = true
            AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')
        ),
        0
      )::float AS net_pips
    FROM signal_history
    WHERE data_quality = 'production'
      AND outcome_time >= DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC')
      AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'EXPIRED')
  `);

  const row = (result as any)[0] ?? {};
  return {
    wins:    row.wins    ?? 0,
    losses:  row.losses  ?? 0,
    expired: row.expired ?? 0,
    netPips: row.net_pips ?? 0,
  };
}

// ─── All-Time Total Signal Count ─────────────────────────────────────────────

/**
 * Returns the total number of production signals tracked all-time.
 * Used in weekly/monthly summaries: "47 signals tracked all-time".
 */
export async function getTotalSignalCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM signal_history
    WHERE data_quality = 'production'
  `);
  return ((result as any)[0]?.total as number) ?? 0;
}

// ─── Day Stats ────────────────────────────────────────────────────────────────

export interface DaySignalResult {
  symbol: string;
  type: 'LONG' | 'SHORT';
  outcome: string;
  profitLossPips: number;
}

/**
 * Returns all signals that resolved today (UTC) — wins, losses, and expiries.
 * Used for the daily close summary posted every day at 22:00 UTC.
 */
export async function getDayStats(): Promise<{
  resolved: DaySignalResult[];
  newSignals: number;
}> {
  // Signals that closed today
  const resolvedResult = await db.execute(sql`
    SELECT symbol, type, outcome, profit_loss_pips
    FROM signal_history
    WHERE data_quality = 'production'
      AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'EXPIRED')
      AND outcome_time >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    ORDER BY outcome_time ASC
  `);

  // New signals generated today (regardless of outcome)
  const newResult = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM signal_history
    WHERE data_quality = 'production'
      AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
  `);

  const resolved = (resolvedResult as any[]).map(r => ({
    symbol:         r.symbol as string,
    type:           r.type as 'LONG' | 'SHORT',
    outcome:        r.outcome as string,
    profitLossPips: Number(r.profit_loss_pips ?? 0),
  }));

  return {
    resolved,
    newSignals: ((newResult as any)[0]?.count as number) ?? 0,
  };
}

import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, timestamp, jsonb, integer, boolean, numeric, index, uniqueIndex, bigserial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password"), // nullable for Google OAuth users
  role: text("role").notNull().default('user'), // 'admin' or 'user' - defaults to 'user'
  googleId: text("google_id").unique(), // for Google OAuth
  resetPasswordToken: text("reset_password_token"),
  resetPasswordExpires: timestamp("reset_password_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const savedSignals = pgTable("saved_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  signalData: jsonb("signal_data").notNull(), // Store entire signal object
  candles: jsonb("candles"), // Store candle data
  savedAt: timestamp("saved_at").defaultNow().notNull(),
});

/**
 * signal_history — the trade record. 44 columns.
 *
 * ⚠️ DO NOT RUN `npm run db:push` AGAINST PRODUCTION WITHOUT A DIFF REVIEW.
 * This table already exists in Supabase with 1,527 live rows and 16 indexes. It was created
 * by hand-run SQL migrations, NOT by Drizzle, and was absent from this file until 2026-08-27.
 * `drizzle-kit push` reconciles the DB to this definition — if anything here is even slightly
 * off (a type, a default, a nullability), push can ALTER or DROP live columns.
 *
 * This definition exists for type-safe queries and so the table is finally visible to
 * migration tooling. Treat it as read-only documentation until a `drizzle-kit generate`
 * diff has been reviewed line by line against the live schema.
 *
 * The partial unique index below already exists in the DB as
 * `signal_history_one_pending_per_symbol`. It prevents two CONCURRENT pending signals for a
 * symbol — it does NOT prevent sequential re-entry after a trade resolves, which is the
 * actual duplicate pattern (303 raw rows collapse to 70 real trades). That needs a cooldown
 * in signal-generator.ts, not a constraint here.
 */
export const signalHistory = pgTable("signal_history", {
  id: varchar("id").primaryKey().default(sql`(gen_random_uuid())::text`),
  signalId: text("signal_id").notNull().unique(),
  userId: varchar("user_id"),

  symbol: text("symbol").notNull(),
  type: text("type").notNull(),                       // 'LONG' | 'SHORT'
  confidence: integer("confidence").notNull(),        // raw points on the 130-pt scale
  entryPrice: numeric("entry_price", { precision: 10, scale: 5 }).notNull(),
  currentPrice: numeric("current_price", { precision: 10, scale: 5 }).notNull(),
  stopLoss: numeric("stop_loss", { precision: 10, scale: 5 }).notNull(),
  tp1: numeric("tp1", { precision: 10, scale: 5 }).notNull(),
  tp2: numeric("tp2", { precision: 10, scale: 5 }).notNull(),                      // never recorded — validator can only emit TP1_HIT/STOP_HIT
  tp3: numeric("tp3", { precision: 10, scale: 5 }).notNull(),                      // never recorded — see above
  stopLimitPrice: numeric("stop_limit_price", { precision: 10, scale: 5 }),
  orderType: text("order_type").notNull(),            // says 'Buy Limit' but executors send MARKET
  executionType: text("execution_type").notNull(),

  strategyName: text("strategy_name").notNull(),
  strategyVersion: text("strategy_version").notNull(),

  outcome: text("outcome").default('PENDING'),        // PENDING|TP1_HIT|STOP_HIT|EXPIRED|MANUALLY_CLOSED
  outcomePrice: numeric("outcome_price", { precision: 10, scale: 5 }),
  outcomeTime: timestamp("outcome_time", { withTimezone: true }),
  profitLossPips: numeric("profit_loss_pips", { precision: 10, scale: 2 }),
  manuallyClosedByUser: boolean("manually_closed_by_user").default(false),

  indicators: jsonb("indicators").notNull(),
  candles: jsonb("candles").notNull(),                // ⚠️ overwritten at outcome time — see audit

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).default(sql`(now() + '48:00:00'::interval)`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),

  tier: text("tier").default('HIGH'),                 // HIGH >= 90 | MEDIUM 70-89
  tradeLive: boolean("trade_live").default(true),
  positionSizePercent: numeric("position_size_percent", { precision: 3, scale: 2 }).default('1.00'),

  partialClose1Price: numeric("partial_close_1_price", { precision: 10, scale: 5 }),   // never written
  partialClose1Time: timestamp("partial_close_1_time", { withTimezone: true }),
  partialClose1Pips: numeric("partial_close_1_pips", { precision: 10, scale: 2 }),
  stopMovedToBreakeven: boolean("stop_moved_to_breakeven").default(false),
  breakevenStopPrice: numeric("breakeven_stop_price", { precision: 10, scale: 5 }),

  dataQuality: text("data_quality").default('production'), // 'production' | 'legacy'

  entrySlippage: numeric("entry_slippage", { precision: 10, scale: 2 }).default('0.0'), // never populated → grader is inert
  exitSlippage: numeric("exit_slippage", { precision: 10, scale: 2 }).default('0.0'),
  fillLatency: integer("fill_latency").default(0),

  breakEvenTime: timestamp("break_even_time", { withTimezone: true }),
  maxAdverseExcursion: numeric("max_adverse_excursion", { precision: 10, scale: 2 }),
  maxFavorableExcursion: numeric("max_favorable_excursion", { precision: 10, scale: 2 }),

  session: varchar("session"),
  volatilityLevel: varchar("volatility_level"),

  // --- Added 2026-08-27 by migrations/2026-08-27_outcome_validation_repair.sql ---
  // Corrections from window-anchored 5-minute replay. Originals above are preserved
  // so the size of the validation error stays provable.
  correctedOutcome: text("corrected_outcome"),
  correctedOutcomePrice: numeric("corrected_outcome_price"),
  correctedOutcomeTime: timestamp("corrected_outcome_time", { withTimezone: true }),
  correctedProfitLossPips: numeric("corrected_profit_loss_pips"),
  // Excursions in R units (R = |entry - stop_loss|), measured across the FULL window
  // regardless of when the trade resolved — this is what decides whether TP2 (4R) and
  // TP3 (6R) were ever reachable.
  correctedMfeR: numeric("corrected_mfe_r"),
  correctedMaeR: numeric("corrected_mae_r"),
  validationMethod: text("validation_method"),
  // Throttle marker for the window-replay validator. Persisted rather than in-memory
  // because Render's free tier restarts constantly — the same reason the old in-memory
  // daily-trade counter never actually enforced its limit.
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  // Outcome-window candles live here so `candles` can stay the pre-signal window.
  outcomeCandles: jsonb("outcome_candles"),
}, (t) => ({
  symbolIdx: index("idx_signal_history_symbol").on(t.symbol),
  createdAtIdx: index("idx_signal_history_created_at").on(t.createdAt),
  outcomeIdx: index("idx_signal_history_outcome").on(t.outcome),
  dataQualityIdx: index("idx_signal_history_data_quality").on(t.dataQuality),
  onePendingPerSymbol: uniqueIndex("signal_history_one_pending_per_symbol")
    .on(t.symbol, t.type)
    .where(sql`outcome = 'PENDING' AND data_quality = 'production'`),
}));

export type SignalHistoryRow = typeof signalHistory.$inferSelect;
export type InsertSignalHistory = typeof signalHistory.$inferInsert;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
}).extend({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z.string().min(3, "Username must be at least 3 characters"),
});

export const insertSavedSignalSchema = createInsertSchema(savedSignals).pick({
  userId: true,
  signalData: true,
  candles: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SavedSignal = typeof savedSignals.$inferSelect;
export type InsertSavedSignal = z.infer<typeof insertSavedSignalSchema>;

/**
 * Exact inputs to each analyze() call — including bars that did NOT fire.
 *
 * Added 2026-08-29. The backtest reproduction gate topped out at 80-85% because production
 * recorded results but never inputs: `created_at` is the INSERT time (lagging analysis by a
 * measured 0-16 min), the Twelve Data cache key omitted `outputsize` until 5895423, and the
 * fetcher falls back to UNBOUNDED stale cache on HTTP 429 — two signals 23h apart once carried
 * byte-identical indicators. With this table, reproduction is verifiable rather than inferred.
 *
 * Mirrors db/manual/2026-08-29_signal_provenance.sql. Do NOT run `db:push` against this — the
 * SQL file is the source of truth (push is destructive on numeric precision elsewhere).
 */
export const signalProvenance = pgTable("signal_provenance", {
  id: bigserial("id", { mode: "number" }).primaryKey(),

  /** The asOf handed to analyze(). This is what created_at failed to be. */
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull(),
  symbol: text("symbol").notNull(),
  strategyVersion: text("strategy_version").notNull(),

  produced: boolean("produced").notNull(),
  signalId: text("signal_id"),                        // by convention -> signal_history.signal_id
  confidence: integer("confidence"),
  rejectionReason: text("rejection_reason"),          // ADX_BELOW_THRESHOLD, NO_ENTRY_SIGNAL, ...

  /** Per timeframe: {count, firstTs, lastTs, last:{o,h,l,c}, sha256} over the ordered array. */
  inputs: jsonb("inputs").notNull(),
  /** Per timeframe: {source: live|cache|stale-cache, ageMinutes}. */
  cacheMeta: jsonb("cache_meta"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  symbolTimeIdx: index("idx_signal_provenance_symbol_time").on(t.symbol, t.analyzedAt),
  signalIdIdx: index("idx_signal_provenance_signal_id").on(t.signalId),
  producedIdx: index("idx_signal_provenance_produced").on(t.produced, t.analyzedAt),
}));

import { db } from '../db';
import { sql } from 'drizzle-orm';
import { API_ENDPOINTS } from '../../client/src/config/api';
import { twelveDataAPI } from './twelve-data';
import { telegramNotifier } from './telegram-notifier';
import { getMonthWinCount, getMonthLossCount, getMonthNetPips, getCurrentStreak, getSignalNumber } from './signal-stats';
import { sessionAnalyzer } from './session-analyzer';
import { reachesExpiry } from './outcome-path';
import { syncBrokerDeals } from './broker-deals';

/**
 * Outcome Validator Service
 * Runs every 5 minutes to check if pending signals hit TP1 or Stop Loss
 *
 * v2.0.0: Uses candle HIGH/LOW from Twelve Data for outcome detection
 * - Industry-standard approach: check candle extremes, not just close price
 * - LONG TP1: any candle HIGH >= tp1 (after signal creation)
 * - LONG SL: any candle LOW <= stop_loss (after signal creation)
 * - SHORT TP1: any candle LOW <= tp1 (after signal creation)
 * - SHORT SL: any candle HIGH >= stop_loss (after signal creation)
 * - Ambiguous (both hit same candle): SL assumed first (conservative)
 */

interface PendingSignal {
  id: string;
  signal_id: string;
  user_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tier: 'HIGH' | 'MEDIUM';
  trade_live: boolean;
  created_at: Date;
  expires_at: Date;
}

// Helper: Check if forex market is open (duplicated from signal-generator for isolation)
function isForexMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && hour >= 22) return false;
  return true;
}

export class OutcomeValidator {
  private isRunning = false;
  private lastRunTime = 0;

  /**
   * Get the timestamp of the last successful run
   */
  getLastRunTime(): number {
    return this.lastRunTime;
  }

  /**
   * Main validation loop - checks all pending signals
   */
  async validatePendingSignals(): Promise<void> {
    if (this.isRunning) {
      console.log('⏭️  Validator already running, skipping...');
      return;
    }

    this.isRunning = true;
    this.lastRunTime = Date.now();
    console.log('🔍 [Outcome Validator] Starting validation cycle...');

    // 🛡️ MARKET HOURS GATE: No point validating when market is closed and prices aren't moving
    if (!isForexMarketOpen()) {
      console.log('⏭️  Forex market closed - skipping outcome validation');
      this.isRunning = false;
      return;
    }

    try {
      // 0. Backstop first — close anything unresolvable before it can block a symbol.
      await this.closeUnresolvableSignals();

      // 0.5 Complete any resolution path that stops short of its window.
      //
      // Deliberately placed BEFORE the pending-signal fetch: that path returns early when there
      // is nothing pending, which is the ordinary state, so anything after it would rarely run.
      await this.completeResolutionPaths();

      // 0.6 Pull the broker's own deal history, so realised fills and P&L land without anyone
      // remembering to press a button. Same placement rationale as 0.5.
      await this.syncBrokerGroundTruth();

      // 1. Fetch all PENDING signals
      const pendingSignals = await this.fetchPendingSignals();

      if (!pendingSignals || !Array.isArray(pendingSignals)) {
        console.log('⚠️  No pending signals data returned');
        return;
      }

      console.log(`📊 Found ${pendingSignals.length} pending signals`);

      if (pendingSignals.length === 0) {
        console.log('✅ No pending signals to validate');
        return;
      }

      // 2. Check each signal using candle HIGH/LOW (industry-standard approach)
      let updated = 0;
      let expired = 0;

      for (const signal of pendingSignals) {
        try {
          // NOTE: there is deliberately NO wall-clock expiry check here.
          //
          // The previous implementation asked "is this past 48h RIGHT NOW?" and, if so,
          // marked it EXPIRED and `continue`d — so the candle scan was unreachable and the
          // question "did price hit TP or SL during those 48 hours?" was never asked.
          // Combined with the weekend gate (validation skipped Fri 22:00 → Sun 22:00 UTC),
          // any signal created Wed–Fri could expire while the gate was shut and be recorded
          // EXPIRED regardless of what price actually did.
          //
          // checkOutcomeFromCandles now scans the FULL created_at → expires_at window and
          // only returns EXPIRED when the window has both elapsed AND produced no touch.
          const result = await this.checkOutcomeFromCandles(signal);

          // Stamp the attempt BEFORE acting on the result, so a signal that repeatedly
          // fails to resolve still advances the throttle and cannot be re-fetched every
          // 5 minutes forever.
          await this.markValidationAttempt(signal.signal_id);

          if (result) {
            await this.updateSignalOutcome(
              signal, result.outcome, result.outcomePrice, result.outcomeTime,
              result.mfeR, result.maeR
            );
            if (result.outcome === 'EXPIRED') expired++; else updated++;
          }
          // result === null means genuinely still open — leave it PENDING.
        } catch (signalError) {
          console.error(`❌ Error processing signal ${signal.signal_id}:`, signalError);
          // Continue processing remaining signals even if one fails
        }
      }

      console.log(`✅ Validation complete: ${updated} updated, ${expired} expired`);

    } catch (error) {
      console.error('❌ [Outcome Validator] Error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Fetch all signals with PENDING outcome
   */
  private async fetchPendingSignals(): Promise<PendingSignal[]> {
    // THROTTLE — this is a hard quota constraint, not an optimisation.
    //
    // Each signal now costs one UNCACHED Twelve Data call per check (the window replay
    // cannot reuse the generator's shared cache, because every window is different).
    // Unthrottled that is (pending signals) x 288 runs/day on a 5-minute cron:
    //   3 concurrent signals  -> 864 calls/day, already over the 800/day free tier
    //  24 concurrent (steady state at a 4h cooldown with 48h expiry) -> ~6,900/day
    // And quota exhaustion degrades SILENTLY — twelve-data.ts falls back to stale cache
    // with no maximum age, so a signal would be resolved against days-old prices.
    //
    // With this throttle the cost is ~13 calls per signal over its whole 48h life
    // (12 periodic + 1 final), i.e. roughly 150/day at current signal rates.
    //
    // A signal is checked when it has never been checked, or when the interval has elapsed.
    //
    // NOTE: an earlier draft added `OR expires_at <= NOW()` to guarantee a final check.
    // That reintroduced the exact bug this throttle exists to prevent: an expired signal
    // that cannot be resolved (no candle data for its window — a weekend or a market
    // holiday) satisfies that clause on EVERY cycle forever, burning one uncached API call
    // every 5 minutes indefinitely. The bypass is unnecessary anyway: expiry is 48h and the
    // throttle is 4h, so a signal is checked ~12 times over its life and the first check
    // after `expires_at` resolves it definitively.
    const VALIDATION_INTERVAL_MINUTES = 240;

    // ORDER BY expires_at ASC — oldest-expiring first, NOT newest-first. With `LIMIT 20`,
    // ordering by `created_at DESC` would let a backlog of fresh signals permanently starve
    // the oldest ones, which are precisely the trades waiting on a final resolution.
    const result = await db.execute(sql`
      SELECT
        id, signal_id, user_id, symbol, type,
        entry_price, stop_loss, tp1, tp2, tp3,
        tier, trade_live, created_at, expires_at
      FROM signal_history
      WHERE outcome = 'PENDING'
        AND data_quality = 'production'
        AND (
          last_validated_at IS NULL
          OR last_validated_at < NOW() - (${VALIDATION_INTERVAL_MINUTES} || ' minutes')::interval
        )
      ORDER BY expires_at ASC
      LIMIT 20
    `);

    return result as any[];
  }

  /**
   * Complete resolution paths that stop short of their window.
   *
   * `outcome_candles` is written when a trade RESOLVES, clamped to `now` — so a signal that stops
   * out after two hours stores two hours, and the remaining 46 have not happened yet. That is the
   * ordinary shape of every forward row, and a path ending where the CURRENT stop fired cannot
   * answer what a wider stop or a breakeven would have done: the evidence stops exactly where the
   * counterfactual starts. Storing the path at all is pointless without this step.
   *
   * `scripts/backfill-outcome-paths.ts` does the same work by hand. It has to keep existing for
   * back-dated repair, but relying on someone remembering to run it loses data on a DEADLINE:
   * the free tier stops serving 5-minute history for old dates (measured — June rows return 13.6h
   * of a 48h window), so an un-completed tail becomes permanently unrecoverable.
   *
   * Budget: one API call per row completed, and zero when there is nothing to do. Guarded by a
   * per-run cap, a 30-day floor (older rows can no longer be filled, so retrying them would spend
   * a call per run forever), and a kill-zone check so this never competes with signal generation
   * for the shared Twelve Data key.
   */
  private async completeResolutionPaths(): Promise<void> {
    const MAX_PER_RUN = 3;

    try {
      if (sessionAnalyzer.isInKillZone()) return;

      const rows = (await db.execute(sql`
        SELECT signal_id, symbol, created_at, expires_at, outcome_candles
        FROM signal_history
        WHERE data_quality = 'production'
          AND expires_at < NOW()
          AND created_at >= NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
      `)) as any[];

      const todo = rows.filter(
        r => !reachesExpiry(r.outcome_candles, new Date(r.expires_at), new Date(r.created_at))
      );
      if (todo.length === 0) return;

      console.log(`🧩 Completing ${Math.min(todo.length, MAX_PER_RUN)} of ${todo.length} truncated resolution path(s)`);

      for (const r of todo.slice(0, MAX_PER_RUN)) {
        try {
          const start = new Date(Math.floor(new Date(r.created_at).getTime() / 300_000) * 300_000);
          const bars = await twelveDataAPI.fetchCandlesInWindow(
            r.symbol, '5min', start, new Date(r.expires_at)
          );

          // Array.isArray, not `.length === 0` — a STRING also has a length, and storing one
          // yields a jsonb string scalar that every `Array.isArray` consumer skips in silence.
          //
          // Note the UPDATE below carries NO `::jsonb` cast, matching updateSignalOutcome above.
          // An explicit cast is what makes a driver bind the payload as a JSON *string scalar*
          // (`"[{...}]"` rather than `[{...}]`); that is how the backfill silently wrote one bad
          // row before `hasPath` started checking Array.isArray. This path is already proven to
          // store a jsonb array — every production row it wrote reads back as `array`.
          if (!Array.isArray(bars) || bars.length === 0) {
            console.warn(`⚠️  No bars to complete ${r.signal_id} (${r.symbol})`);
            continue;
          }

          await db.execute(sql`
            UPDATE signal_history
            SET outcome_candles = ${JSON.stringify(bars)}, updated_at = NOW()
            WHERE signal_id = ${r.signal_id}
          `);
          console.log(`✅ Completed path for ${r.signal_id}: ${bars.length} bars`);
        } catch (e: any) {
          console.error(`⚠️  Could not complete path for ${r.signal_id}:`, e?.message ?? e);
        }
      }
    } catch (e) {
      // Never let this stop outcome validation — it is data enrichment, not a trade decision.
      console.error('⚠️  Resolution-path completion failed:', e);
    }
  }

  /**
   * Fold the broker's own record of fills and closes into our database.
   *
   * Every win/loss figure this system reports is MODELLED from candles. This is the only thing
   * that can falsify the model: what actually filled, at what price, and what the position really
   * earned after swap and commission — costs the model does not carry at all. Measured on the
   * first real round trip (position 286152195): gross -0.31 with commission -0.10, so a THIRD of
   * the loss was cost the model would never have seen.
   *
   * Run here rather than on its own schedule for the same reason path completion is: this cron
   * already fires every 5 minutes, so nothing new has to be registered, and a manual button is a
   * button somebody has to remember to press.
   *
   * Cheap when idle — the sync is watermarked, so an interval with no new deals is one short
   * request. Skipped inside kill zones so it never competes with signal generation, and every
   * failure is swallowed: this is bookkeeping and must never disturb outcome validation.
   */
  private async syncBrokerGroundTruth(): Promise<void> {
    try {
      if (sessionAnalyzer.isInKillZone()) return;

      // A bounded bite of history per tick. The watermark advances, so a cold start converges
      // over a couple of hours unattended rather than trying to pull a year in one pass.
      const r = await syncBrokerDeals({ maxSpanMs: 14 * 24 * 60 * 60 * 1000 });
      if (r.dealsSeen > 0 || r.closesApplied > 0) {
        console.log(`🧾 Broker deals: ${r.dealsSeen} seen, ${r.dealsStored} stored, ${r.closesApplied} close(s) applied`);
      }
    } catch (e: any) {
      // Includes the ordinary case of cTrader not being configured at all.
      console.error('⚠️  Broker deal sync failed:', e?.message ?? e);
    }
  }

  /**
   * BACKSTOP: force-close signals that can never resolve.
   *
   * Deleting markAsExpired() removed the only GUARANTEED terminal transition out of
   * PENDING. Every remaining path requires fetchCandlesInWindow to return a non-empty
   * array — so a 429, a 5xx, a symbol with no free-tier history for that date range, or a
   * malformed datetime leaves the row PENDING *forever*, retried every interval in
   * perpetuity.
   *
   * That is not merely wasteful. The signal generator's dedup selects
   * `outcome = 'PENDING' AND data_quality = 'production'` with no age bound, so ONE stuck
   * row permanently suppresses every future signal for that symbol. With only EUR/USD and
   * USD/CHF live, two stuck rows silently shut the entire system down while every health
   * check stays green.
   *
   * Anything still PENDING a week past its 48-hour expiry is unresolvable by definition.
   * Close it, mark it so it is excluded from win-rate maths, and never notify — these are
   * bookkeeping closures, not trade outcomes.
   */
  private async closeUnresolvableSignals(): Promise<void> {
    try {
      const result = await db.execute(sql`
        UPDATE signal_history
        SET outcome = 'EXPIRED',
            outcome_time = expires_at,
            validation_method = 'unresolvable-backstop',
            updated_at = NOW()
        WHERE outcome = 'PENDING'
          AND expires_at < NOW() - INTERVAL '7 days'
        RETURNING signal_id
      `);
      const rows = result as any[];
      if (rows.length > 0) {
        console.warn(`🧹 Backstop closed ${rows.length} unresolvable PENDING signal(s): ${rows.map(r => r.signal_id).join(', ')}`);
      }
    } catch (e) {
      console.error('⚠️  Unresolvable-signal backstop failed:', e);
    }
  }

  /**
   * Stamp a signal as checked, so the throttle above can see it.
   * Written even when the signal does not resolve — that is the entire point.
   */
  private async markValidationAttempt(signalId: string): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE signal_history SET last_validated_at = NOW() WHERE signal_id = ${signalId}
      `);
    } catch (e) {
      console.error(`⚠️  Could not stamp last_validated_at for ${signalId}:`, e);
    }
  }

  /**
   * Resolve a signal's outcome by replaying the EXACT trade window on 5-minute candles.
   *
   * Replaces the previous implementation, which was unreliable in four separate ways.
   * Each is fixed here deliberately — do not "simplify" any of them back:
   *
   *  1. WINDOW ANCHORING. The old code fetched "the most recent 200 1H candles" and
   *     filtered `timestamp > created_at`. Those bars are not tied to the trade at all,
   *     so for an old signal it scanned bars from long AFTER expiry, and — combined with
   *     datetimes parsed as host-local rather than UTC — could scan PRE-signal action as
   *     though it were post-signal. Verified consequence: USD/CHF LONG 2026-06-19 was
   *     recorded STOP_HIT at 0.80473 five minutes after creation, when across the whole
   *     48h window price never went below 0.80537. The loss never happened.
   *     Now: `fetchCandlesInWindow(created_at → min(now, expires_at))`, explicit UTC.
   *
   *  2. ENTRY BAR. The old filter used `>`, excluding the signal's own bar and hiding up
   *     to 59 minutes of post-entry action. That loss was ASYMMETRIC: the stop sits at
   *     ~half TP1's distance, so what went missing was mostly stop-outs. The window start
   *     is now floored to the bar boundary so the entry bar is included.
   *
   *  3. GRANULARITY. 1H bars make TP-and-SL-in-one-bar common. 5-minute bars make a
   *     4.5×ATR ambiguous range rare (the "bar magnifier" approach).
   *
   *  4. AMBIGUITY RULE. When one bar touches both levels, the old code guessed from
   *     candle body direction (`close >= open`) — which scores a bar that dipped to the
   *     stop, reversed and closed up as a WIN, and contradicted this file's own header.
   *     Now: STOP FIRST, always. It is the only assumption that cannot flatter the record.
   *
   * Returns null when the trade is genuinely still open (window not yet elapsed, no touch).
   * Returns EXPIRED only after the FULL window has been scanned and elapsed.
   */
  private async checkOutcomeFromCandles(
    signal: PendingSignal
  ): Promise<{
    outcome: 'TP1_HIT' | 'STOP_HIT' | 'EXPIRED';
    outcomePrice: number;
    outcomeTime: Date;
    mfeR: number;
    maeR: number;
  } | null> {
    try {
      const createdAt = new Date(signal.created_at);
      const expiresAt = new Date(signal.expires_at);
      const now = new Date();

      // Floor to the 5-minute boundary so the ENTRY BAR is included.
      const windowStart = new Date(Math.floor(createdAt.getTime() / 300_000) * 300_000);
      const windowEnd = new Date(Math.min(now.getTime(), expiresAt.getTime()));
      const fullyElapsed = now.getTime() >= expiresAt.getTime();

      if (windowEnd.getTime() <= windowStart.getTime()) return null;

      const candles = await twelveDataAPI.fetchCandlesInWindow(
        signal.symbol, '5min', windowStart, windowEnd
      );

      if (!candles || candles.length === 0) {
        // Empty window is normal over a weekend/gap. Only conclude EXPIRED once the
        // window has elapsed AND we still have no data — never on a wall-clock check alone.
        if (fullyElapsed) {
          console.warn(`⚠️  ${signal.signal_id}: window elapsed with no candle data — cannot resolve honestly`);
        }
        return null;
      }

      const isLong = signal.type === 'LONG';
      const entry = Number(signal.entry_price);
      const stop = Number(signal.stop_loss);
      const target = Number(signal.tp1);
      const R = Math.abs(entry - stop);

      // Excursions are tracked across the WHOLE window, not just up to resolution, so
      // they answer "how far could this have run" — which is what decides whether TP2 (4R)
      // and TP3 (6R) are reachable at all. (Neither has ever been recorded, because the
      // old implementation could only ever emit TP1_HIT or STOP_HIT.)
      let mfeR = 0;
      let maeR = 0;
      let resolved: { outcome: 'TP1_HIT' | 'STOP_HIT'; outcomePrice: number; outcomeTime: Date } | null = null;

      for (const c of candles) {
        // Twelve Data's end_date is INCLUSIVE, so the bar opening exactly at expires_at
        // comes back in the window. Without this guard a stop touched up to 4:59 AFTER
        // expiry would be recorded as STOP_HIT instead of EXPIRED.
        if (c.timestamp.getTime() >= expiresAt.getTime()) break;

        const favourable = isLong ? c.high - entry : entry - c.low;
        const adverse = isLong ? entry - c.low : c.high - entry;
        if (R > 0) {
          if (favourable / R > mfeR) mfeR = favourable / R;
          if (adverse / R > maeR) maeR = adverse / R;
        }

        if (resolved) continue; // keep measuring excursions, stop deciding

        const slHit = isLong ? c.low <= stop : c.high >= stop;
        const tpHit = isLong ? c.high >= target : c.low <= target;

        // CONSERVATIVE: stop first on an ambiguous bar. Never flatter the record.
        if (slHit) {
          // Record the price actually AVAILABLE, not the level. On a weekend or news gap
          // through the stop, the bar opens beyond it and the real fill is that open —
          // recording `stop` understates the loss, which is precisely the "never flatter
          // the record" principle the ambiguity rule above invokes.
          const fill = isLong ? Math.min(stop, c.open) : Math.max(stop, c.open);
          resolved = { outcome: 'STOP_HIT', outcomePrice: fill, outcomeTime: c.timestamp };
          if (fill !== stop) {
            console.log(`⚠️  ${signal.signal_id}: gapped through stop — filled ${fill} vs level ${stop}`);
          }
          if (tpHit) {
            console.log(`⚠️  ${signal.signal_id}: ambiguous bar (both levels touched) → STOP_HIT (conservative)`);
          }
        } else if (tpHit) {
          // Symmetric treatment, but a favourable gap can only help — cap at the level so a
          // gap beyond TP is not counted as extra profit we would not reliably capture.
          const fill = isLong ? Math.max(target, c.open) : Math.min(target, c.open);
          resolved = { outcome: 'TP1_HIT', outcomePrice: fill, outcomeTime: c.timestamp };
        }
      }

      if (resolved) {
        return { ...resolved, mfeR, maeR };
      }

      // Neither level touched. Only now is EXPIRED a truthful answer — and only if the
      // window has actually elapsed. Use the real closing price, not the entry price:
      // an expired trade closed at SOME market price, and asserting it ended flat
      // destroys information that cannot be recovered later.
      if (fullyElapsed) {
        const lastCandle = candles[candles.length - 1];
        return {
          outcome: 'EXPIRED',
          outcomePrice: lastCandle.close,
          outcomeTime: expiresAt,
          mfeR,
          maeR,
        };
      }

      return null; // still genuinely open

    } catch (error) {
      console.error(`❌ Error resolving outcome for ${signal.signal_id}:`, error);
      return null; // fail closed — never guess an outcome
    }
  }

  /**
   * Fetch the candles that actually cover the trade, entry → exit.
   *
   * REWRITTEN 2026-08-27. Despite its name, the previous version did NOT fetch the trade's
   * window: it called `fetchHistoricalCandles(symbol, interval, N)` — "the most recent N
   * bars" — and then `.slice(-200)`. For a trade resolved days earlier the returned bars
   * could overlap the trade barely or not at all. That is the same "not anchored to the
   * trade" defect that made outcome validation fabricate losses, and it silently fed both
   * the winning-trades chart and the MAE/MFE calculation.
   *
   * It also derived `outputsize` from the trade's duration, producing a near-unique cache
   * key per signal (`EUR/USD-15min-102`, `-106`, …) now that outputsize is part of the key —
   * a guaranteed cache miss every time plus unbounded key growth in node-persist.
   *
   * Returns null (NOT []) on failure, so callers can distinguish "no data" from "empty
   * result" — `??` does not treat [] as absent.
   */
  private async fetchTradeDurationCandles(
    signal: PendingSignal,
    resolutionTime: Date
  ): Promise<any[] | null> {
    try {
      const createdAt = new Date(signal.created_at);
      const windowStart = new Date(Math.floor(createdAt.getTime() / 300_000) * 300_000);
      const expiresAt = new Date(signal.expires_at);

      // The window runs to EXPIRY, not to the resolution time.
      //
      // It used to stop at `min(resolutionTime, expiresAt)`, which is the same defect the
      // backtest engine had: a path that ends the moment the CURRENT stop fired cannot answer
      // "what would a wider stop, a breakeven, or an earlier target have done?" — the evidence
      // is truncated exactly where the counterfactual begins. Every signal collected that way is
      // permanently unable to support an exit-rule question.
      //
      // Clamped to `now` as well, because a trade can resolve hours before it expires and the
      // rest of the window has not happened yet. `backfill-outcome-paths.ts` completes those
      // once expiry has passed; it is idempotent and safe to re-run.
      const windowEnd = new Date(Math.min(Date.now(), expiresAt.getTime()));

      if (!(windowEnd.getTime() > windowStart.getTime())) return null;

      // 5min, not 15min. 15min was chosen for chart resolution; the engine resolves stops and
      // targets on 5-minute bars, so anything coarser cannot reproduce its decisions. This costs
      // NOTHING extra: fetchCandlesInWindow is a single API call that increments the usage
      // counter once, whatever the bar count. 48h of 5min is ~576 bars in that one call.
      const candles = await twelveDataAPI.fetchCandlesInWindow(
        signal.symbol, '5min', windowStart, windowEnd
      );

      if (candles && candles.length > 0) {
        console.log(`✅ Fetched ${candles.length} trade-window candles for ${signal.signal_id}`);
        return candles;
      }

      console.warn(`⚠️  No trade-window candles for ${signal.symbol} (${signal.signal_id})`);
      return null;

    } catch (error) {
      console.error(`❌ Error fetching trade-window candles:`, error);
      return null;
    }
  }

  // generateDemoCandles() was REMOVED on 2026-08-27.
  //
  // It fabricated a random price path walking from signal.entry_price to the KNOWN
  // outcomePrice, and wrote it into the `candles` column. Any row resolved while it was the
  // active fallback (2025-12-03 `275282f` -> 2026-02-22 `b6f13cb`) therefore has a candle
  // series that literally encodes its own outcome. Running indicators over that data is
  // reading the answer key, which is one reason no backtest from this repo can be trusted.
  //
  // It was already unreachable at HEAD. Deleted so it can never be wired back in.
  // (Note: server/routes/signals.ts has a SEPARATE generateDemoCandles() used for
  // hardcoded demo rows — that one is unrelated and still in use.)

  /**
   * Update signal with outcome
   */
  private async updateSignalOutcome(
    signal: PendingSignal,
    outcome: 'TP1_HIT' | 'STOP_HIT' | 'EXPIRED',
    outcomePrice: number,
    outcomeTime: Date,
    mfeR: number,
    maeR: number
  ): Promise<void> {
    // Calculate profit/loss in pips
    // JPY pairs use 0.01 for 1 pip, all other pairs use 0.0001
    const pipValue = signal.symbol.includes('JPY') ? 0.01 : 0.0001;
    let profitLossPips: number;

    if (signal.type === 'LONG') {
      profitLossPips = (outcomePrice - signal.entry_price) / pipValue;
    } else {
      profitLossPips = (signal.entry_price - outcomePrice) / pipValue;
    }
    // EXPIRED now carries REAL P&L, computed from the actual closing price rather than being
    // left NULL. The old code passed entry_price as the outcome — asserting the trade ended
    // flat — and never wrote pips at all, destroying information that cannot be recovered
    // later because the candle window was overwritten too.

    // Trade-window candles for the winning-trades chart. Written to `outcome_candles`, NOT
    // to `candles`. `candles` holds the 200 bars BEFORE the signal — exactly what a
    // backtester needs — and overwriting it at outcome time is what destroyed the
    // backtester's inputs. (Between 2025-12-03 and 2026-02-22 the fallback wrote SYNTHETIC
    // candles interpolated from entry to the known exit, which literally encode the answer.)
    // Pass the resolution time so the window ends where the trade did, not "now".
    const outcomeCandles = await this.fetchTradeDurationCandles(signal, outcomeTime);

    await db.execute(sql`
      UPDATE signal_history
      SET
        outcome = ${outcome},
        outcome_price = ${outcomePrice},
        outcome_time = ${outcomeTime.toISOString()},
        profit_loss_pips = ${profitLossPips},
        outcome_candles = ${outcomeCandles ? JSON.stringify(outcomeCandles) : null},
        corrected_mfe_r = ${mfeR},
        corrected_mae_r = ${maeR},
        validation_method = 'window-5min-v1',
        updated_at = NOW()
      WHERE signal_id = ${signal.signal_id}
    `);

    console.log(`✅ Signal ${signal.signal_id} → ${outcome} at ${outcomePrice} (${profitLossPips.toFixed(1)} pips)`);

    // Send ArgoFX Telegram outcome notification (non-blocking — never affects outcome save)
    await this.sendOutcomeNotification(signal, outcome, outcomePrice, profitLossPips);

    // Update performance metrics
    await this.updatePerformanceMetrics(signal);
  }

  // markAsExpired() was REMOVED on 2026-08-27.
  //
  // It was the mechanism behind the fabricated-expiry problem. It was called from the main
  // loop on a wall-clock check ALONE, before any candle was examined, and it:
  //   - never wrote profit_loss_pips (left NULL forever, unrecoverable);
  //   - passed entry_price as the outcome price, asserting the trade ended flat;
  //   - overwrote the `candles` column, destroying the pre-signal window;
  //   - stamped outcome_time = NOW() rather than the expiry instant.
  //
  // EXPIRED is now produced by checkOutcomeFromCandles ONLY after the full window has been
  // scanned and elapsed, and is written through updateSignalOutcome like any other outcome —
  // with a real closing price, real pips, and the true expiry timestamp.

  /**
   * Send ArgoFX Telegram outcome notification.
   * Fully isolated — any failure is caught and logged. Never throws.
   * Never blocks outcome recording or performance metrics.
   */
  private async sendOutcomeNotification(
    signal: PendingSignal,
    outcome: 'TP1_HIT' | 'STOP_HIT' | 'EXPIRED',
    outcomePrice: number,
    profitLossPips: number
  ): Promise<void> {
    try {
      const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
      const stopPips  = Math.abs(signal.entry_price - signal.stop_loss) * pipFactor;
      const durationMs = Date.now() - new Date(signal.created_at).getTime();

      // Fetch stats in parallel — fall back to zeros if any query fails
      let monthWins = 0, monthLosses = 0, monthPips = 0, streak = 0, signalNumber = 0;
      try {
        [monthWins, monthLosses, monthPips, streak, signalNumber] = await Promise.all([
          getMonthWinCount(),
          getMonthLossCount(),
          getMonthNetPips(),
          getCurrentStreak(),
          getSignalNumber(signal.signal_id),
        ]);
      } catch (statsErr) {
        console.error('[ArgoFX Telegram] Stats query failed — sending notification with zeros:', statsErr);
      }

      await telegramNotifier.sendOutcomeAlert({
        signalNumber,
        symbol:         signal.symbol,
        type:           signal.type,
        outcome,
        entryPrice:     signal.entry_price,
        outcomePrice,
        profitLossPips,
        stopPips,
        durationMs,
        tier:           signal.tier ?? 'HIGH',
        monthWins,
        monthLosses,
        monthPips,
        currentStreak:  streak,
      });
    } catch (err) {
      // Catch-all — Telegram must never crash outcome processing
      console.error('[ArgoFX Telegram] Outcome notification failed (non-critical):', err);
    }
  }

  /**
   * Update aggregated performance metrics
   */
  private async updatePerformanceMetrics(signal: PendingSignal): Promise<void> {
    try {
      // Determine confidence bracket
      const indicators = await this.getSignalIndicators(signal.signal_id);

      // Guard: if confidence is null/undefined, skip bracket assignment rather than
      // defaulting to 70 which would place the signal in the wrong bracket
      if (!indicators || indicators.confidence == null) {
        console.warn(`⚠️  No confidence data for ${signal.signal_id} — skipping performance metrics`);
        return;
      }
      const confidence = parseFloat(indicators.confidence);

      let confidenceBracket: string;
      if (confidence >= 90) {
        confidenceBracket = '90-100';
      } else if (confidence >= 80) {
        confidenceBracket = '80-89';
      } else {
        confidenceBracket = '70-79';
      }

      // Get strategy version
      const strategyVersion = indicators?.strategy_version || '1.0.0';

      // Call calculate_strategy_performance function for this specific bracket
      await db.execute(sql`
        SELECT calculate_strategy_performance(
          ${signal.user_id},
          ${signal.symbol},
          ${confidenceBracket},
          ${strategyVersion}
        )
      `);

      // Also update 'ALL' bracket
      await db.execute(sql`
        SELECT calculate_strategy_performance(
          ${signal.user_id},
          ${signal.symbol},
          'ALL',
          ${strategyVersion}
        )
      `);

    } catch (error) {
      console.error('❌ Error updating performance metrics:', error);
      throw error; // Propagate so callers can detect and log the failure
    }
  }

  /**
   * Get signal indicators (confidence, strategy version)
   */
  private async getSignalIndicators(signalId: string): Promise<any> {
    const result = await db.execute(sql`
      SELECT indicators->>'confidence' as confidence,
             strategy_version
      FROM signal_history
      WHERE signal_id = ${signalId}
      LIMIT 1
    `);

    return (result as any)[0];
  }

  /**
   * REMOVED: start() method no longer needed
   * Outcome validation is now triggered via HTTP endpoint /api/cron/validate-outcomes
   * This allows the service to work on Render free tier (which sleeps after 15 min)
   * UptimeRobot pings the endpoint every 5 minutes to trigger validation
   */
}

// Export singleton instance
export const outcomeValidator = new OutcomeValidator();

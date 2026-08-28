-- =============================================================================
-- Outcome Validation Repair — 2026-08-27
-- =============================================================================
-- Additive only. No column is dropped, altered, or back-filled destructively.
-- Every ADD COLUMN below is nullable with no default, which in PostgreSQL is a
-- catalog-only change: no table rewrite, no lock held on 1,527 live rows.
--
-- WHY THIS EXISTS
-- ---------------
-- An audit on 2026-08-26/27 established that outcome validation is unreliable:
--
--   1. `checkOutcomeFromCandles()` fetched "the most recent 200 1H candles" —
--      never anchored to the trade — then filtered `timestamp > created_at`.
--      Combined with datetimes parsed as host-local rather than UTC, it could
--      scan PRE-signal price action as though it were post-signal.
--
--   2. Expiry was checked BEFORE the candle scan, so a signal past 48h was
--      marked EXPIRED without ever asking what price did during those 48h.
--
--   3. The entry bar was excluded (`>` not `>=`), hiding up to 59 minutes of
--      post-entry action — asymmetrically, since the stop sits at half TP1's
--      distance.
--
--   4. `outcome_price` was always the literal tp1/stop_loss level, never a
--      traded price; `outcome_time` was NOW() (when the validator noticed),
--      never when price actually touched.
--
-- Verified example — USD/CHF LONG 2026-06-19T07:20Z, entry 0.80620,
-- SL 0.80473, TP1 0.80914. Recorded STOP_HIT at 0.80473, -14.70 pips.
-- Across the full 48h window (576 five-minute bars): low 0.80537, high 0.80809.
-- NEITHER level was touched. The recorded loss did not happen.
--
-- DESIGN DECISION (Philip, 2026-08-27): corrections are written to NEW columns.
-- The original values are preserved so the size of the error stays provable and
-- nothing is lost if the replay itself proves flawed.
-- =============================================================================

BEGIN;

-- --- Corrected outcome, produced by window-anchored 5-minute replay -----------
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS corrected_outcome           text,
  ADD COLUMN IF NOT EXISTS corrected_outcome_price     numeric,
  ADD COLUMN IF NOT EXISTS corrected_outcome_time      timestamptz,
  ADD COLUMN IF NOT EXISTS corrected_profit_loss_pips  numeric;

-- --- Excursion metrics, in R units (R = |entry - stop_loss|) ------------------
-- Measured across the FULL window regardless of when the trade resolved, so they
-- answer "how far could this have run" — which is what decides whether TP2 (4R)
-- and TP3 (6R) were ever reachable. Note TP2/TP3 have NEVER been recorded,
-- because checkOutcomeFromCandles can only return TP1_HIT or STOP_HIT.
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS corrected_mfe_r  numeric,
  ADD COLUMN IF NOT EXISTS corrected_mae_r  numeric;

-- --- Validation throttle -----------------------------------------------------
-- The rewritten validator replays the exact trade window via an UNCACHED API call, unlike
-- the old one which reused the signal generator's cached 1H candles. Without a throttle the
-- cost is (pending signals) x 288 runs/day, which blows the 800/day free tier at just 3
-- concurrent signals — and Twelve Data quota exhaustion fails SILENTLY, returning stale
-- cache as though it were live. This column caps each signal to one check per interval and,
-- unlike an in-memory counter, survives Render's constant restarts.
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz;

-- --- Provenance --------------------------------------------------------------
-- Which engine produced the correction, so a future re-run can be distinguished
-- from this one. e.g. 'window-5min-v1'.
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS validation_method text;

-- --- Stop destroying the pre-signal candle window ----------------------------
-- `candles` is written at INSERT with the 200 bars BEFORE the signal — correct,
-- and exactly what a backtester needs. It was then OVERWRITTEN at outcome time
-- with post-outcome bars (and, between 2025-12-03 and 2026-02-22, with SYNTHETIC
-- candles interpolated from entry_price to the known outcome price, which
-- literally encode the answer). Outcome-window candles now get their own column
-- so the winning-trades chart keeps working without corrupting the training data.
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS outcome_candles jsonb;

-- --- Indexes for the corrected columns ---------------------------------------
CREATE INDEX IF NOT EXISTS idx_signal_history_corrected_outcome
  ON signal_history (corrected_outcome)
  WHERE corrected_outcome IS NOT NULL;

-- --- The one deduplicated view every analysis surface should read -------------
-- NO analysis code in this repo deduplicates today — not signal-stats.ts, not
-- trade-statistics.ts, not routes/admin.ts, not routes/ai-insights.ts, not the
-- backtester. Every published number counts all 1,527 raw rows, which inflates
-- trade counts ~4.3x and pips ~7.9x.
--
-- Worse, the duplicates are not random: they cluster on LOSERS, because the old
-- dedup guard released the instant a trade resolved (usually STOP_HIT) while the
-- 30-minute candle cache let the identical setup re-fire 15 minutes later. That is
-- why the raw production win rate (16.3%) is LOWER than the deduplicated one (22.4%).
--
-- This logic is lifted verbatim from scripts/_forensics.ts, which the audit found to
-- be the ONLY methodologically sound analysis artifact in the repo. Point everything
-- at this view and delete the ad-hoc variants.
--
-- Known edges of the heuristic, accepted deliberately:
--   * a genuine SECOND setup on the same symbol/direction/day is dropped;
--   * a duplicate pair straddling 00:00 UTC survives as two rows.
-- Both are rare relative to the 4.3x inflation they remove.
-- DROP + CREATE rather than CREATE OR REPLACE. A view defined with `SELECT *` freezes its
-- column list at creation time, and CREATE OR REPLACE cannot change that list — so re-running
-- this migration after any future ALTER TABLE would fail with "cannot change name of view
-- column". Dropping first keeps the migration genuinely idempotent and lets the view pick up
-- new columns. Nothing depends on this view yet, so the drop is safe (no CASCADE needed).
-- security_invoker (PG15+, which Supabase is): without it a view in `public` executes as its
-- OWNER and therefore BYPASSES row-level security on signal_history. That table has a
-- `user_id` column and the app filters on it, so a definer-rights view would expose every
-- user's signals through PostgREST via the anon key. Supabase's own linter flags exactly this
-- as "Security Definer View".
--
-- (created_at AT TIME ZONE 'UTC')::date rather than DATE(created_at): DATE() on a timestamptz
-- is STABLE, not IMMUTABLE — it resolves against the session TimeZone GUC, so the same view
-- would dedup differently for the app connection, the Supabase SQL editor and PostgREST if
-- their timezones differ. The whole point of this grouping is a UTC trading day.
--
-- `, id` is the final tie-break: without it, two rows sharing an exact created_at dedup
-- nondeterministically and the view is not reproducible.
DROP VIEW IF EXISTS signal_history_deduped;
CREATE VIEW signal_history_deduped
WITH (security_invoker = true) AS
SELECT DISTINCT ON ((created_at AT TIME ZONE 'UTC')::date, symbol, type) *
FROM signal_history
WHERE data_quality = 'production'
ORDER BY (created_at AT TIME ZONE 'UTC')::date, symbol, type, created_at ASC, id ASC;

-- DROP VIEW discards all GRANTs, so they must be re-issued on every run of this migration.
GRANT SELECT ON signal_history_deduped TO authenticated;
GRANT SELECT ON signal_history_deduped TO service_role;

COMMENT ON VIEW signal_history_deduped IS
  'One row per (date, symbol, direction), production only. THE canonical source for any '
  'win-rate, pip, or profit-factor calculation. Reading signal_history directly for '
  'analysis over-counts ~4.3x and, because duplicates cluster on losers, biases the win '
  'rate DOWNWARD. See db/manual/2026-08-27_outcome_validation_repair.sql.';

COMMIT;

-- =============================================================================
-- VERIFICATION — run after applying:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'signal_history'
--     AND column_name LIKE 'corrected_%' OR column_name = 'outcome_candles'
--   ORDER BY column_name;
--
-- Expect 8 rows. Existing data is untouched:
--
--   SELECT COUNT(*) FROM signal_history;                    -- unchanged
--   SELECT COUNT(*) FROM signal_history WHERE candles IS NOT NULL;  -- unchanged
-- =============================================================================

-- Deduped view: add entry_price to the key — 2026-09-02
--
-- WHY
-- ---
-- The view collapsed on (date, symbol, type) and kept only the EARLIEST row. That was correct in
-- February 2026, when the duplicate problem was the same trade re-emitted minutes apart and a pair
-- genuinely traded at most once a day. It is now destroying real trades.
--
-- Measured on the live table 2026-09-02:
--
--   raw production rows                          309
--   kept by the OLD key (date, symbol, type)      73
--   kept by the NEW key (+ entry_price)          172
--   genuinely distinct trades the old key dropped 99
--
-- On 2026-09-02 the system generated two USD/CHF LONG signals, executed BOTH at the broker, and
-- the old view kept only the first. The second — signal-1788352946424-wwf34wcan, confidence 119,
-- 0.78 lots, a REAL -$144.17 loss at cTrader — did not appear in the dashboard, the admin stats,
-- the AI insights, or the performance report. It was invisible to every consumer.
--
-- WHY entry_price IS THE RIGHT DISCRIMINATOR (measured, not assumed)
-- -----------------------------------------------------------------
--   * 134 consecutive same-entry pairs = true duplicates. Of the 127 groups sharing
--     (date, symbol, type, entry_price), only 2 have conflicting outcomes — so collapsing them
--     is safe.
--   * 102 consecutive different-entry pairs = genuinely distinct trades, gaps up to 625 minutes.
--   * TIME CANNOT SEPARATE THEM. Both populations have a median gap of 15.3 minutes. Any
--     time-window rule would either keep duplicates or destroy real trades. Entry price separates
--     them cleanly.
--
-- WHAT THIS CHANGES, STATED PLAINLY
-- ---------------------------------
--   OLD view:  73 resolved, 25W/44L, 36.2%, +102.7 pips
--   NEW view: 172 resolved, 54W/110L, 32.9%, -555.0 pips
--
-- The live record is NOT profitable and never was. It looked profitable only because the dropped
-- rows were disproportionately losers — a bias already noted in this project as "duplicates
-- cluster on losers". The corrected figure now AGREES with the backtest's pooled -0.0552 R
-- instead of contradicting it.
--
-- Tie-break is unchanged (created_at, id — earliest wins), so the 2 conflicting-outcome groups
-- resolve exactly as before.
--
-- SAFETY: CREATE OR REPLACE preserves the column list and order, so every consumer keeps working.
-- Generated from pg_get_viewdef of the live view with ONLY the DISTINCT ON key and matching
-- ORDER BY changed, so no column can be accidentally dropped — this view has been rebuilt three
-- times and enumerates all 62 columns explicitly.

CREATE OR REPLACE VIEW signal_history_deduped AS
SELECT DISTINCT ON (((created_at AT TIME ZONE 'UTC'::text)::date), symbol, type, entry_price) id,
    signal_id,
    user_id,
    symbol,
    type,
    confidence,
    entry_price,
    current_price,
    stop_loss,
    tp1,
    tp2,
    tp3,
    stop_limit_price,
    COALESCE(corrected_order_type, order_type) AS order_type,
    order_type AS raw_order_type,
    COALESCE(corrected_execution_type, execution_type) AS execution_type,
    execution_type AS raw_execution_type,
    strategy_name,
    strategy_version,
    COALESCE(corrected_outcome, outcome) AS outcome,
    outcome AS raw_outcome,
    COALESCE(corrected_outcome_price, outcome_price) AS outcome_price,
    outcome_price AS raw_outcome_price,
    COALESCE(corrected_outcome_time, outcome_time) AS outcome_time,
    outcome_time AS raw_outcome_time,
    COALESCE(corrected_profit_loss_pips, profit_loss_pips) AS profit_loss_pips,
    profit_loss_pips AS raw_profit_loss_pips,
    manually_closed_by_user,
    indicators,
    candles,
    created_at,
    expires_at,
    updated_at,
    tier,
    trade_live,
    position_size_percent,
    partial_close_1_price,
    partial_close_1_time,
    partial_close_1_pips,
    stop_moved_to_breakeven,
    breakeven_stop_price,
    data_quality,
    entry_slippage,
    exit_slippage,
    fill_latency,
    break_even_time,
    max_adverse_excursion,
    max_favorable_excursion,
    session,
    volatility_level,
    corrected_outcome,
    corrected_outcome_price,
    corrected_outcome_time,
    corrected_profit_loss_pips,
    corrected_mfe_r,
    corrected_mae_r,
    corrected_order_type,
    corrected_execution_type,
    last_validated_at,
    validation_method,
    outcome_candles,
    requires_approval,
    approval_reason
   FROM signal_history
  WHERE data_quality = 'production'::text
  ORDER BY ((created_at AT TIME ZONE 'UTC'::text)::date), symbol, type, entry_price, created_at, id;

-- Generated from the live schema (53 columns) on 2026-08-30.
BEGIN;

DROP VIEW IF EXISTS signal_history_deduped;

CREATE VIEW signal_history_deduped
WITH (security_invoker = true) AS
SELECT DISTINCT ON ((created_at AT TIME ZONE 'UTC')::date, symbol, type)
  id,
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
  order_type,
  execution_type,
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
  last_validated_at,
  validation_method,
  outcome_candles
FROM signal_history
WHERE data_quality = 'production'
ORDER BY (created_at AT TIME ZONE 'UTC')::date, symbol, type, created_at ASC, id ASC;

GRANT SELECT ON signal_history_deduped TO authenticated;
GRANT SELECT ON signal_history_deduped TO service_role;
GRANT SELECT ON signal_history_deduped TO anon;

COMMENT ON VIEW signal_history_deduped IS
  'Canonical source for ANY win-rate, pip, or profit-factor figure. Two corrections are baked in '
  'so callers cannot forget them: (1) DISTINCT ON deduplicates - the raw table over-counts 4.31x '
  '(306 -> 71 production rows) and duplicates cluster on losers, biasing win rate DOWNWARD; '
  '(2) outcome/profit_loss_pips/outcome_time/outcome_price expose the CORRECTED values, because '
  'the original validator fabricated losses (131 of 306 outcomes were wrong). Raw values remain '
  'available as raw_outcome, raw_profit_loss_pips, raw_outcome_time, raw_outcome_price for '
  'forensic comparison only. Never use raw_* for a displayed statistic.';

COMMIT;

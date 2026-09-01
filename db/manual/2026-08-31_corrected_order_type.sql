-- Correct the historical order_type label WITHOUT destroying it.
--
-- 55 production rows say 'Buy Limit' (18) or 'Sell Limit' (37) with execution_type 'PENDING',
-- while both executors sent MARKET orders. Pre-registration §6 flagged this. It matters because
-- a subscriber told "Buy Limit at X" places a RESTING order: if price never returns they never
-- enter, while this system records a fill at X. Their results and our record then diverge
-- permanently, in a direction nothing measures.
--
-- WHY corrected_* RATHER THAN AN IN-PLACE UPDATE
--
-- This project has already destroyed data by overwriting a column in place: the outcome validator
-- wrote trade-window candles over `candles`, which held the 200 pre-signal bars a backtester
-- needs, and those inputs are not recoverable. The established fix is the corrected_outcome
-- pattern -- keep the original untouched, add a corrected_* column, and let the view COALESCE.
-- The same shape is used here, so the original label remains readable as raw_order_type forever
-- and this migration is reversible by dropping two columns.
--
-- Rows whose order_type is already MARKET are left with NULL corrections, exactly as
-- corrected_outcome is NULL for outcomes that needed no correction.
--
-- Non-production rows carrying BUY_LIMIT / SELL_STOP / SELL_STOP_LIMIT etc. are NOT touched.
-- Those come from the old client-side generator (client/src/lib/strategy.ts), which picked the
-- order type with Math.random() and is not the production path.

BEGIN;

ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS corrected_order_type     text,
  ADD COLUMN IF NOT EXISTS corrected_execution_type text;

COMMENT ON COLUMN signal_history.corrected_order_type IS
  'Set where the stored order_type asserted a limit order that was never placed. Both executors '
  'send MARKET. NULL means the original needed no correction. The original is never overwritten '
  'and remains available as raw_order_type in signal_history_deduped.';

UPDATE signal_history
SET corrected_order_type     = 'MARKET',
    corrected_execution_type = 'IMMEDIATE',
    updated_at               = NOW()
WHERE data_quality = 'production'
  AND order_type IN ('Buy Limit', 'Sell Limit')
  AND corrected_order_type IS NULL;

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
  COALESCE(corrected_order_type, order_type)         AS order_type,
  order_type                                          AS raw_order_type,
  COALESCE(corrected_execution_type, execution_type) AS execution_type,
  execution_type                                      AS raw_execution_type,
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
WHERE data_quality = 'production'
ORDER BY (created_at AT TIME ZONE 'UTC')::date, symbol, type, created_at ASC, id ASC;

GRANT SELECT ON signal_history_deduped TO authenticated;
GRANT SELECT ON signal_history_deduped TO service_role;
GRANT SELECT ON signal_history_deduped TO anon;

COMMENT ON VIEW signal_history_deduped IS
  'Canonical source for ANY win-rate, pip, or profit-factor figure. Corrections are baked in so '
  'callers cannot forget them: (1) DISTINCT ON deduplicates - the raw table over-counts 4.31x and '
  'duplicates cluster on losers, biasing win rate DOWNWARD; (2) outcome/profit_loss_pips/ '
  'outcome_time/outcome_price expose CORRECTED values, because the original validator fabricated '
  'losses (131 of 306 outcomes were wrong); (3) order_type/execution_type expose CORRECTED values, '
  'because 55 production rows asserted a limit order while both executors sent MARKET. Originals '
  'remain as raw_* for forensic comparison ONLY - never use raw_* for a displayed statistic. '
  'requires_approval/approval_reason mark signals a risk control held back from auto-execution; '
  'they are still real signals and belong in every statistic.';

COMMIT;

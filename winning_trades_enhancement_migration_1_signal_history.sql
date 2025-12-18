-- Winning Trades Enhancement - Migration 1: Add execution quality and analysis columns
-- Phase: Backend Foundation (Day 1)
-- Date: 2025-12-17
-- Purpose: Add columns to signal_history for MAE/MFE, slippage, session detection, and volatility

-- Add execution quality columns
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS entry_slippage DECIMAL(10, 2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS exit_slippage DECIMAL(10, 2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS fill_latency INTEGER DEFAULT 0; -- milliseconds

-- Add trade analysis columns
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS break_even_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS max_adverse_excursion DECIMAL(10, 2), -- pips
ADD COLUMN IF NOT EXISTS max_favorable_excursion DECIMAL(10, 2); -- pips

-- Add market context columns
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS session VARCHAR(20) CHECK (session IN ('ASIA', 'LONDON', 'NY', 'LONDON_NY_OVERLAP', 'OFF_HOURS')),
ADD COLUMN IF NOT EXISTS volatility_level VARCHAR(10) CHECK (volatility_level IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME'));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_signal_history_session ON signal_history(session);
CREATE INDEX IF NOT EXISTS idx_signal_history_outcome_time ON signal_history(outcome_time);
CREATE INDEX IF NOT EXISTS idx_signal_history_strategy ON signal_history(strategy_name, strategy_version);

-- Add comment for documentation
COMMENT ON COLUMN signal_history.entry_slippage IS 'Slippage in pips at entry (positive = worse price, negative = better price)';
COMMENT ON COLUMN signal_history.exit_slippage IS 'Slippage in pips at exit (positive = worse price, negative = better price)';
COMMENT ON COLUMN signal_history.fill_latency IS 'Time to fill order in milliseconds';
COMMENT ON COLUMN signal_history.max_adverse_excursion IS 'Maximum drawdown in pips before exit (MAE)';
COMMENT ON COLUMN signal_history.max_favorable_excursion IS 'Maximum profit reached in pips before exit (MFE)';
COMMENT ON COLUMN signal_history.session IS 'Trading session when signal was generated (ASIA/LONDON/NY/OVERLAP)';
COMMENT ON COLUMN signal_history.volatility_level IS 'Market volatility level at signal time based on ATR';

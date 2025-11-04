-- Phase 3C: Partial Profit Taking Migration
-- Adds support for 50% profit taking at TP1, moving stop to breakeven

-- 1. Add new columns to signal_history table
ALTER TABLE signal_history
  ADD COLUMN IF NOT EXISTS partial_close_1_price DECIMAL(10, 5),
  ADD COLUMN IF NOT EXISTS partial_close_1_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partial_close_1_pips DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS stop_moved_to_breakeven BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS breakeven_stop_price DECIMAL(10, 5);

-- 2. Update outcome CHECK constraint to include new outcomes
-- Note: PostgreSQL doesn't support modifying CHECK constraints directly
-- We need to drop and recreate the constraint

-- Drop the old constraint
ALTER TABLE signal_history
  DROP CONSTRAINT IF EXISTS signal_history_outcome_check;

-- Add new constraint with additional outcome types
ALTER TABLE signal_history
  ADD CONSTRAINT signal_history_outcome_check
  CHECK (outcome IN (
    'PENDING',
    'TP1_HIT',        -- Old: Hit TP1 (all-or-nothing)
    'TP1_PARTIAL',    -- NEW: Hit TP1, took 50% profit, moved stop to BE
    'TP2_HIT',        -- Hit TP2 (full close, or 50% after partial)
    'TP3_HIT',        -- Hit TP3 (bonus target)
    'STOP_HIT',       -- Hit original stop loss
    'BREAKEVEN',      -- NEW: Hit breakeven stop after TP1_PARTIAL
    'EXPIRED',
    'MANUALLY_CLOSED'
  ));

-- 3. Add comments for documentation
COMMENT ON COLUMN signal_history.partial_close_1_price IS 'Price at which 50% was closed (TP1)';
COMMENT ON COLUMN signal_history.partial_close_1_time IS 'Timestamp when 50% was closed';
COMMENT ON COLUMN signal_history.partial_close_1_pips IS 'Profit in pips from first 50% close';
COMMENT ON COLUMN signal_history.stop_moved_to_breakeven IS 'Whether stop was moved to breakeven after TP1';
COMMENT ON COLUMN signal_history.breakeven_stop_price IS 'Breakeven stop price after TP1 hit';

-- 4. Create index on new columns for query performance
CREATE INDEX IF NOT EXISTS idx_signal_history_partial_close ON signal_history(partial_close_1_time)
  WHERE partial_close_1_time IS NOT NULL;

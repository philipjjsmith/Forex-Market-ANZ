-- Migration: Add Tiered Confidence System
-- Date: 2025-01-21
-- Description: Adds tier, trade_live, and position_size_percent columns for Option C implementation

-- Step 1: Add new columns to signal_history table
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS tier TEXT CHECK (tier IN ('HIGH', 'MEDIUM')) DEFAULT 'HIGH',
ADD COLUMN IF NOT EXISTS trade_live BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS position_size_percent DECIMAL(3,2) DEFAULT 1.00;

-- Step 2: Update confidence check to allow 70+ (was 70-100, now supports MEDIUM tier)
ALTER TABLE signal_history
DROP CONSTRAINT IF EXISTS signal_history_confidence_check;

ALTER TABLE signal_history
ADD CONSTRAINT signal_history_confidence_check
CHECK (confidence >= 70 AND confidence <= 120);

-- Step 3: Create index on tier for faster queries
CREATE INDEX IF NOT EXISTS idx_signal_history_tier ON signal_history(tier);

-- Step 4: Update existing signals to HIGH tier (they were all above threshold)
UPDATE signal_history
SET tier = 'HIGH',
    trade_live = true,
    position_size_percent = 1.00
WHERE tier IS NULL;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN signal_history.tier IS 'HIGH (85-120 points, live trade) or MEDIUM (70-84 points, paper trade)';
COMMENT ON COLUMN signal_history.trade_live IS 'TRUE = trade with real money, FALSE = paper trade for AI learning only';
COMMENT ON COLUMN signal_history.position_size_percent IS 'Risk percentage per trade (1.00 = 1%, 0.00 = paper trade)';

-- Notes:
-- - HIGH tier (85-120 points): Trade live with 1% risk
-- - MEDIUM tier (70-84 points): Paper trade only (0% risk) for AI learning
-- - Confidence now ranges from 70-120 points (120-point scoring system)
-- - This migration is idempotent (safe to run multiple times)

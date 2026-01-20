-- Data Quality Column Migration
-- Purpose: Separate legacy (pre-Nov 4) signals from production (Nov 4+) signals
-- This enables clean profit tracking after the ICT 3-Timeframe strategy pivot

-- ============================================================
-- STEP 1: Add data_quality column to signal_history
-- ============================================================
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS data_quality TEXT DEFAULT 'production'
CHECK (data_quality IN ('production', 'legacy', 'test'));

-- Create index for fast filtering
CREATE INDEX IF NOT EXISTS idx_signal_history_data_quality
ON signal_history(data_quality);

-- ============================================================
-- STEP 2: Mark existing signals based on creation date
-- Pre-Nov 4, 2025 05:44:16 UTC = 'legacy' (old strategy)
-- Nov 4+ = 'production' (new ICT 3-TF strategy)
-- ============================================================
UPDATE signal_history
SET data_quality = 'legacy'
WHERE created_at < '2025-11-04 05:44:16 UTC';

UPDATE signal_history
SET data_quality = 'production'
WHERE created_at >= '2025-11-04 05:44:16 UTC';

-- ============================================================
-- STEP 3: Add tier column if not exists (for HIGH/MEDIUM filtering)
-- ============================================================
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'MEDIUM'
CHECK (tier IN ('HIGH', 'MEDIUM'));

-- Create index for tier filtering
CREATE INDEX IF NOT EXISTS idx_signal_history_tier
ON signal_history(tier);

-- ============================================================
-- STEP 4: Add trade_live column if not exists
-- ============================================================
ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS trade_live BOOLEAN DEFAULT false;

-- Create index for trade_live filtering
CREATE INDEX IF NOT EXISTS idx_signal_history_trade_live
ON signal_history(trade_live);

-- ============================================================
-- VERIFICATION QUERY (Run after migration)
-- ============================================================
-- SELECT
--   data_quality,
--   COUNT(*) as count,
--   MIN(created_at) as earliest,
--   MAX(created_at) as latest
-- FROM signal_history
-- GROUP BY data_quality
-- ORDER BY data_quality;

COMMENT ON COLUMN signal_history.data_quality IS 'production = current strategy (Nov 4+), legacy = old strategy (pre-Nov 4), test = testing data';

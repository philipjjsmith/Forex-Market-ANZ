-- ============================================================================
-- DATA QUALITY SOFT DELETE MIGRATION
-- ============================================================================
-- Purpose: Add data_quality column to track signal data integrity
-- Author: Claude Code
-- Date: 2025-11-19
-- Version: 1.0.0
-- ============================================================================

-- STEP 1: Add data_quality column to signal_history table
-- ============================================================================
-- This column allows filtering between production, legacy, and archived data
-- without deleting historical records (industry best practice)

ALTER TABLE signal_history
ADD COLUMN IF NOT EXISTS data_quality TEXT DEFAULT 'production';

-- Add column description for documentation
COMMENT ON COLUMN signal_history.data_quality IS
'Data quality classification: production (v3.1.0+), legacy (pre-Nov 19 buggy data), archived (removed from analysis)';

-- ============================================================================
-- STEP 2: Mark existing signals based on creation date
-- ============================================================================
-- Signals created before Nov 19, 2025 are marked as 'legacy' due to:
-- - v2.1.0 and earlier had confidence scoring inversion bug
-- - v1.0.0 had USD/JPY pip calculation bug (100x too large)
-- - v2.2.0 had incomplete fixes
-- - v3.1.0 (deployed Nov 19) has all fixes + ICT 3-Timeframe methodology

UPDATE signal_history
SET data_quality = 'legacy'
WHERE created_at < '2025-11-19 00:00:00 UTC'
  AND data_quality = 'production'; -- Only update if not already marked

-- ============================================================================
-- STEP 3: Create index for fast filtering
-- ============================================================================
-- This index ensures fast queries when filtering by data_quality

CREATE INDEX IF NOT EXISTS idx_signal_history_data_quality
ON signal_history(data_quality);

-- Create composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_signal_history_quality_tier_outcome
ON signal_history(data_quality, tier, outcome);

-- ============================================================================
-- STEP 4: Add CHECK constraint to ensure valid values
-- ============================================================================
-- Valid values: 'production', 'legacy', 'archived'

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_data_quality'
  ) THEN
    ALTER TABLE signal_history
    ADD CONSTRAINT valid_data_quality
    CHECK (data_quality IN ('production', 'legacy', 'archived'));
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Create view for production-only data (convenience)
-- ============================================================================
-- This view shows only production-quality signals for reporting

CREATE OR REPLACE VIEW signal_history_production AS
SELECT * FROM signal_history
WHERE data_quality = 'production'
  AND outcome != 'PENDING';

-- Create view for FXIFY production data (HIGH tier only)
CREATE OR REPLACE VIEW fxify_production_signals AS
SELECT * FROM signal_history
WHERE data_quality = 'production'
  AND trade_live = true
  AND tier = 'HIGH'
  AND outcome != 'PENDING';

-- ============================================================================
-- STEP 6: Verify migration results
-- ============================================================================

-- Check distribution of data_quality values
DO $$
DECLARE
  prod_count INTEGER;
  legacy_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO prod_count FROM signal_history WHERE data_quality = 'production';
  SELECT COUNT(*) INTO legacy_count FROM signal_history WHERE data_quality = 'legacy';
  SELECT COUNT(*) INTO total_count FROM signal_history;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'DATA QUALITY MIGRATION SUMMARY';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Production signals: %', prod_count;
  RAISE NOTICE 'Legacy signals: %', legacy_count;
  RAISE NOTICE 'Total signals: %', total_count;
  RAISE NOTICE '============================================';

  IF legacy_count = 0 THEN
    RAISE WARNING 'No legacy signals found - this is unexpected if you have historical data';
  END IF;

  IF prod_count = 0 THEN
    RAISE WARNING 'No production signals found - this is expected if v3.1.0 just deployed';
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- To rollback this migration:
--
-- DROP VIEW IF EXISTS fxify_production_signals;
-- DROP VIEW IF EXISTS signal_history_production;
-- DROP INDEX IF EXISTS idx_signal_history_quality_tier_outcome;
-- DROP INDEX IF EXISTS idx_signal_history_data_quality;
-- ALTER TABLE signal_history DROP CONSTRAINT IF EXISTS valid_data_quality;
-- ALTER TABLE signal_history DROP COLUMN IF EXISTS data_quality;
--
-- ============================================================================

-- Migration complete!
RAISE NOTICE '✅ Data quality migration complete - ready for production use';

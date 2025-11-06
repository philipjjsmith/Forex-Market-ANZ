-- Fix USD/JPY Historical Pip Calculation
-- Date: November 6, 2025
-- Issue: Old USD/JPY signals used 0.0001 pip value (should be 0.01)
-- Result: Losses inflated by 100x (e.g., -6,840 pips instead of -68.4)
-- Fix: Divide by 100 for all JPY pairs before Nov 4, 2025 fix deployment

-- ============================================================
-- STEP 1: Safety Check - Preview affected signals
-- ============================================================
-- Run this first to see what will be changed

SELECT
  id,
  symbol,
  created_at,
  outcome,
  profit_loss_pips as old_pips,
  ROUND(profit_loss_pips / 100, 2) as new_pips,
  ROUND(profit_loss_pips - (profit_loss_pips / 100), 2) as correction_amount
FROM signal_history
WHERE symbol LIKE '%JPY%'
  AND created_at < '2025-11-04 05:44:16 UTC'
  AND ABS(profit_loss_pips) > 1000
  AND outcome != 'PENDING'
ORDER BY created_at DESC;

-- Expected results:
-- - USD/JPY signals with pips > 1000 or < -1000
-- - Old pips: -6,840, -6,860, -8,400, etc.
-- - New pips: -68.4, -68.6, -84.0, etc.
-- - This should affect approximately 20-50 signals

-- ============================================================
-- STEP 2: Backup (Optional but Recommended)
-- ============================================================
-- Create a backup of affected signals before making changes

CREATE TABLE IF NOT EXISTS signal_history_backup_20251106 AS
SELECT *
FROM signal_history
WHERE symbol LIKE '%JPY%'
  AND created_at < '2025-11-04 05:44:16 UTC'
  AND ABS(profit_loss_pips) > 1000
  AND outcome != 'PENDING';

-- ============================================================
-- STEP 3: Execute Fix - UPDATE affected signals
-- ============================================================
-- UNCOMMENT AND RUN THIS AFTER VERIFYING STEP 1 RESULTS

UPDATE signal_history
SET profit_loss_pips = profit_loss_pips / 100
WHERE symbol LIKE '%JPY%'
  AND created_at < '2025-11-04 05:44:16 UTC'
  AND ABS(profit_loss_pips) > 1000
  AND outcome != 'PENDING';

-- ============================================================
-- STEP 4: Verification - Confirm fix was applied
-- ============================================================
-- Run this after the UPDATE to verify changes

SELECT
  symbol,
  COUNT(*) as signals_fixed,
  AVG(profit_loss_pips) as avg_pips_after_fix,
  MIN(profit_loss_pips) as min_pips,
  MAX(profit_loss_pips) as max_pips
FROM signal_history
WHERE symbol LIKE '%JPY%'
  AND created_at < '2025-11-04 05:44:16 UTC'
  AND outcome != 'PENDING'
GROUP BY symbol
ORDER BY symbol;

-- Expected results after fix:
-- - USD/JPY pips should be between -200 and +200 (not thousands)
-- - Average should be around -50 to +50 pips
-- - No pips > 1000 or < -1000

-- ============================================================
-- NOTES
-- ============================================================
-- 1. This fix only affects OLD signals (before Nov 4, 2025 05:44:16 UTC)
-- 2. NEW signals are calculated correctly (no fix needed)
-- 3. Backup table: signal_history_backup_20251106 (can be dropped after verification)
-- 4. Impact: Growth Tracking "All Historical Data" will show accurate totals
-- 5. Default filter "Nov 4+ (Fixed System)" is unaffected (doesn't include old signals)

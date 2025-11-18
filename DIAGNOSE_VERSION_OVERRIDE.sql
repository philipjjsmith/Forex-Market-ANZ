-- ========================================
-- DIAGNOSE VERSION OVERRIDE ISSUE
-- Why is system running v1.0.0 instead of v3.1.0?
-- ========================================

-- 1. Check strategy_adaptations table for version overrides
SELECT
  '=== STRATEGY ADAPTATIONS (Last 30 days) ===' as section;

SELECT
  id,
  symbol,
  old_strategy_version,
  new_strategy_version,
  status,
  pattern_detected,
  recommendation_title,
  suggested_changes::text as changes,
  created_at::timestamp(0) as created,
  applied_at::timestamp(0) as applied
FROM strategy_adaptations
WHERE created_at >= NOW() - INTERVAL '30 days'
ORDER BY created_at DESC;

-- 2. Check for APPROVED adaptations that are ACTIVELY overriding v3.1.0
SELECT
  '=== APPROVED ADAPTATIONS (Active Overrides - THIS IS THE SMOKING GUN) ===' as section;

SELECT
  symbol,
  new_strategy_version,
  old_strategy_version,
  status,
  pattern_detected,
  suggested_changes::text as changes,
  created_at::timestamp(0) as created,
  applied_at::timestamp(0) as applied
FROM strategy_adaptations
WHERE status = 'approved' AND applied_at IS NOT NULL
ORDER BY applied_at DESC;

-- 3. Check signals generated around Nov 13 to see version transitions
SELECT
  '=== SIGNAL VERSION HISTORY (Nov 10-16) ===' as section;

SELECT
  created_at::timestamp(0) as time,
  symbol,
  strategy_version,
  confidence,
  tier,
  outcome
FROM signal_history
WHERE created_at >= '2025-11-10'::timestamp
  AND created_at <= '2025-11-16'::timestamp
ORDER BY created_at ASC;

-- 4. Count signals by version and date to visualize the switch
SELECT
  '=== VERSION SWITCH TIMELINE ===' as section;

SELECT
  DATE(created_at) as date,
  strategy_version,
  COUNT(*) as signal_count,
  AVG(confidence)::numeric(10,2) as avg_confidence
FROM signal_history
WHERE created_at >= '2025-11-01'::timestamp
GROUP BY DATE(created_at), strategy_version
ORDER BY date DESC, strategy_version DESC;

-- Note: Logs table doesn't exist, so we skip that check

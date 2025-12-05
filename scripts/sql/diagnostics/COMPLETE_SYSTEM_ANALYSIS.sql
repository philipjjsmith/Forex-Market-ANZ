-- ========================================
-- COMPLETE SYSTEM ANALYSIS
-- Deep dive into current performance
-- ========================================

-- 1. OVERALL PERFORMANCE BY VERSION
SELECT
  '=== PERFORMANCE BY VERSION ===' as section;

SELECT
  strategy_version,
  tier,
  COUNT(*) as total_signals,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
  COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
  COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as win_rate_percent,
  ROUND(AVG(confidence), 2) as avg_confidence,
  MIN(created_at)::date as first_signal,
  MAX(created_at)::date as last_signal
FROM signal_history
GROUP BY strategy_version, tier
ORDER BY strategy_version DESC, tier DESC;

-- 2. v3.1.0 DETAILED STATS
SELECT
  '=== v3.1.0 ICT 3-TIMEFRAME STATS ===' as section;

SELECT
  COUNT(*) as total_v310_signals,
  COUNT(*) FILTER (WHERE tier = 'HIGH') as high_tier,
  COUNT(*) FILTER (WHERE tier = 'MEDIUM') as medium_tier,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
  COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
  COUNT(*) FILTER (WHERE outcome = 'PENDING') as pending,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as win_rate,
  ROUND(AVG(confidence), 2) as avg_confidence,
  ROUND(MIN(confidence), 2) as min_confidence,
  ROUND(MAX(confidence), 2) as max_confidence
FROM signal_history
WHERE strategy_version = '3.1.0';

-- 3. FXIFY-READY PERFORMANCE (HIGH tier only)
SELECT
  '=== FXIFY-READY (HIGH TIER) PERFORMANCE ===' as section;

SELECT
  strategy_version,
  COUNT(*) as fxify_signals,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
  COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as fxify_win_rate
FROM signal_history
WHERE tier = 'HIGH' AND trade_live = true
GROUP BY strategy_version
ORDER BY strategy_version DESC;

-- 4. SIGNAL FREQUENCY (Last 30 days)
SELECT
  '=== SIGNAL FREQUENCY (Last 30 days) ===' as section;

SELECT
  DATE(created_at) as date,
  COUNT(*) as signals_per_day,
  COUNT(*) FILTER (WHERE tier = 'HIGH') as high_tier_count,
  COUNT(*) FILTER (WHERE tier = 'MEDIUM') as medium_tier_count,
  strategy_version
FROM signal_history
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), strategy_version
ORDER BY date DESC, strategy_version DESC
LIMIT 30;

-- 5. CURRENCY PAIR PERFORMANCE
SELECT
  '=== PERFORMANCE BY CURRENCY PAIR ===' as section;

SELECT
  symbol,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
  COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as win_rate
FROM signal_history
WHERE strategy_version IN ('3.0.0', '3.1.0')
GROUP BY symbol
ORDER BY total DESC;

-- 6. RECENT SIGNALS (Last 20)
SELECT
  '=== LAST 20 SIGNALS ===' as section;

SELECT
  created_at::timestamp(0) as time,
  symbol,
  type,
  tier,
  confidence,
  outcome,
  strategy_version
FROM signal_history
ORDER BY created_at DESC
LIMIT 20;

-- 7. CONFIDENCE RANGE ANALYSIS
SELECT
  '=== WIN RATE BY CONFIDENCE RANGE ===' as section;

SELECT
  CASE
    WHEN confidence >= 95 THEN '95-100'
    WHEN confidence >= 90 THEN '90-94'
    WHEN confidence >= 85 THEN '85-89'
    WHEN confidence >= 80 THEN '80-84'
    WHEN confidence >= 75 THEN '75-79'
    ELSE '70-74'
  END as confidence_range,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as win_rate
FROM signal_history
WHERE strategy_version IN ('3.0.0', '3.1.0')
GROUP BY confidence_range
ORDER BY confidence_range DESC;

-- Deep dive into Nov 13 signals to understand the version split

SELECT
  created_at::timestamp(0) as created,
  strategy_version,
  symbol,
  type,
  confidence,
  tier,
  trade_live,
  position_size_percent
FROM signal_history
WHERE created_at >= '2025-11-13 00:00:00'::timestamp
  AND created_at < '2025-11-14 00:00:00'::timestamp
ORDER BY created_at ASC;

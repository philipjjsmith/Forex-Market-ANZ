-- Check FXIFY-only (HIGH tier) performance
SELECT 
  COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true) as high_tier_total,
  COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true AND outcome != 'PENDING') as high_tier_completed,
  COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as high_tier_wins,
  COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true AND outcome = 'STOP_HIT') as high_tier_losses,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE tier = 'HIGH' AND trade_live = true AND outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as high_tier_win_rate,
  
  -- All signals for comparison
  COUNT(*) FILTER (WHERE outcome != 'PENDING') as all_completed,
  COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as all_wins,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
    NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
    2
  ) as all_win_rate
FROM signal_history;

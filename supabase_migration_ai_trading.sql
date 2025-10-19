-- AI Trade Validation System - Database Schema
-- Phase 1: Signal tracking, outcome validation, and performance analytics

-- ============================================================
-- TABLE: signal_history
-- Tracks every 70%+ confidence signal generated
-- ============================================================
CREATE TABLE IF NOT EXISTS signal_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  signal_id TEXT UNIQUE NOT NULL,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,

  -- Signal details
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('LONG', 'SHORT')),
  confidence INTEGER NOT NULL CHECK (confidence >= 70 AND confidence <= 100),

  -- Price levels
  entry_price DECIMAL(10, 5) NOT NULL,
  current_price DECIMAL(10, 5) NOT NULL,
  stop_loss DECIMAL(10, 5) NOT NULL,
  tp1 DECIMAL(10, 5) NOT NULL,
  tp2 DECIMAL(10, 5) NOT NULL,
  tp3 DECIMAL(10, 5) NOT NULL,
  stop_limit_price DECIMAL(10, 5),

  -- Order details
  order_type TEXT NOT NULL,
  execution_type TEXT NOT NULL,

  -- Strategy metadata
  strategy_name TEXT NOT NULL,
  strategy_version TEXT NOT NULL,

  -- Outcome tracking
  outcome TEXT DEFAULT 'PENDING' CHECK (outcome IN ('PENDING', 'TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT', 'EXPIRED', 'MANUALLY_CLOSED')),
  outcome_price DECIMAL(10, 5),
  outcome_time TIMESTAMPTZ,
  profit_loss_pips DECIMAL(10, 2),
  manually_closed_by_user BOOLEAN DEFAULT FALSE,

  -- Market conditions at signal time (for AI learning)
  indicators JSONB NOT NULL,
  candles JSONB NOT NULL, -- Store last 200 candles for backtesting

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_signal_history_user_id ON signal_history(user_id);
CREATE INDEX IF NOT EXISTS idx_signal_history_symbol ON signal_history(symbol);
CREATE INDEX IF NOT EXISTS idx_signal_history_outcome ON signal_history(outcome);
CREATE INDEX IF NOT EXISTS idx_signal_history_confidence ON signal_history(confidence);
CREATE INDEX IF NOT EXISTS idx_signal_history_created_at ON signal_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_history_pending_signals ON signal_history(outcome) WHERE outcome = 'PENDING';

-- ============================================================
-- TABLE: strategy_performance
-- Aggregated performance metrics per symbol and confidence bracket
-- ============================================================
CREATE TABLE IF NOT EXISTS strategy_performance (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,

  -- Grouping dimensions
  symbol TEXT NOT NULL,
  confidence_bracket TEXT NOT NULL CHECK (confidence_bracket IN ('70-79', '80-89', '90-100', 'ALL')),
  strategy_version TEXT NOT NULL,

  -- Performance metrics
  total_signals INTEGER DEFAULT 0,
  tp1_hit INTEGER DEFAULT 0,
  tp2_hit INTEGER DEFAULT 0,
  tp3_hit INTEGER DEFAULT 0,
  stop_hit INTEGER DEFAULT 0,
  expired INTEGER DEFAULT 0,
  manually_closed INTEGER DEFAULT 0,

  -- Calculated metrics
  win_rate DECIMAL(5, 2), -- Percentage (e.g., 75.50)
  avg_profit_pips DECIMAL(10, 2),
  avg_loss_pips DECIMAL(10, 2),
  avg_holding_hours DECIMAL(10, 2),

  -- Timestamps
  last_updated TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one row per user/symbol/bracket/version combination
  UNIQUE(user_id, symbol, confidence_bracket, strategy_version)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategy_performance_user_id ON strategy_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_symbol ON strategy_performance(symbol);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_win_rate ON strategy_performance(win_rate DESC);

-- ============================================================
-- TABLE: strategy_adaptations
-- AI-generated suggestions for strategy improvements
-- ============================================================
CREATE TABLE IF NOT EXISTS strategy_adaptations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,

  -- What pattern AI detected
  pattern_detected TEXT NOT NULL,
  confidence_bracket TEXT NOT NULL,
  symbol TEXT, -- NULL = applies to all symbols

  -- AI's recommendation
  recommendation_title TEXT NOT NULL,
  recommendation_details TEXT NOT NULL,
  reasoning TEXT NOT NULL,

  -- Parameters to adjust (JSON format)
  suggested_changes JSONB NOT NULL,
  -- Example: {"rsi_threshold": {"from": 70, "to": 65}, "adx_threshold": {"from": 20, "to": 25}}

  -- Expected impact
  expected_win_rate_improvement DECIMAL(5, 2), -- Percentage points (e.g., +15.00 means +15%)
  based_on_signals INTEGER NOT NULL, -- How many signals this analysis is based on

  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  user_decision_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,

  -- Strategy version tracking
  old_strategy_version TEXT NOT NULL,
  new_strategy_version TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategy_adaptations_user_id ON strategy_adaptations(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_adaptations_status ON strategy_adaptations(status);
CREATE INDEX IF NOT EXISTS idx_strategy_adaptations_created_at ON strategy_adaptations(created_at DESC);

-- ============================================================
-- FUNCTION: Update timestamp on row modification
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for signal_history
DROP TRIGGER IF EXISTS update_signal_history_updated_at ON signal_history;
CREATE TRIGGER update_signal_history_updated_at
  BEFORE UPDATE ON signal_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- FUNCTION: Auto-calculate performance metrics
-- ============================================================
CREATE OR REPLACE FUNCTION calculate_strategy_performance(
  p_user_id VARCHAR,
  p_symbol TEXT,
  p_confidence_bracket TEXT,
  p_strategy_version TEXT
)
RETURNS void AS $$
DECLARE
  v_total_signals INTEGER;
  v_tp1_hit INTEGER;
  v_tp2_hit INTEGER;
  v_tp3_hit INTEGER;
  v_stop_hit INTEGER;
  v_expired INTEGER;
  v_manually_closed INTEGER;
  v_win_rate DECIMAL(5, 2);
  v_avg_profit DECIMAL(10, 2);
  v_avg_loss DECIMAL(10, 2);
  v_avg_holding DECIMAL(10, 2);
  v_min_confidence INTEGER;
  v_max_confidence INTEGER;
BEGIN
  -- Determine confidence range
  IF p_confidence_bracket = '70-79' THEN
    v_min_confidence := 70;
    v_max_confidence := 79;
  ELSIF p_confidence_bracket = '80-89' THEN
    v_min_confidence := 80;
    v_max_confidence := 89;
  ELSIF p_confidence_bracket = '90-100' THEN
    v_min_confidence := 90;
    v_max_confidence := 100;
  ELSE -- 'ALL'
    v_min_confidence := 70;
    v_max_confidence := 100;
  END IF;

  -- Calculate metrics
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE outcome = 'TP1_HIT'),
    COUNT(*) FILTER (WHERE outcome = 'TP2_HIT'),
    COUNT(*) FILTER (WHERE outcome = 'TP3_HIT'),
    COUNT(*) FILTER (WHERE outcome = 'STOP_HIT'),
    COUNT(*) FILTER (WHERE outcome = 'EXPIRED'),
    COUNT(*) FILTER (WHERE outcome = 'MANUALLY_CLOSED'),
    ROUND(
      (COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT'))::DECIMAL /
      NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0)) * 100,
      2
    ),
    AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')),
    AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'),
    AVG(EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600) FILTER (WHERE outcome != 'PENDING')
  INTO
    v_total_signals,
    v_tp1_hit,
    v_tp2_hit,
    v_tp3_hit,
    v_stop_hit,
    v_expired,
    v_manually_closed,
    v_win_rate,
    v_avg_profit,
    v_avg_loss,
    v_avg_holding
  FROM signal_history
  WHERE user_id = p_user_id
    AND symbol = p_symbol
    AND strategy_version = p_strategy_version
    AND confidence >= v_min_confidence
    AND confidence <= v_max_confidence
    AND outcome != 'PENDING';

  -- Upsert into strategy_performance
  INSERT INTO strategy_performance (
    user_id,
    symbol,
    confidence_bracket,
    strategy_version,
    total_signals,
    tp1_hit,
    tp2_hit,
    tp3_hit,
    stop_hit,
    expired,
    manually_closed,
    win_rate,
    avg_profit_pips,
    avg_loss_pips,
    avg_holding_hours,
    last_updated
  ) VALUES (
    p_user_id,
    p_symbol,
    p_confidence_bracket,
    p_strategy_version,
    v_total_signals,
    v_tp1_hit,
    v_tp2_hit,
    v_tp3_hit,
    v_stop_hit,
    v_expired,
    v_manually_closed,
    v_win_rate,
    v_avg_profit,
    v_avg_loss,
    v_avg_holding,
    NOW()
  )
  ON CONFLICT (user_id, symbol, confidence_bracket, strategy_version)
  DO UPDATE SET
    total_signals = EXCLUDED.total_signals,
    tp1_hit = EXCLUDED.tp1_hit,
    tp2_hit = EXCLUDED.tp2_hit,
    tp3_hit = EXCLUDED.tp3_hit,
    stop_hit = EXCLUDED.stop_hit,
    expired = EXCLUDED.expired,
    manually_closed = EXCLUDED.manually_closed,
    win_rate = EXCLUDED.win_rate,
    avg_profit_pips = EXCLUDED.avg_profit_pips,
    avg_loss_pips = EXCLUDED.avg_loss_pips,
    avg_holding_hours = EXCLUDED.avg_holding_hours,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- COMMENTS
-- ============================================================
COMMENT ON TABLE signal_history IS 'Tracks all 70%+ confidence trading signals and their outcomes';
COMMENT ON TABLE strategy_performance IS 'Aggregated performance metrics for strategy analysis';
COMMENT ON TABLE strategy_adaptations IS 'AI-generated suggestions for improving trading strategy';
COMMENT ON COLUMN signal_history.candles IS 'Last 200 5-minute candles stored as JSONB for AI backtesting';
COMMENT ON COLUMN signal_history.indicators IS 'All indicator values (MA, RSI, ADX, etc.) at signal generation time';
COMMENT ON COLUMN signal_history.expires_at IS 'Signals auto-expire 48 hours after creation if no TP/SL hit';

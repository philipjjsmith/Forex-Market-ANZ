-- Path A: AI Backtester Fix - Post-Signal Candle Data Storage
-- Purpose: Store 96 hours of 15-min candles AFTER each signal for accurate backtesting
-- Enables testing if new stop loss parameters would actually be hit

-- ============================================================
-- TABLE: signal_candle_data
-- Stores historical candle data AFTER signal creation
-- ============================================================
CREATE TABLE IF NOT EXISTS signal_candle_data (
  id SERIAL PRIMARY KEY,
  signal_history_id VARCHAR NOT NULL REFERENCES signal_history(id) ON DELETE CASCADE,

  -- Candle timestamp and OHLC data
  candle_time TIMESTAMPTZ NOT NULL,
  open DECIMAL(10, 5) NOT NULL,
  high DECIMAL(10, 5) NOT NULL,
  low DECIMAL(10, 5) NOT NULL,
  close DECIMAL(10, 5) NOT NULL,
  volume INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate candles for same signal
  UNIQUE(signal_history_id, candle_time)
);

-- ============================================================
-- INDEXES for performance
-- ============================================================

-- Primary lookup: Get all candles for a signal, ordered by time
CREATE INDEX IF NOT EXISTS idx_signal_candle_data_signal_id
  ON signal_candle_data(signal_history_id, candle_time);

-- Query optimization: Find signals that have candle data
CREATE INDEX IF NOT EXISTS idx_signal_candle_data_signal_lookup
  ON signal_candle_data(signal_history_id);

-- Time-based queries
CREATE INDEX IF NOT EXISTS idx_signal_candle_data_time
  ON signal_candle_data(candle_time);

-- ============================================================
-- COMMENTS for documentation
-- ============================================================
COMMENT ON TABLE signal_candle_data IS
  'Stores 96 hours of 15-minute candles AFTER signal creation for backtesting accuracy';

COMMENT ON COLUMN signal_candle_data.signal_history_id IS
  'References the signal this candle data belongs to';

COMMENT ON COLUMN signal_candle_data.candle_time IS
  'Timestamp of this candle (15-minute intervals)';

COMMENT ON COLUMN signal_candle_data.open IS
  'Opening price of the candle';

COMMENT ON COLUMN signal_candle_data.high IS
  'Highest price reached during candle period';

COMMENT ON COLUMN signal_candle_data.low IS
  'Lowest price reached during candle period';

COMMENT ON COLUMN signal_candle_data.close IS
  'Closing price of the candle';

COMMENT ON COLUMN signal_candle_data.volume IS
  'Trading volume during candle period (tick count for forex)';

-- ============================================================
-- STATISTICS
-- ============================================================

-- Expected storage per signal: 384 candles × ~114 bytes = ~44 KB
-- Total for 1,037 signals: ~45 MB
-- With PostgreSQL overhead (2x): ~90 MB
-- Well within Supabase free tier (10 GB)

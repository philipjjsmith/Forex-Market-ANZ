-- Winning Trades Enhancement - Migration 2: Create partial_exits table
-- Phase: Backend Foundation (Day 1)
-- Date: 2025-12-17
-- Purpose: Track individual TP1, TP2, TP3 exits separately for detailed performance analysis

-- Create partial_exits table
CREATE TABLE IF NOT EXISTS partial_exits (
  id SERIAL PRIMARY KEY,
  signal_id VARCHAR NOT NULL,
  exit_level VARCHAR(5) NOT NULL CHECK (exit_level IN ('TP1', 'TP2', 'TP3')),
  exit_price DECIMAL(10, 5) NOT NULL,
  exit_time TIMESTAMPTZ NOT NULL,
  profit_pips DECIMAL(10, 2) NOT NULL,
  position_size_closed DECIMAL(5, 2) NOT NULL, -- percentage (e.g., 33.33 for TP1)
  slippage DECIMAL(10, 2) DEFAULT 0.0,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key constraint (note: signal_history uses signal_id as unique, not primary key)
  CONSTRAINT fk_partial_exits_signal
    FOREIGN KEY (signal_id)
    REFERENCES signal_history(signal_id)
    ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_partial_exits_signal ON partial_exits(signal_id);
CREATE INDEX IF NOT EXISTS idx_partial_exits_exit_time ON partial_exits(exit_time DESC);
CREATE INDEX IF NOT EXISTS idx_partial_exits_exit_level ON partial_exits(exit_level);

-- Add comments for documentation
COMMENT ON TABLE partial_exits IS 'Tracks individual take profit exits (TP1, TP2, TP3) for granular performance analysis';
COMMENT ON COLUMN partial_exits.signal_id IS 'References signal_history.signal_id';
COMMENT ON COLUMN partial_exits.exit_level IS 'Which take profit level was hit (TP1/TP2/TP3)';
COMMENT ON COLUMN partial_exits.position_size_closed IS 'Percentage of position closed at this exit (typically 33.33% per TP)';
COMMENT ON COLUMN partial_exits.slippage IS 'Slippage in pips at exit (positive = worse price, negative = better price)';

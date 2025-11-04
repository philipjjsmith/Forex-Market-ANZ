-- Auto-Trader Database Schema Migration
-- Run this in your Supabase SQL Editor

-- Create auto_trades table
CREATE TABLE IF NOT EXISTS auto_trades (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_id VARCHAR NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  type VARCHAR(10) NOT NULL, -- LONG or SHORT
  entry_price DECIMAL(10, 5) NOT NULL,
  entry_time TIMESTAMP NOT NULL,
  stop_loss DECIMAL(10, 5) NOT NULL,
  take_profit DECIMAL(10, 5) NOT NULL,
  exit_price DECIMAL(10, 5),
  exit_time TIMESTAMP,
  exit_reason VARCHAR(20), -- HIT_TP, HIT_SL, MANUAL, TIME_LIMIT
  profit_loss DECIMAL(10, 2),
  confidence INTEGER NOT NULL,
  position_size DECIMAL(10, 2) NOT NULL,
  status VARCHAR(10) NOT NULL, -- OPEN or CLOSED
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create auto_trader_sessions table
CREATE TABLE IF NOT EXISTS auto_trader_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  starting_balance DECIMAL(10, 2) NOT NULL,
  ending_balance DECIMAL(10, 2),
  total_trades INTEGER DEFAULT 0 NOT NULL,
  winning_trades INTEGER DEFAULT 0 NOT NULL,
  losing_trades INTEGER DEFAULT 0 NOT NULL,
  total_profit DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  total_loss DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  net_pl DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  win_rate DECIMAL(5, 2) DEFAULT 0 NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create strategy_metrics table
CREATE TABLE IF NOT EXISTS strategy_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  confidence_range VARCHAR(20) NOT NULL, -- e.g., "70-80"
  total_trades INTEGER DEFAULT 0 NOT NULL,
  winning_trades INTEGER DEFAULT 0 NOT NULL,
  losing_trades INTEGER DEFAULT 0 NOT NULL,
  avg_profit DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  avg_loss DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  win_rate DECIMAL(5, 2) DEFAULT 0 NOT NULL,
  profit_factor DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_auto_trades_user_id ON auto_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trades_status ON auto_trades(status);
CREATE INDEX IF NOT EXISTS idx_auto_trades_symbol ON auto_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_auto_trades_entry_time ON auto_trades(entry_time);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auto_trader_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON auto_trader_sessions(start_time);

CREATE INDEX IF NOT EXISTS idx_metrics_user_id ON strategy_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_symbol ON strategy_metrics(symbol);
CREATE INDEX IF NOT EXISTS idx_metrics_confidence_range ON strategy_metrics(confidence_range);

-- Grant permissions (adjust as needed for your RLS policies)
ALTER TABLE auto_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_trader_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (users can only access their own data)
CREATE POLICY "Users can view their own trades"
  ON auto_trades FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own trades"
  ON auto_trades FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own trades"
  ON auto_trades FOR UPDATE
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view their own sessions"
  ON auto_trader_sessions FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own sessions"
  ON auto_trader_sessions FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own sessions"
  ON auto_trader_sessions FOR UPDATE
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view their own metrics"
  ON strategy_metrics FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert their own metrics"
  ON strategy_metrics FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update their own metrics"
  ON strategy_metrics FOR UPDATE
  USING (auth.uid()::text = user_id);

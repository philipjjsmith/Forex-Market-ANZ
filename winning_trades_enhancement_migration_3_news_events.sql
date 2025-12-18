-- Winning Trades Enhancement - Migration 3: Create news_events table
-- Phase: Backend Foundation (Day 1)
-- Date: 2025-12-17
-- Purpose: Cache economic calendar events from JBlanked and Myfxbook APIs for market context display

-- Create news_events table
CREATE TABLE IF NOT EXISTS news_events (
  id SERIAL PRIMARY KEY,
  event_time TIMESTAMPTZ NOT NULL,
  currency VARCHAR(3) NOT NULL,
  event_name TEXT NOT NULL,
  impact VARCHAR(10) NOT NULL CHECK (impact IN ('HIGH', 'MEDIUM', 'LOW')),
  actual VARCHAR(50),
  forecast VARCHAR(50),
  previous VARCHAR(50),
  source VARCHAR(50) NOT NULL CHECK (source IN ('jblanked', 'myfxbook', 'demo')),
  cached_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate events
  UNIQUE(event_time, currency, event_name)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_news_events_time ON news_events(event_time);
CREATE INDEX IF NOT EXISTS idx_news_events_currency ON news_events(currency);
CREATE INDEX IF NOT EXISTS idx_news_events_impact ON news_events(impact);
CREATE INDEX IF NOT EXISTS idx_news_events_cached ON news_events(cached_at);

-- Add comments for documentation
COMMENT ON TABLE news_events IS 'Cached economic calendar events from JBlanked and Myfxbook APIs';
COMMENT ON COLUMN news_events.event_time IS 'When the economic event occurs (UTC timezone)';
COMMENT ON COLUMN news_events.currency IS 'Currency affected by the event (e.g., USD, EUR, GBP)';
COMMENT ON COLUMN news_events.impact IS 'Event impact level: HIGH (red), MEDIUM (yellow), LOW (gray)';
COMMENT ON COLUMN news_events.actual IS 'Actual value released (null before event)';
COMMENT ON COLUMN news_events.forecast IS 'Market forecast/expectation';
COMMENT ON COLUMN news_events.previous IS 'Previous value for comparison';
COMMENT ON COLUMN news_events.source IS 'API source: jblanked, myfxbook, or demo';
COMMENT ON COLUMN news_events.cached_at IS 'When this event was cached (for TTL management)';

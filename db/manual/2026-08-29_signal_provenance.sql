-- Signal input provenance — 2026-08-29
--
-- WHY THIS EXISTS
-- ---------------
-- The backtest reproduction gate (docs/BACKTEST_PREREGISTRATION.md §9, Amendment 1) cannot
-- reach 100% because production never recorded WHICH data it analysed. Evidence:
--
--   * signals 2026-05-11T08:09 and 2026-05-12T07:02 carry byte-identical indicator blobs
--     23 hours apart — live market data cannot do that. A stale 1H cache was served twice.
--   * the Twelve Data cache key omitted `outputsize` until commit 5895423, so a 200-bar
--     request and a 1440-bar request collided on one entry.
--   * `fetchHistoricalCandles` falls back to UNBOUNDED stale cache on HTTP 429.
--
-- With only `created_at` (the INSERT time, not the analysis time) and the resulting
-- indicators, the inputs are unrecoverable. This table records them at generation time so
-- reproduction becomes exactly verifiable instead of inferred.
--
-- It also records bars that did NOT fire. `signal_history` holds only the fires, which is
-- half a confusion matrix; the false-positive arm the gate needs was never observable.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS signal_provenance (
  id                BIGSERIAL PRIMARY KEY,

  -- The exact instant handed to analyze() as `asOf`. NOT the insert time. This is the single
  -- most important column: it is what `created_at` failed to be.
  analyzed_at       TIMESTAMPTZ NOT NULL,
  symbol            TEXT        NOT NULL,
  strategy_version  TEXT        NOT NULL,

  -- Outcome of the analysis attempt.
  produced          BOOLEAN     NOT NULL,
  signal_id         TEXT,                 -- FK-by-convention to signal_history.signal_id
  confidence        INTEGER,
  rejection_reason  TEXT,                 -- e.g. ADX_BELOW_THRESHOLD, NO_ENTRY_SIGNAL

  -- Per-timeframe fingerprint: {count, firstTs, lastTs, last:{o,h,l,c}, sha256}.
  -- sha256 covers the full ordered array, so a replay that rebuilds the same series can be
  -- proven identical rather than argued to be close.
  inputs            JSONB       NOT NULL,

  -- How each series was obtained: live | cache | stale-cache, plus age in minutes.
  cache_meta        JSONB,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_provenance_symbol_time
  ON signal_provenance (symbol, analyzed_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_provenance_signal_id
  ON signal_provenance (signal_id) WHERE signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_provenance_produced
  ON signal_provenance (produced, analyzed_at DESC);

-- Grants mirror the existing tables so the app role can write provenance.
GRANT SELECT, INSERT ON signal_provenance TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE signal_provenance_id_seq TO anon, authenticated, service_role;

COMMENT ON TABLE signal_provenance IS
  'Exact inputs to each analyze() call, including bars that did not fire. Added 2026-08-29 so backtest reproduction is verifiable rather than inferred.';
COMMENT ON COLUMN signal_provenance.analyzed_at IS
  'The asOf handed to analyze(). signal_history.created_at is the INSERT time and lags this by pipeline latency (measured 0-16 min).';
COMMENT ON COLUMN signal_provenance.cache_meta IS
  'source=stale-cache indicates the unbounded HTTP-429 fallback — the mechanism behind unreproducible historical signals.';

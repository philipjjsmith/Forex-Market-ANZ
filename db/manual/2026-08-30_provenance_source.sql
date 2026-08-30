-- signal_provenance: distinguish production analyses from probe runs — 2026-08-30
--
-- WHY
-- All 38 rows in this table were written by scripts/backtest/provenance-probe.ts, not by
-- production, and every one was timestamped on a Saturday or Sunday — outside market hours and
-- outside any kill zone. One is `produced = true, confidence = 100` for USD/CHF on SUNDAY data.
--
-- The table had no way to tell the two apart, so any gate consuming it for a confusion matrix
-- would have read weekend probe fires as production evidence. That silently undermines the very
-- reproduction verification the table exists to provide.
--
-- Idempotent. Safe to re-run.

BEGIN;

ALTER TABLE signal_provenance
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'production';

COMMENT ON COLUMN signal_provenance.source IS
  'production = written by generateSignals(); probe = written by provenance-probe.ts. Any '
  'reproduction gate or confusion matrix MUST filter to production, or it counts synthetic '
  'probe runs (including market-closed ones) as live evidence.';

-- Reclassify the existing rows. Production only ever runs inside a kill zone (07:00-09:59 and
-- 12:00-14:59 UTC) on a weekday, so anything outside that cannot have come from generateSignals().
UPDATE signal_provenance
SET source = 'probe'
WHERE source = 'production'
  AND (
        EXTRACT(dow  FROM analyzed_at AT TIME ZONE 'UTC') IN (0, 6)
     OR EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') NOT BETWEEN 7 AND 14
     OR EXTRACT(hour FROM analyzed_at AT TIME ZONE 'UTC') IN (10, 11)
  );

CREATE INDEX IF NOT EXISTS idx_signal_provenance_source
  ON signal_provenance (source, analyzed_at DESC);

COMMIT;

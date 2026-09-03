-- Record every signal-generation RUN — 2026-09-03
--
-- WHY
-- ---
-- `/api/cron/generate-signals` calls generateSignals() FIRE-AND-FORGET:
--
--     signalGenerator.generateSignals().catch(err => console.error(err));
--     res.json({ success: true, message: 'Signal generation triggered' });
--
-- The response is sent before the work starts, so the endpoint returns `success: true` whatever
-- happens next. UptimeRobot sees 200 OK. And generateSignals() ALSO wraps its body in a try/catch
-- that logs and swallows, so a mid-run failure may not even reject the promise.
--
-- A failed generation run is therefore doubly invisible: no HTTP error, no rejected promise, and
-- the only trace is a Render console line that does not survive the free tier's spin-down. The
-- symptom is indistinguishable from a quiet market — "no signals today" reads identically whether
-- the market offered nothing or the pipeline died at the first pair.
--
-- That matters more than it sounds. Signals are already rare (5 produced in 303 production
-- analyses), so a silently broken run costs a day and looks like nothing happened.
--
-- One row per run makes the difference observable: a run that started and never finished, or
-- finished with an error, is a fact in the database rather than an inference from absence.
--
-- SAFETY: purely additive, one new table, nothing reads it yet.

CREATE TABLE IF NOT EXISTS generation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  -- NULL finished_at on an old row = the run died without reaching its own finally block.
  ok                boolean,
  in_kill_zone      boolean,
  kill_zone_name    text,
  symbols_attempted integer NOT NULL DEFAULT 0,
  signals_generated integer NOT NULL DEFAULT 0,
  signals_tracked   integer NOT NULL DEFAULT 0,
  error             text
);

CREATE INDEX IF NOT EXISTS idx_generation_runs_started ON generation_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_runs_failed  ON generation_runs (started_at DESC)
  WHERE ok IS NOT TRUE;

COMMENT ON TABLE generation_runs IS
  'One row per signal-generation run. Exists because the cron is fire-and-forget and returns '
  'success: true before the work starts, so a failed run was indistinguishable from a quiet '
  'market. A NULL finished_at on an old row means the run died mid-flight.';

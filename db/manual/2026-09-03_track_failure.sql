-- Record whether a produced signal was actually TRACKED — 2026-09-03
--
-- WHY
-- ---
-- On 2026-09-02 the generator produced FIVE signals in production. Three reached
-- `signal_history`. Two did not — and they were confidence **124**, the two highest readings in
-- the entire dataset. The system then traded a confidence-119 signal forty minutes later.
--
-- Every documented gate was traced and all of them should have passed: the 240-minute cooldown had
-- expired at 11:21, the prior PENDING row cleared at 11:28, the daily cap stood at 1 of 3,
-- confidence 124 clears the 70 threshold, and the correlation guard only sets a flag — no gate
-- exists between it and `trackSignal`. `recordAnalysis` runs immediately before `trackSignal` and
-- succeeded both times, so the process was alive and the signal object existed.
--
-- The only remaining explanation is that `trackSignal` itself threw. Its catch logs to Render's
-- console, which does not survive the free tier's spin-down — so the cause is unrecoverable and
-- the loss is invisible in the data. `signal_provenance.produced = true` with a NULL `signal_id`
-- is currently indistinguishable from a linking hiccup.
--
-- These columns make the outcome of tracking a FACT rather than an inference:
--   tracked = true   -> trackSignal returned, the row is in signal_history
--   tracked = false  -> it threw, and `track_error` says what it said
--   tracked = null   -> not attempted (analysis did not produce a signal, or confidence < 70)
--
-- This is the same lesson as ctrader_executions.alert_sent and the Telegram sendText result: a
-- swallowed failure in a non-fatal path is correct behaviour AND an invisible one unless the
-- outcome is written down.
--
-- SAFETY: two nullable columns on an existing table. Nothing reads them yet.

ALTER TABLE signal_provenance ADD COLUMN IF NOT EXISTS tracked     boolean;
ALTER TABLE signal_provenance ADD COLUMN IF NOT EXISTS track_error text;

COMMENT ON COLUMN signal_provenance.tracked IS
  'Did trackSignal() succeed for this produced signal? NULL = not attempted. FALSE with '
  'track_error = it threw. Exists because two confidence-124 signals vanished on 2026-09-02 with '
  'no durable record of why.';

CREATE INDEX IF NOT EXISTS idx_signal_provenance_track_failed
  ON signal_provenance (analyzed_at DESC) WHERE tracked IS FALSE;

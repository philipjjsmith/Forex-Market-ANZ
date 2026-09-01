-- cTrader execution record — 2026-09-01
--
-- WHY THIS EXISTS
-- ---------------
-- `ctraderExecutor.executeSignal()` places orders on the broker and records NOTHING. Verified by
-- grep across the whole repo on 2026-09-01: there is not a single writer to `auto_trades` in any
-- file. That table was designed for a simulated auto-trader (its `entry_price` is NOT NULL, so a
-- FAILED attempt cannot even be represented) and no code has ever inserted into it.
--
-- The consequence is that the system cannot answer the most basic question about itself:
-- "did we actually take that trade?" The only trace an execution leaves is a console.log on
-- Render's free tier, where logs are ephemeral. After a restart there is no record that an order
-- was sent, no positionId, no fill price, no volume, and no error for the ones that failed.
--
-- This is the same lesson `signal_provenance` was built on and it is repeated here deliberately:
-- RECORD THE NON-EVENTS TOO. A signal that was skipped because the arming switch was off, or
-- because the tier was MEDIUM, or because the correlation guard escalated it, looks identical
-- from the database to a signal the executor never saw. "Nothing happened" is precisely the case
-- you cannot diagnose after the fact, so every decision gets a row — skips included.
--
-- SAFETY
-- ------
-- Purely additive. Creates one new table and its indexes. Touches no existing table, no view, and
-- no column. Nothing reads it yet, so deploying the code before or after this migration is safe
-- in either order: the writer catches its own errors and never blocks execution.

CREATE TABLE IF NOT EXISTS ctrader_executions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- what we were asked to do
  signal_id             text,                    -- NULL for operator smoke tests
  symbol                text        NOT NULL,
  side                  text,                    -- LONG / SHORT
  tier                  text,
  confidence            integer,
  signal_entry          numeric,
  signal_stop           numeric,
  signal_tp1            numeric,
  position_size_percent numeric,

  -- what we decided. 'skipped_*' rows are the whole point of this table.
  status                text        NOT NULL,
  skip_reason           text,

  -- where it was sent
  mode                  text,                    -- demo / live
  host                  text,
  account_id            bigint,
  account_is_live       boolean,
  broker_symbol_id      integer,
  requested_volume      bigint,
  lots                  numeric,

  -- what the broker said.
  -- executionType 2 = ORDER_ACCEPTED, 3 = ORDER_FILLED. Acceptance is NOT a fill; the project
  -- already learned this on 2026-08-31 and executeSignal was still logging "EXECUTED" on a bare
  -- execution event. Both are stored so the distinction can never be lost again.
  execution_type        integer,
  order_id              bigint,
  position_id           bigint,
  fill_price            numeric,
  error                 text,

  -- reconcile (2124/2125) is what actually settles whether a position exists
  reconciled_at         timestamptz,
  reconciled_open       boolean,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctrader_executions_created  ON ctrader_executions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctrader_executions_signal   ON ctrader_executions (signal_id);
CREATE INDEX IF NOT EXISTS idx_ctrader_executions_status   ON ctrader_executions (status);
CREATE INDEX IF NOT EXISTS idx_ctrader_executions_position ON ctrader_executions (position_id);

COMMENT ON TABLE ctrader_executions IS
  'Every cTrader execution DECISION, including the skips. A skipped signal and a signal the '
  'executor never saw are indistinguishable without this. status: skipped_tier, skipped_disabled, '
  'skipped_unconfigured, skipped_zero_volume, sent, accepted, filled, rejected, error.';

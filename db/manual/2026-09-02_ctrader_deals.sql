-- Broker deal history — 2026-09-02
--
-- WHY THIS EXISTS
-- ---------------
-- Every win/loss and pip figure in this system is MODELLED. `outcome-validator.ts` decides what
-- happened to a signal by scanning Twelve Data candles for a touch of the stop or the target. It
-- has never once been compared against what the broker actually did, because nothing recorded
-- what the broker actually did.
--
-- That gap matters more than it sounds. The model assumes a fill exactly at the signal's entry
-- price, an exit exactly at the stop or target, and no slippage, swap or commission. A real fill
-- happens at a real price, a real exit can gap straight through a stop, and holding overnight
-- costs swap. `ctrader_executions` closed half of this on 2026-09-01 by recording that an order
-- was placed — it still records nothing about how the position ENDED.
--
-- ProtoOADeal is the broker's own record of every execution. A deal carrying
-- `closePositionDetail` is a CLOSING deal, and it reports realised grossProfit, swap, commission
-- and the resulting account balance. That is ground truth, and it is the only thing that can
-- falsify the model.
--
-- MONEY VALUES ARE SCALED — READ THIS BEFORE TOUCHING THE NUMBERS
-- --------------------------------------------------------------
-- Monetary fields are integers scaled by `moneyDigits`, which is an EXPONENT. The docs' own
-- example: moneyDigits = 8 means 10053099944 / 10^8 = 100.53099944.
--
-- Storing the raw integer as if it were currency would overstate profit by a factor of one
-- HUNDRED MILLION. This project has already shipped exactly this class of bug once — calcVolume
-- was 100,000x wrong because cTrader volume is in centi-units — so the scaling is applied on the
-- way IN and the raw payload is kept alongside it, so a scaling error is always recoverable
-- rather than silently baked into the record.
--
-- Volumes are in cents of base currency (1 lot = 100,000 units = 10,000,000), the same scale
-- `LOTS_TO_VOLUME` already uses.
--
-- SAFETY
-- ------
-- Purely additive: one new table, plus four nullable columns on ctrader_executions. Touches no
-- existing column, no view, and nothing that currently reads. Read-only against the broker —
-- fetching deal history places, modifies and closes nothing.

CREATE TABLE IF NOT EXISTS ctrader_deals (
  deal_id            bigint PRIMARY KEY,          -- broker's own id; makes the sync idempotent
  order_id           bigint,
  position_id        bigint,
  symbol_id          integer,
  trade_side         integer,                     -- 1 BUY, 2 SELL
  volume             bigint,                      -- cents of base currency
  filled_volume      bigint,
  execution_price    numeric,
  deal_status        integer,                     -- 2 FILLED, 3 PARTIAL, 4/5 REJECTED, 6 ERROR, 7 MISSED
  commission         numeric,                     -- already de-scaled by money_digits
  money_digits       integer,
  executed_at        timestamptz,

  -- Present only on a CLOSING deal. Its absence is what identifies an opening deal.
  is_close           boolean NOT NULL DEFAULT false,
  entry_price        numeric,
  gross_profit       numeric,                     -- de-scaled
  swap               numeric,                     -- de-scaled
  close_commission   numeric,                     -- de-scaled
  closed_volume      bigint,
  balance_after      numeric,                     -- de-scaled
  net_profit         numeric,                     -- gross + swap + commission, de-scaled

  -- The untouched payload, so any de-scaling mistake stays recoverable instead of permanent.
  raw                jsonb,
  recorded_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ctrader_deals_position ON ctrader_deals (position_id);
CREATE INDEX IF NOT EXISTS idx_ctrader_deals_executed ON ctrader_deals (executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctrader_deals_close    ON ctrader_deals (is_close) WHERE is_close;

-- How a position ENDED, folded back onto the order that opened it.
ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS closed_at        timestamptz;
ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS exit_price       numeric;
ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS realized_pnl     numeric;
ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS broker_entry_price numeric;

-- Watermark for the incremental sync. One row, id = 1, same shape as ctrader_auth.
CREATE TABLE IF NOT EXISTS ctrader_deal_sync (
  id            integer PRIMARY KEY DEFAULT 1,
  last_synced_to timestamptz,
  last_run_at    timestamptz,
  deals_seen     integer NOT NULL DEFAULT 0,
  CONSTRAINT ctrader_deal_sync_single_row CHECK (id = 1)
);

COMMENT ON TABLE ctrader_deals IS
  'Broker ground truth for executions. A row with is_close = true carries realised grossProfit, '
  'swap and commission. Monetary fields are ALREADY de-scaled by money_digits; `raw` holds the '
  'untouched payload so a scaling error stays recoverable.';

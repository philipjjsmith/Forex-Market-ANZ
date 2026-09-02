-- Alert delivery record — 2026-09-02
--
-- WHY
-- ---
-- On 2026-09-02 the system executed two real trades and Philip received NO Telegram alert for
-- either — no signal alert, no execution alert, no outcome alert, no close alert. The cause was
-- `TELEGRAM_CHAT_ID_PAID` holding the literal string "FREE" instead of a chat id, so every
-- HIGH-tier message went to a chat that does not exist ("400: Bad Request: chat not found").
--
-- The configuration error is trivial. What made it COSTLY is that nothing recorded the failure.
-- Every notification path is deliberately non-fatal so a failed alert can never disturb a trade —
-- correct — and `sendText` returns {ok, errors} rather than throwing, so the call sites' try/catch
-- never fired. The result: a full day of missed alerts with no trace anywhere except a Render
-- free-tier log that does not survive a restart.
--
-- These two columns make delivery a FACT IN THE DATABASE rather than an assumption. A failure is
-- now visible in the same place the trade is, and any audit of executions surfaces it immediately.
--
-- SAFETY: two nullable columns on an existing table. Nothing reads them yet.

ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS alert_sent  boolean;
ALTER TABLE ctrader_executions ADD COLUMN IF NOT EXISTS alert_error text;

COMMENT ON COLUMN ctrader_executions.alert_sent IS
  'Did the Telegram execution alert actually reach Telegram? NULL = not attempted. FALSE with '
  'alert_error = attempted and rejected. Exists because a silent alert failure cost a full day '
  'of missed notifications on 2026-09-02.';

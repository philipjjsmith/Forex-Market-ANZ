-- cTrader refresh-token persistence.
--
-- cTrader ROTATES the refresh token on every refresh: the token endpoint returns a new
-- refreshToken and invalidates the one just used. The executor read only `accessToken` from
-- that response and discarded the rest, so the token in CTRADER_REFRESH_TOKEN was dead the
-- moment it was first used. It appeared to work only while the access token stayed cached in
-- memory; the next process restart failed with ACCESS_DENIED.
--
-- That made it unusable in practice rather than merely fragile: Render's free tier spins the
-- instance down on inactivity, so the process restarts constantly, burning a hand-minted token
-- every time.
--
-- Env vars cannot be written at runtime, so the rotating token needs somewhere durable. One
-- row, enforced by the CHECK — there is exactly one cTrader app.
CREATE TABLE IF NOT EXISTS ctrader_auth (
  id            integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_token text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  rotations     integer     NOT NULL DEFAULT 0
);

COMMENT ON TABLE  ctrader_auth IS 'Single-row store for the CURRENT cTrader refresh token. Rotates on every refresh; CTRADER_REFRESH_TOKEN is only the seed.';
COMMENT ON COLUMN ctrader_auth.rotations IS 'Times the token has rotated since seeding. If this stops climbing while refreshes happen, persistence has broken.';

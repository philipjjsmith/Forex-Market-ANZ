/**
 * cTrader Open API — Auto Trade Executor
 * Connects to The5ers cTrader account and auto-places trades when HIGH-tier signals fire.
 *
 * Required Render environment variables:
 *   CTRADER_CLIENT_ID       — from openapi.ctrader.com (your app)
 *   CTRADER_CLIENT_SECRET   — from openapi.ctrader.com (keep private)
 *   CTRADER_REFRESH_TOKEN   — captured by /api/ctrader/callback after OAuth
 *   CTRADER_ACCOUNT_BALANCE — 2500 (The5ers High Stakes starting balance)
 *
 * Protocol: TLS TCP to live.ctraderapi.com:5036 (JSON port — Spotware official docs)
 * Framing:  4-byte big-endian length prefix + UTF-8 JSON body (network byte order)
 * Auth:     AppAuth → GetAccounts → AccountAuth → SymbolLookup → NewOrder
 */

import WebSocket from 'ws';
import { db } from '../db';
import { exchangeRateAPI } from './exchangerate-api';
import { telegramNotifier } from './telegram-notifier';
import { sql } from 'drizzle-orm';
import { EventEmitter } from 'events';

const LIVE_HOST = 'live.ctraderapi.com';
const DEMO_HOST = 'demo.ctraderapi.com';
const LIVE_PORT = 5036;

/** cTrader volume is in centi-units of base currency: 1 lot = 100,000 units = 10,000,000. */
const LOTS_TO_VOLUME = 10_000_000; // JSON port — official docs: "JSON always requires port 5036 (and only this port)"

/**
 * THREE independent switches must ALL be set before a real order can be placed.
 *
 * This file previously hardcoded the LIVE host, filtered accounts to `isLive === true`, threw if
 * no live account existed, and — worst of all — printed a log line telling the operator to set
 * the three credential variables. Setting them was the ONLY remaining gate: credentials present
 * meant live orders, immediately, with no confirmation step.
 *
 * The standing instruction for this project is demo only, never real money. One env var should
 * never be able to cross that line, and "I set the credentials to test the connection" should
 * never place a trade.
 *
 *   CTRADER_ENABLED=true     — arms the executor at all. Absent, nothing connects.
 *   CTRADER_MODE=live        — anything else (or unset) uses the DEMO host and demo accounts.
 *   CTRADER_ALLOW_LIVE=true  — a second, deliberate confirmation for real money.
 *
 * Credentials alone now do nothing.
 */
export const CTRADER_HOSTS = { live: LIVE_HOST, demo: DEMO_HOST } as const;

const ctraderEnabled  = () => process.env.CTRADER_ENABLED === 'true';
const ctraderLiveMode = () =>
  process.env.CTRADER_MODE === 'live' && process.env.CTRADER_ALLOW_LIVE === 'true';

// cTrader Open API payload type numbers (decoded from protobuf binary)
const PT = {
  APP_AUTH_REQ:      2100,
  APP_AUTH_RES:      2101,
  ACCOUNT_AUTH_REQ:  2102,
  ACCOUNT_AUTH_RES:  2103,
  NEW_ORDER_REQ:     2106,
  CLOSE_POSITION_REQ: 2111,
  RECONCILE_REQ:     2124,
  RECONCILE_RES:     2125,
  /** Deal history. Verified against help.ctrader.com/open-api/model-messages on 2026-09-02. */
  DEAL_LIST_REQ:     2133,
  DEAL_LIST_RES:     2134,
  SYMBOLS_LIST_REQ:  2114,
  SYMBOLS_LIST_RES:  2115,
  SYMBOL_BY_ID_REQ:  2116,
  SYMBOL_BY_ID_RES:  2117,
  EXECUTION_EVENT:   2126,
  /**
   * ProtoOAOrderErrorEvent. An order REJECTION arrives as its own payload type, not as the
   * generic ProtoOAErrorRes (2142) — so a rejected order used to produce complete silence
   * and a 20-second 'Timeout waiting for payloadType 2126'.
   *
   * That is the same trap this executor already fell into once: a timeout was the system's
   * only way of reporting a protocol error, and a timeout reads like a network problem. It
   * cost days of misdiagnosis then; it cost an evening here.
   */
  ORDER_ERROR_EVENT: 2132,
  GET_ACCOUNTS_REQ:  2149,
  GET_ACCOUNTS_RES:  2150,
  ERROR_RES:         2142,
  COMMON_ERROR:      50,
} as const;

export interface ExecuteSignalParams {
  /** The signal this order came from, so `ctrader_executions` can be joined to `signal_history`. */
  signalId?: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  targets: number[];
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  /** Percent of balance to risk. MEDIUM signals carry 0 — practice only. */
  positionSizePercent?: number;
}

class CTraderExecutor {
  // Symbol IDs cached after first lookup (broker-specific, stable)
  private symbolIds = new Map<string, number>();

  // Access token cached until near-expiry, refreshed via refresh token
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  private get clientId()    { return process.env.CTRADER_CLIENT_ID; }
  private get clientSecret(){ return process.env.CTRADER_CLIENT_SECRET; }
  private get refreshToken(){ return process.env.CTRADER_REFRESH_TOKEN; }
  private get accountBalance() {
    return parseFloat(process.env.CTRADER_ACCOUNT_BALANCE || '2500');
  }

  /**
   * Env-only view of configuration. Kept because it is synchronous, but it is NOT the gate —
   * see `configured()`. `CTRADER_REFRESH_TOKEN` is a cold-start SEED whose value is dead the
   * moment it is first spent (cTrader rotates on every refresh), so its presence says nothing
   * about whether a usable credential exists.
   */
  get isConfiguredFromEnv(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Whether a usable credential actually exists. THIS is the gate.
   *
   * It used to be the env-only getter above, which checked `CTRADER_REFRESH_TOKEN` while
   * `currentRefreshToken()` reads the PERSISTED token from `ctrader_auth` and treats the env var
   * as a seed. Those two disagreed in the direction that fails silently: delete the spent env
   * seed — the obvious cleanup, and one this file's own comments invite — and every signal is
   * skipped with "Enabled but not configured" while a perfectly good rotated token sits in the
   * database. Nothing would have said so; `auto_trades` was empty either way.
   *
   * No looser than before: client id and secret are still required, and a refresh token must
   * still exist. It is only sourced correctly now.
   */
  async configured(): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) return false;
    return !!(await this.currentRefreshToken());
  }

  /** Demo unless BOTH CTRADER_MODE=live and CTRADER_ALLOW_LIVE=true are set. */
  get isLiveMode(): boolean { return ctraderLiveMode(); }
  private get host(): string { return this.isLiveMode ? LIVE_HOST : DEMO_HOST; }

  // ─── Token management ────────────────────────────────────────────────────

  /**
   * Read the CURRENT refresh token: the persisted one if we have it, else the env seed.
   *
   * CTRADER_REFRESH_TOKEN is a SEED, not the live value. See saveRefreshToken().
   */
  private async currentRefreshToken(): Promise<string | undefined> {
    try {
      const [row]: any = await db.execute(sql`SELECT refresh_token FROM ctrader_auth WHERE id = 1`);
      if (row?.refresh_token) return row.refresh_token as string;
    } catch (err) {
      // A missing table must not make the executor unusable — fall back to the env seed.
      console.error('[cTrader] could not read persisted refresh token:', err instanceof Error ? err.message : err);
    }
    return this.refreshToken;
  }

  /** Persist a rotated refresh token. NEVER logs the value. */
  private async saveRefreshToken(token: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO ctrader_auth (id, refresh_token, updated_at, rotations)
      VALUES (1, ${token}, now(), 1)
      ON CONFLICT (id) DO UPDATE
        SET refresh_token = EXCLUDED.refresh_token,
            updated_at    = now(),
            rotations     = ctrader_auth.rotations + 1
    `);
  }

  /**
   * Exchange the refresh token for an access token, PERSISTING the rotated refresh token.
   *
   * cTrader rotates the refresh token on every refresh — the response carries a new one and
   * invalidates the one just used. This method previously destructured only `accessToken` and
   * `expiresIn`, so the replacement was silently dropped and the env token was dead after its
   * first use. It looked fine until the process restarted and the in-memory access token went
   * away, which on Render's free tier (spins down on inactivity) is constantly.
   *
   * Serialised through `refreshInFlight`: two concurrent refreshes would race, and whichever
   * lost would have spent a token that is now invalid.
   */
  private refreshInFlight: Promise<string> | null = null;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const refreshToken = await this.currentRefreshToken();
      if (!refreshToken) throw new Error('No cTrader refresh token: set CTRADER_REFRESH_TOKEN or seed ctrader_auth.');

      const url = new URL('https://openapi.ctrader.com/apps/token');
      url.searchParams.set('grant_type', 'refresh_token');
      url.searchParams.set('refresh_token', refreshToken);
      url.searchParams.set('client_id', this.clientId!);
      url.searchParams.set('client_secret', this.clientSecret!);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);

      const data = await res.json() as {
        accessToken: string; expiresIn: number; refreshToken?: string; errorCode?: string;
      };
      if (data.errorCode) {
        throw new Error(
          `Token refresh error: ${data.errorCode}. The refresh token is spent or revoked — ` +
          `cTrader rotates it on every use. Re-mint at /api/ctrader/auth-url and update CTRADER_REFRESH_TOKEN.`
        );
      }

      // Persist the ROTATED token before returning. If this write fails the next restart cannot
      // authenticate, so it is loud rather than swallowed.
      if (data.refreshToken && data.refreshToken !== refreshToken) {
        try {
          await this.saveRefreshToken(data.refreshToken);
          console.log('[cTrader] refresh token rotated and persisted ✅');
        } catch (err) {
          console.error('[cTrader] ⚠️  ROTATED TOKEN NOT PERSISTED — the next restart will fail:', err instanceof Error ? err.message : err);
        }
      }

      this.accessToken = data.accessToken;
      this.tokenExpiry = Date.now() + (data.expiresIn - 3600) * 1000;  // refresh 1h early
      console.log('[cTrader] Access token refreshed ✅');
      return this.accessToken;
    })();

    try { return await this.refreshInFlight; }
    finally { this.refreshInFlight = null; }
  }


  // ─── TCP connection ───────────────────────────────────────────────────────

  /**
   * Open a WebSocket to the cTrader proxy.
   *
   * PORT 5036 SPEAKS WEBSOCKET, NOT RAW FRAMED TCP. This previously used tls.connect() with a
   * 4-byte big-endian length prefix — the framing the docs describe for the PROTOBUF transport on
   * 5035 — and cTrader silently discarded every message. Proven directly: an identical
   * ApplicationAuthReq carrying deliberately invalid credentials got 20s of silence over raw TCP
   * on both hosts, and a proper `CH_CLIENT_AUTH_FAILURE` reply in 580ms over wss. That silence is
   * why the executor never worked, on any host, since it was written.
   *
   * WebSocket frames carry their own length, so there is NO manual length prefix here.
   *
   * Uses the `ws` package, not the global WebSocket: global WebSocket only exists on Node 22+, and
   * this repo pins no Node version (no engines field, no .nvmrc, no render.yaml pin), so Render is
   * free to build on Node 20 where the global is undefined. `ws` is already a direct dependency.
   */
  private openConnection(hostOverride?: string): Promise<{ socket: WebSocket; emitter: EventEmitter }> {
    return new Promise((resolve, reject) => {
      const host = hostOverride ?? this.host;
      const url = `wss://${host}:${LIVE_PORT}`;
      const socket = new WebSocket(url);
      const emitter = new EventEmitter();
      emitter.setMaxListeners(20);

      const failTimer = setTimeout(() => {
        try { socket.close(); } catch { /* already closing */ }
        reject(new Error(`WebSocket did not open within 20s (${url})`));
      }, 20000);

      socket.on('open', () => {
        clearTimeout(failTimer);
        console.log(`[cTrader] WebSocket connected to ${url} ✅`);
        resolve({ socket, emitter });
      });

      socket.on('message', (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          console.log(`[cTrader] ← type:${msg.payloadType}`, CTraderExecutor.redact(msg.payload));
          emitter.emit(`type:${msg.payloadType}`, msg);
          // Surface BOTH error shapes rather than letting callers time out blind.
          //   2142 ProtoOAErrorRes      — generic (bad credentials, bad request)
          //   2132 ProtoOAOrderErrorEvent — an order was REJECTED, and it does NOT come back as
          //        2142. Without this branch a rejection is indistinguishable from silence, and
          //        the caller reports "Timeout waiting for payloadType 2126" while the broker has
          //        in fact already answered with the reason.
          if (msg.payloadType === 2142 || msg.payloadType === 2132) {
            const p = msg.payload ?? {};
            const why = [p.errorCode, p.description].filter(Boolean).join(': ') || 'no reason given';
            const tag = msg.payloadType === 2132 ? 'ORDER REJECTED' : 'PROTOCOL ERROR';
            emitter.emit('protoError', new Error(`${tag} — ${why}`));
          }
        } catch { /* ignore non-JSON frames */ }
      });

      socket.on('error', (e: any) => {
        clearTimeout(failTimer);
        reject(new Error(`WebSocket error connecting to ${url}: ${e?.message ?? e}`));
      });

      socket.on('close', (code: number) => {
        clearTimeout(failTimer);
        emitter.emit('closed', code);
      });
    });
  }

  private msgSeq = 0;

  /** Redact anything secret before it can reach a log sink. */
  private static redact(payload: any): string {
    const SECRET = /^(clientId|clientSecret|accessToken|refreshToken)$/i;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload ?? {})) {
      safe[k] = SECRET.test(k) ? `<redacted:${String(v).length}chars>` : v;
    }
    return JSON.stringify(safe).slice(0, 150);
  }

  private send(socket: WebSocket, payloadType: number, payload: object): void {
    // clientMsgId is how cTrader correlates a reply to its request.
    const clientMsgId = `m${Date.now()}_${++this.msgSeq}`;
    // NEVER log the raw payload: it carries clientSecret and access tokens.
    console.log(`[cTrader] → type:${payloadType}`, CTraderExecutor.redact(payload));
    // WebSocket frames are self-delimiting — do NOT prepend a length prefix here.
    socket.send(JSON.stringify({ clientMsgId, payloadType, payload }));
  }

  private waitFor(emitter: EventEmitter, payloadType: number, timeoutMs = 25000): Promise<any> {
    return new Promise((resolve, reject) => {
      const onMsg = (m: any) => { cleanup(); resolve(m); };
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timeout (${timeoutMs}ms) waiting for payloadType ${payloadType}`)); }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        emitter.off(`type:${payloadType}`, onMsg);
        emitter.off('protoError', onErr);
      };
      emitter.once(`type:${payloadType}`, onMsg);
      emitter.once('protoError', onErr);
    });
  }


  // ─── Position sizing ──────────────────────────────────────────────────────

  private calcVolume(symbol: string, slPips: number, positionSizePercent = 1.0): number {
    // Honour the signal's own sizing. This was hardcoded to 1%, so if the HIGH-tier guard were
    // ever relaxed a MEDIUM signal (positionSizePercent = 0, practice only) would have been
    // sized as a full live trade.
    const pct = Number.isFinite(positionSizePercent) ? Math.max(0, positionSizePercent) : 1.0;
    if (pct <= 0) return 0;
    const riskUsd        = this.accountBalance * (pct / 100);
    const pipValuePerLot = symbol.includes('JPY') ? 9 : 10; // USD value per pip per standard lot
    const lots = Math.min(10, Math.max(0.01,
      Math.round((riskUsd / (slPips * pipValuePerLot)) * 100) / 100
    ));
    // cTrader volume is in CENTI-UNITS of the base currency, so 1 lot (100,000 units) is
    // 10,000,000 — not 100. Measured against the broker on 2026-08-31: EURUSD reports
    // minVolume = stepVolume = 100000, which is exactly 0.01 lots at this scale and confirms it.
    //
    // The old `lots * 100` was 100,000x too small: a 1-lot order sent volume=100, far BELOW the
    // broker's minimum, so every production order would have been rejected. It went unnoticed
    // because the executor spoke the wrong transport and no order ever reached a broker to be
    // rejected. The caller clamps to the symbol's real min/step before sending.
    return Math.round(lots * LOTS_TO_VOLUME);
  }

  /**
   * READ-ONLY diagnostic. Authenticates and enumerates the accounts on this cTID, reporting
   * each one's isLive flag. **Places no orders and sends no NEW_ORDER_REQ.**
   *
   * Exists because you cannot safely configure the executor without knowing whether a DEMO
   * account exists: demo mode selects `isLive === false`, and if the only account is live the
   * connection must fail rather than silently trade real money. Deliberately does NOT require
   * CTRADER_ENABLED — reading the account list is not execution.
   */
  async listAccounts(hostOverride?: string, timeoutMs = 25000): Promise<{ host: string; mode: string; accounts: { id: unknown; isLive: boolean }[] }> {
    if (!(await this.configured())) throw new Error('cTrader credentials are not configured');
    const accessToken = await this.getAccessToken();
    const { socket, emitter } = await this.openConnection(hostOverride);
    try {
      this.send(socket, PT.APP_AUTH_REQ, { clientId: this.clientId!, clientSecret: this.clientSecret! });
      await this.waitFor(emitter, PT.APP_AUTH_RES, timeoutMs);
      this.send(socket, PT.GET_ACCOUNTS_REQ, { accessToken });
      const msg = await this.waitFor(emitter, PT.GET_ACCOUNTS_RES, timeoutMs);
      const all: any[] = msg.payload?.ctidTraderAccount ?? [];
      return {
        host: hostOverride ?? this.host,
        mode: this.isLiveMode ? 'live' : 'demo',
        accounts: all.map(a => ({ id: a.ctidTraderAccountId, isLive: a.isLive === true })),
      };
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  // ─── Main execution flow ──────────────────────────────────────────────────

  /**
   * Record one execution DECISION, skips included.
   *
   * Before 2026-09-01 this path recorded nothing at all — no writer to `auto_trades` existed
   * anywhere in the repo — so the only evidence an order was ever placed was a console.log on
   * Render's free tier, where logs do not survive a restart. The system could not answer
   * "did we take that trade?", which is the one question auto-execution has to be able to answer.
   *
   * Skips are recorded for the reason `signal_provenance` records non-fires: a signal that was
   * skipped because the arming switch was off is indistinguishable, from the database, from a
   * signal the executor never saw. "Nothing happened" is the case you cannot diagnose later.
   *
   * NEVER throws. A bookkeeping failure must not stop or alter a trade.
   */
  async record(row: Record<string, any>): Promise<string | null> {
    try {
      const r = (await db.execute(sql`
        INSERT INTO ctrader_executions
          (signal_id, symbol, side, tier, confidence, signal_entry, signal_stop, signal_tp1,
           position_size_percent, status, skip_reason, mode, host, account_id, account_is_live,
           broker_symbol_id, requested_volume, lots, execution_type, order_id, position_id,
           fill_price, error, reconciled_at, reconciled_open)
        VALUES
          (${row.signalId ?? null}, ${row.symbol ?? null}, ${row.side ?? null}, ${row.tier ?? null},
           ${row.confidence ?? null}, ${row.signalEntry ?? null}, ${row.signalStop ?? null},
           ${row.signalTp1 ?? null}, ${row.positionSizePercent ?? null}, ${row.status},
           ${row.skipReason ?? null}, ${row.mode ?? null}, ${row.host ?? null},
           ${row.accountId ?? null}, ${row.accountIsLive ?? null}, ${row.brokerSymbolId ?? null},
           ${row.requestedVolume ?? null}, ${row.lots ?? null}, ${row.executionType ?? null},
           ${row.orderId ?? null}, ${row.positionId ?? null}, ${row.fillPrice ?? null},
           ${row.error ?? null}, ${row.reconciledAt ?? null}, ${row.reconciledOpen ?? null})
        RETURNING id
      `)) as any[];
      return r?.[0]?.id ?? null;
    } catch (e: any) {
      console.error('[cTrader] could not record execution decision:', e?.message ?? e);
      return null;
    }
  }

  /** Update a row written earlier in the same attempt. Never throws. */
  private async amend(id: string | null, patch: Record<string, any>): Promise<void> {
    if (!id) return;
    try {
      await db.execute(sql`
        UPDATE ctrader_executions SET
          status          = COALESCE(${patch.status ?? null}, status),
          execution_type  = COALESCE(${patch.executionType ?? null}, execution_type),
          order_id        = COALESCE(${patch.orderId ?? null}, order_id),
          position_id     = COALESCE(${patch.positionId ?? null}, position_id),
          fill_price      = COALESCE(${patch.fillPrice ?? null}, fill_price),
          error           = COALESCE(${patch.error ?? null}, error),
          reconciled_at   = COALESCE(${patch.reconciledAt ?? null}, reconciled_at),
          reconciled_open = COALESCE(${patch.reconciledOpen ?? null}, reconciled_open)
        WHERE id = ${id}
      `);
    } catch (e: any) {
      console.error('[cTrader] could not amend execution record:', e?.message ?? e);
    }
  }

  async executeSignal(signal: ExecuteSignalParams): Promise<void> {
    // Every exit below writes a row. A signal skipped because the arming switch is off looks
    // exactly like a signal the executor never saw, unless the skip itself is recorded.
    const base = {
      signalId: signal.signalId, symbol: signal.symbol, side: signal.type, tier: signal.tier,
      confidence: signal.confidence, signalEntry: signal.entry, signalStop: signal.stop,
      signalTp1: signal.targets?.[0], positionSizePercent: signal.positionSizePercent,
      mode: this.isLiveMode ? 'live' : 'demo', host: this.host,
    };

    // Only HIGH tier trades live — MEDIUM is practice only
    if (signal.tier !== 'HIGH') {
      await this.record({ ...base, status: 'skipped_tier', skipReason: `tier=${signal.tier}` });
      return;
    }

    // Arming switch first, so credentials alone can never place an order.
    if (!ctraderEnabled()) {
      console.log('[cTrader] DISABLED (CTRADER_ENABLED is not "true"). No order placed.');
      await this.record({ ...base, status: 'skipped_disabled',
        skipReason: 'CTRADER_ENABLED is not "true"' });
      return;
    }

    if (!(await this.configured())) {
      // Deliberately does NOT tell the operator which variables to set. Setting them used to be
      // the only gate between a signal and a real trade.
      console.log('[cTrader] Enabled but not configured — credentials missing. No order placed.');
      await this.record({ ...base, status: 'skipped_unconfigured',
        skipReason: 'credentials missing' });
      return;
    }

    let recId: string | null = null;

    console.log(`[cTrader] mode=${this.isLiveMode ? 'LIVE (REAL MONEY)' : 'DEMO'} host=${this.host}`);

    let socket: WebSocket | null = null;
    try {
      // Refresh access token if needed
      const accessToken = await this.getAccessToken();

      // Open TLS connection
      const { socket: s, emitter } = await this.openConnection();
      socket = s;

      // Step 1 — Application authentication
      this.send(socket, PT.APP_AUTH_REQ, {
        clientId:     this.clientId!,
        clientSecret: this.clientSecret!,
      });
      await this.waitFor(emitter, PT.APP_AUTH_RES);
      console.log('[cTrader] App authenticated ✅');

      // Step 2 — Get list of live trading accounts
      this.send(socket, PT.GET_ACCOUNTS_REQ, { accessToken });
      const accountsMsg = await this.waitFor(emitter, PT.GET_ACCOUNTS_RES);
      const allAccounts: any[] = accountsMsg.payload?.ctidTraderAccount ?? [];
      // Select the account matching the CURRENT mode. Previously this filtered to isLive===true
      // unconditionally and threw when no live account existed, so a demo-only user could not
      // run the executor at all — and anyone who added a live account was trading real money.
      const wantLive = this.isLiveMode;
      const matching = allAccounts.filter((a: any) => (a.isLive === true) === wantLive);
      if (!matching.length) {
        throw new Error(`No ${wantLive ? 'LIVE' : 'DEMO'} accounts found (mode=${wantLive ? 'live' : 'demo'}). Accounts seen: ${allAccounts.map((a: any) => `${a.ctidTraderAccountId}:${a.isLive ? 'live' : 'demo'}`).join(', ') || 'none'}`);
      }
      const accountId = matching[0].ctidTraderAccountId;
      console.log(`[cTrader] Account ID: ${accountId} ✅`);

      // Step 3 — Authenticate the specific account
      this.send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
      await this.waitFor(emitter, PT.ACCOUNT_AUTH_RES);
      console.log('[cTrader] Account authenticated ✅');

      // Step 4 — Look up symbol IDs (cached after first run)
      if (this.symbolIds.size === 0) {
        console.log('[cTrader] Fetching symbol list...');
        this.send(socket, PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
        const symMsg = await this.waitFor(emitter, PT.SYMBOLS_LIST_RES, 30000);
        const symbols: any[] = symMsg.payload?.symbol ?? [];
        for (const sym of symbols) {
          if (sym.symbolName) this.symbolIds.set(sym.symbolName as string, sym.symbolId as number);
        }
        // Log all FX-related symbols to help debug name format
        const fxSymbols = Array.from(this.symbolIds.keys()).filter(n => n.includes('EUR') || n.includes('CHF') || n.includes('USD'));
        console.log(`[cTrader] ${this.symbolIds.size} symbols loaded. FX symbols: ${fxSymbols.slice(0, 20).join(', ')}`);
      }

      // Step 5 — Resolve symbol ID (try common name formats)
      const nameVariants = [
        signal.symbol.replace('/', ''),          // EURUSD
        signal.symbol,                           // EUR/USD
        signal.symbol.replace('/', '') + 'm',    // EURUSDm
        signal.symbol.replace('/', '') + '.',    // EURUSD.
        signal.symbol.replace('/', '') + '+',    // EURUSD+
      ];
      let symbolId: number | undefined;
      for (const name of nameVariants) {
        symbolId = this.symbolIds.get(name);
        if (symbolId) { console.log(`[cTrader] Matched symbol "${name}" → ID ${symbolId}`); break; }
      }
      if (!symbolId) {
        throw new Error(`Symbol ${signal.symbol} not found. Available: ${Array.from(this.symbolIds.keys()).slice(0, 30).join(', ')}`);
      }

      // Step 6 — Calculate position size (1% risk)
      const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
      const slPips    = Math.abs(signal.entry - signal.stop) * pipFactor;
      let volume      = this.calcVolume(signal.symbol, slPips, signal.positionSizePercent ?? 1.0);
      if (volume <= 0) {
        console.log(`[cTrader] positionSizePercent=${signal.positionSizePercent} -> zero volume. No order placed.`);
        await this.record({ ...base, status: 'skipped_zero_volume', accountId,
          accountIsLive: matching[0].isLive === true, brokerSymbolId: symbolId,
          skipReason: `positionSizePercent=${signal.positionSizePercent}` });
        return;
      }

      // Clamp to the symbol's ACTUAL limits rather than assuming ours are valid. A volume below
      // minVolume, or off the stepVolume grid, is rejected by the broker — and a rejection here
      // is silent from the strategy's point of view, so it must be caught before sending.
      try {
        this.send(socket, PT.SYMBOL_BY_ID_REQ, { ctidTraderAccountId: accountId, symbolId: [symbolId] });
        const detail = ((await this.waitFor(emitter, PT.SYMBOL_BY_ID_RES, 15000)).payload?.symbol ?? [])[0];
        const min  = detail?.minVolume, max = detail?.maxVolume, step = detail?.stepVolume;
        if (step && step > 0) volume = Math.round(volume / step) * step;
        if (min  && volume < min) {
          console.log(`[cTrader] computed volume ${volume} is below the broker minimum ${min}. Raising to the minimum.`);
          volume = min;
        }
        if (max  && volume > max) volume = max;
      } catch (e: any) {
        console.warn(`[cTrader] could not read symbol limits (${e.message}); sending unclamped volume ${volume}.`);
      }

      const lots      = volume / LOTS_TO_VOLUME;

      // Step 7 — Place market order with SL + TP1
      this.send(socket, PT.NEW_ORDER_REQ, {
        ctidTraderAccountId: accountId,
        symbolId,
        orderType: 1,                                    // MARKET
        tradeSide: signal.type === 'LONG' ? 1 : 2,      // BUY=1, SELL=2
        volume,
        stopLoss:   signal.stop,
        takeProfit: signal.targets[0],                   // TP1 at 2:1 R:R
      });

      // Recorded BEFORE the reply, so an order that is sent and then times out still leaves
      // evidence that it went to the broker. A missing row means the order was never sent; a
      // 'sent' row that never advances means we do not know what happened to it, which is a
      // materially different and much worse situation.
      recId = await this.record({
        ...base, status: 'sent', accountId, accountIsLive: matching[0].isLive === true,
        brokerSymbolId: symbolId, requestedVolume: volume, lots,
      });

      // Wait for execution confirmation
      const exec = await this.waitFor(emitter, PT.EXECUTION_EVENT, 15000);

      // executionType 2 = ORDER_ACCEPTED, 3 = ORDER_FILLED.
      //
      // This used to log "✅ EXECUTED" on ANY execution event. Acceptance is not a fill — the
      // project established that on 2026-08-31 when the first order was placed, and the smoke
      // test was corrected while this path was not. A rejected or unfilled order reported
      // success, and nothing was written down to contradict it later.
      const execType = exec.payload?.executionType;
      const pos      = exec.payload?.position;
      const positionId = pos?.positionId ?? exec.payload?.order?.positionId ?? null;
      const fillPrice  = pos?.price ?? exec.payload?.deal?.executionPrice ?? null;
      const filled     = execType === 3;

      await this.amend(recId, {
        status: filled ? 'filled' : 'accepted',
        executionType: execType ?? null,
        orderId: exec.payload?.order?.orderId ?? null,
        positionId, fillPrice,
      });

      // Reconcile settles it. The broker's own position list is the only thing that proves a
      // position exists — this is what confirmed the first order on 2026-08-31, and it is cheap
      // here because the socket is already authenticated.
      let reconciledOpen: boolean | null = null;
      try {
        this.send(socket, PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
        const rec = await this.waitFor(emitter, PT.RECONCILE_RES, 20000);
        const open: any[] = rec.payload?.position ?? [];
        reconciledOpen = positionId
          ? open.some((x: any) => x.positionId === positionId)
          : open.length > 0;
        await this.amend(recId, {
          status: reconciledOpen ? 'filled' : undefined,
          reconciledAt: new Date().toISOString(), reconciledOpen,
        });
      } catch (e: any) {
        console.warn(`[cTrader] could not reconcile after order: ${e.message}`);
      }

      console.log(
        `[cTrader] ${reconciledOpen ? '✅ OPEN AT BROKER' : filled ? '✅ FILLED' : '📨 ACCEPTED (not confirmed filled)'}: `
        + `${signal.type} ${signal.symbol} | ${lots} lots | executionType=${execType} `
        + `| positionId=${positionId ?? 'none'} | SL: ${signal.stop.toFixed(5)} | TP: ${signal.targets[0].toFixed(5)}`
      );

      // Tell the operator on their PHONE that a trade actually went on.
      //
      // Signal alerts already go to Telegram, but a signal is not a trade: it fires whether or not
      // the executor was armed, configured, or allowed. Until now the only evidence an ORDER had
      // been placed was a Render log line and a database row, neither of which reaches anyone who
      // is not at a computer.
      //
      // Says DEMO explicitly and always. The day this runs against a funded account, an alert
      // that merely said "EXECUTED" would read identically, and that ambiguity is not acceptable
      // on a message about real money.
      try {
        const state = reconciledOpen ? 'OPEN AT BROKER ✅'
          : filled ? 'FILLED ✅'
          : 'ACCEPTED (not confirmed filled) 📨';
        await telegramNotifier.sendText(
          `🤖 <b>AUTO-EXECUTED — ${this.isLiveMode ? '⚠️ LIVE' : 'DEMO'}</b>
`
          + `${state}

`
          + `<b>${signal.symbol} ${signal.type}</b>
`
          + `Size: ${lots} lots
`
          + `Entry: ${fillPrice ? Number(fillPrice).toFixed(5) : 'pending fill'}
`
          + `Stop: ${signal.stop.toFixed(5)}
`
          + `Target: ${signal.targets[0].toFixed(5)}
`
          + `Confidence: ${signal.confidence} (${signal.tier})
`
          + `Position: <code>${positionId ?? 'none'}</code>`,
          'paid', 'HTML'   // these use <b>/<code>; MarkdownV2 would 400 on the periods alone
        );
      } catch (e: any) {
        // A notification failure must never affect a trade that has already been placed.
        console.warn(`[cTrader] execution alert not sent: ${e?.message ?? e}`);
      }

    } catch (err: any) {
      // Never crash signal generation — log and continue
      console.error('[cTrader] ❌ Execution failed:', err.message);
      if (recId) await this.amend(recId, { status: 'error', error: err.message });
      else await this.record({ ...base, status: 'error', error: err.message });
    } finally {
      socket?.close();
    }
  }
  /**
   * Seed or replace the persisted refresh token. Called by the OAuth callback.
   *
   * Lets a freshly-minted token go straight into storage, so the operator never has to copy a
   * credential by hand into Render. CTRADER_REFRESH_TOKEN then matters only as a cold-start
   * fallback if the row is ever missing.
   */
  async seedRefreshToken(token: string): Promise<void> {
    await this.saveRefreshToken(token);
    this.accessToken = null;   // force the next call to use the new token
    this.tokenExpiry = 0;
  }

  /**
   * Read the broker's own deal history. READ-ONLY — places, amends and closes nothing.
   *
   * This is ground truth. `reconcile` reports only what is OPEN right now, so a position that has
   * already closed is invisible to it — which is precisely the position whose outcome we need.
   * ProtoOADealListRes returns every execution in a window, and a deal carrying
   * `closePositionDetail` is a CLOSING deal reporting realised profit, swap and commission.
   *
   * PAGINATION IS NOT OPTIONAL. The response carries `hasMore`, meaning the server truncated the
   * result to its own chunk size. Ignoring it would silently drop deals and produce a record that
   * looks complete and is not — the same shape of defect as the truncated resolution paths. The
   * loop advances past the newest deal seen and refuses to spin forever.
   *
   * Timestamps are Unix ms. The docs bound them (>= 0, <= 2147483646000) but state no maximum
   * window for deals; callers chunk anyway, because the tick endpoints DO cap at one week and
   * matching that is cheaper than discovering the limit in production.
   */
  async listDeals(fromMs: number, toMs: number, maxRows = 1000): Promise<any[]> {
    if (!(await this.configured())) throw new Error('cTrader credentials are not configured.');
    if (this.isLiveMode) throw new Error('REFUSED: live mode is active. This only ever reads demo.');

    const accessToken = await this.getAccessToken();
    const { socket, emitter } = await this.openConnection(DEMO_HOST);
    try {
      this.send(socket, PT.APP_AUTH_REQ, { clientId: this.clientId!, clientSecret: this.clientSecret! });
      await this.waitFor(emitter, PT.APP_AUTH_RES);

      this.send(socket, PT.GET_ACCOUNTS_REQ, { accessToken });
      const accts: any[] = (await this.waitFor(emitter, PT.GET_ACCOUNTS_RES)).payload?.ctidTraderAccount ?? [];
      const demo = accts.filter((a: any) => a.isLive !== true);
      if (!demo.length) throw new Error('REFUSED: no demo account on this token.');
      const accountId = demo[0].ctidTraderAccountId;

      this.send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
      await this.waitFor(emitter, PT.ACCOUNT_AUTH_RES);

      const all: any[] = [];
      const seen = new Set<number>();
      let cursor = fromMs;

      // Hard page cap. A server that keeps answering hasMore=true without advancing would
      // otherwise loop until the process dies.
      for (let page = 0; page < 20; page++) {
        this.send(socket, PT.DEAL_LIST_REQ, {
          ctidTraderAccountId: accountId, fromTimestamp: cursor, toTimestamp: toMs, maxRows,
        });
        const res = await this.waitFor(emitter, PT.DEAL_LIST_RES, 30000);
        const deals: any[] = res.payload?.deal ?? [];

        let added = 0;
        for (const d of deals) {
          if (d?.dealId === undefined || seen.has(d.dealId)) continue;
          seen.add(d.dealId);
          all.push(d);
          added++;
        }

        if (!res.payload?.hasMore || deals.length === 0) break;

        // Advance past the newest deal in this page. +1ms so the boundary deal is not re-fetched
        // forever; de-duplication by dealId covers the case where several share a timestamp.
        const newest = Math.max(...deals.map((d: any) => Number(d.executionTimestamp ?? d.createTimestamp ?? 0)));
        const next = newest + 1;
        if (!Number.isFinite(next) || next <= cursor || added === 0) break;   // no forward progress
        cursor = next;
      }

      console.log(`[cTrader] deal history: ${all.length} deal(s) between ${new Date(fromMs).toISOString()} and ${new Date(toMs).toISOString()}`);
      return all;
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  /**
   * List open positions on the DEMO account, and optionally CLOSE them. Never touches live.
   *
   * The executor could open a position but had no way to close one, which is half a trading
   * system. The smoke test deliberately left position 285950003 open because closing it meant
   * guessing a payload type — this implements it properly instead.
   *
   * Reconciles FIRST and closes using the volume the broker reports, rather than the volume we
   * think we sent. A close request carrying the wrong volume is a partial close, which would
   * silently leave exposure behind while reporting success.
   */
  async demoPositions(opts: { close?: boolean; confirm?: string; positionId?: number } = {}): Promise<any> {
    if (!(await this.configured())) throw new Error('cTrader credentials are not configured.');
    if (this.isLiveMode) throw new Error('REFUSED: live mode is active. This only ever operates on demo.');
    if (opts.close && opts.confirm !== 'CLOSE_DEMO_POSITIONS') {
      throw new Error('Refused: closing requires the confirmation string.');
    }

    const accessToken = await this.getAccessToken();
    const { socket, emitter } = await this.openConnection(DEMO_HOST);
    try {
      this.send(socket, PT.APP_AUTH_REQ, { clientId: this.clientId!, clientSecret: this.clientSecret! });
      await this.waitFor(emitter, PT.APP_AUTH_RES);

      this.send(socket, PT.GET_ACCOUNTS_REQ, { accessToken });
      const accts: any[] = (await this.waitFor(emitter, PT.GET_ACCOUNTS_RES)).payload?.ctidTraderAccount ?? [];
      const demo = accts.filter((a: any) => a.isLive !== true);
      if (!demo.length) throw new Error('REFUSED: no demo account on this token.');
      const accountId = demo[0].ctidTraderAccountId;

      this.send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
      await this.waitFor(emitter, PT.ACCOUNT_AUTH_RES);

      this.send(socket, PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
      const rec = await this.waitFor(emitter, PT.RECONCILE_RES, 20000);
      const positions: any[] = rec.payload?.position ?? [];
      const open = positions.map((p: any) => ({
        positionId: p.positionId,
        symbolId:   p.tradeData?.symbolId,
        side:       p.tradeData?.tradeSide === 1 ? 'BUY' : 'SELL',
        volume:     p.tradeData?.volume,
        price:      p.price,
        status:     p.positionStatus,
      }));

      if (!opts.close) return { accountId, accountIsLive: false, openPositions: open };

      const targets = opts.positionId ? open.filter(p => p.positionId === opts.positionId) : open;
      const closed: any[] = [];
      for (const p of targets) {
        if (!p.volume || p.volume <= 0) { closed.push({ ...p, result: 'skipped — broker reports zero volume' }); continue; }
        this.send(socket, PT.CLOSE_POSITION_REQ, {
          ctidTraderAccountId: accountId, positionId: p.positionId, volume: p.volume,
        });
        try {
          const ev = await this.waitFor(emitter, PT.EXECUTION_EVENT, 20000);
          closed.push({ ...p, result: 'closed', executionType: ev.payload?.executionType });
        } catch (e: any) {
          closed.push({ ...p, result: `FAILED: ${e.message}` });
        }
      }
      return { accountId, accountIsLive: false, requested: targets.length, closed };
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  /**
   * SMOKE TEST — places ONE real order on the DEMO account, then reports what the broker said.
   *
   * Why this has to exist: NEW_ORDER_REQ -> EXECUTION_EVENT has never once completed in this
   * system's history. The executor spent its whole life speaking raw framed TCP to a port that
   * only answers WebSocket, so every order it "placed" was silently discarded. Account
   * enumeration now works, but that only proves the read path. Order placement is still
   * unevidenced, and waiting for a natural HIGH-tier signal to find out could take days.
   *
   * FOUR INDEPENDENT REFUSALS, because this is the one method that can move money:
   *   1. the caller must pass the exact confirmation string
   *   2. refuses outright if live mode resolves true
   *   3. selects only isLive === false, and re-checks the chosen account afterwards
   *   4. refuses if the account the broker hands back does not match the one selected
   *
   * Deliberately sends NO stopLoss/takeProfit. Those field names are as untested as everything
   * else on this path, and a rejection caused by an untested field would obscure the single
   * question being asked. It also asks the broker for the symbol's real minVolume rather than
   * trusting calcVolume's `volume = lots x 100`, which has never been checked against a broker
   * and is the kind of assumption that has already cost this project a day.
   *
   * Leaves a position OPEN. Closing it would mean guessing ProtoOAClosePositionReq's payload
   * type, and guessing protocol numbers on a trading path is precisely the error class that
   * caused this entire episode. Close it in cTrader.
   */
  async smokeTestDemoOrder(confirm: string, symbol = 'EUR/USD'): Promise<any> {
    if (confirm !== 'PLACE_DEMO_ORDER') {
      throw new Error('Refused: confirmation string absent. This places a REAL order.');
    }
    if (!(await this.configured())) throw new Error('Refused: cTrader credentials are not configured.');
    if (this.isLiveMode) {
      throw new Error('REFUSED: live mode is active (CTRADER_MODE=live and CTRADER_ALLOW_LIVE=true). This test only ever runs on demo.');
    }

    const accessToken = await this.getAccessToken();
    const { socket, emitter } = await this.openConnection(DEMO_HOST);
    const transcript: any[] = [];
    const record = (m: any) => transcript.push({ type: m.payloadType, payload: CTraderExecutor.redact(m.payload) });

    // Declared out here so the catch below can amend the row the try block created.
    let recId: string | null = null;

    try {
      this.send(socket, PT.APP_AUTH_REQ, { clientId: this.clientId!, clientSecret: this.clientSecret! });
      record(await this.waitFor(emitter, PT.APP_AUTH_RES));

      this.send(socket, PT.GET_ACCOUNTS_REQ, { accessToken });
      const accountsMsg = await this.waitFor(emitter, PT.GET_ACCOUNTS_RES);
      const all: any[] = accountsMsg.payload?.ctidTraderAccount ?? [];
      const demoOnly = all.filter((a: any) => a.isLive !== true);
      if (!demoOnly.length) {
        throw new Error(`REFUSED: no DEMO account on this token. Accounts seen: ${all.map((a: any) => `${a.ctidTraderAccountId}:${a.isLive ? 'live' : 'demo'}`).join(', ')}`);
      }
      const account = demoOnly[0];
      if (account.isLive === true) throw new Error('REFUSED: selected account is LIVE.');
      const accountId = account.ctidTraderAccountId;

      this.send(socket, PT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: accountId, accessToken });
      const authRes = await this.waitFor(emitter, PT.ACCOUNT_AUTH_RES);
      record(authRes);
      if (authRes.payload?.ctidTraderAccountId && authRes.payload.ctidTraderAccountId !== accountId) {
        throw new Error(`REFUSED: broker authenticated a DIFFERENT account (${authRes.payload.ctidTraderAccountId}) than selected (${accountId}).`);
      }

      this.send(socket, PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
      const symMsg = await this.waitFor(emitter, PT.SYMBOLS_LIST_RES, 30000);
      const symbols: any[] = symMsg.payload?.symbol ?? [];
      const wanted = [symbol.replace('/', ''), symbol, symbol.replace('/', '') + 'm', symbol.replace('/', '') + '.', symbol.replace('/', '') + '+'];
      const light = symbols.find((x: any) => wanted.includes(x.symbolName));
      if (!light) throw new Error(`Symbol ${symbol} not found. First 30: ${symbols.slice(0, 30).map((x: any) => x.symbolName).join(', ')}`);
      const symbolId = light.symbolId;

      // Ask for FULL symbol metadata — the light list does not carry volume limits.
      let minVolume: number | undefined, stepVolume: number | undefined, volumeSource = 'broker minVolume';
      try {
        this.send(socket, PT.SYMBOL_BY_ID_REQ, { ctidTraderAccountId: accountId, symbolId: [symbolId] });
        const full = await this.waitFor(emitter, PT.SYMBOL_BY_ID_RES, 15000);
        const detail = (full.payload?.symbol ?? [])[0];
        minVolume  = detail?.minVolume;
        stepVolume = detail?.stepVolume;
      } catch (e: any) {
        volumeSource = `symbol detail unavailable (${e.message}); fell back to calcVolume's assumption`;
      }
      const volume = minVolume ?? 100;
      if (minVolume === undefined) volumeSource += ' — volume=100 is UNVERIFIED';

      // SL and TP, exactly as a real trade carries them.
      //
      // The test used to send a bare market order. That left two things unproven: whether the
      // broker ACCEPTS the order shape a real signal sends (absolute stopLoss and takeProfit on a
      // market order — if that shape were rejected, the smoke test would have passed while every
      // real signal failed), and it left the position needing manual cleanup.
      //
      // Geometry matches production: the R:R is the real 2:1 (SL_MULTIPLIER 1.5 / TP1_MULTIPLIER
      // 3.0), and the stop distance is the real MIN_SL_PIPS floor for the symbol. The ONE
      // difference from a live signal is that the distance is that floor rather than 1.5xATR,
      // because a smoke test has no market analysis behind it to derive an ATR from. The order
      // SHAPE — which is what this test exists to prove — is identical.
      const pipFactor = symbol.includes('JPY') ? 100 : 10000;
      const MIN_SL_PIPS: Record<string, number> = { 'EUR/USD': 8, 'USD/CHF': 8, 'GBP/USD': 10, 'USD/JPY': 6 };
      const slPips = MIN_SL_PIPS[symbol] ?? 8;

      let refPrice: number | undefined;
      try {
        const quotes = await exchangeRateAPI.fetchAllQuotes();
        refPrice = quotes.find(q => q.symbol === symbol)?.exchangeRate;
      } catch (e: any) {
        console.warn(`[cTrader] smoke test could not fetch a reference price: ${e.message}`);
      }

      // Absolute levels, rounded to the pair's price precision. BUY: stop below, target above.
      const digits = symbol.includes('JPY') ? 3 : 5;
      const stopLoss   = refPrice ? +(refPrice - slPips / pipFactor).toFixed(digits) : undefined;
      const takeProfit = refPrice ? +(refPrice + (slPips * 2) / pipFactor).toFixed(digits) : undefined;

      // Recorded the same way an automatic execution is, so the operator's own test order is
      // durable evidence rather than a JSON blob in a browser tab that closes. Written BEFORE the
      // reply, so an order that goes out and then times out still leaves a trace it was sent —
      // and it now carries the SL/TP levels actually sent, so the row states the whole request.
      recId = await this.record({
        symbol: light.symbolName, side: 'LONG', tier: 'SMOKE_TEST', status: 'sent',
        skipReason: `operator smoke test — broker minimum volume, ${stopLoss ? '2:1 SL/TP as production' : 'NO SL/TP (no reference price)'}`,
        mode: 'demo', host: DEMO_HOST, accountId, accountIsLive: account.isLive === true,
        brokerSymbolId: symbolId, requestedVolume: volume, lots: volume / LOTS_TO_VOLUME,
        signalEntry: refPrice ?? null, signalStop: stopLoss ?? null, signalTp1: takeProfit ?? null,
      });

      this.send(socket, PT.NEW_ORDER_REQ, {
        ctidTraderAccountId: accountId,
        symbolId,
        orderType: 1,   // MARKET
        tradeSide: 1,   // BUY
        volume,
        // Omitted entirely if no reference price was available — sending undefined levels would
        // be worse than sending none, and a bare order is still a valid connectivity test.
        ...(stopLoss   !== undefined ? { stopLoss }   : {}),
        ...(takeProfit !== undefined ? { takeProfit } : {}),
      });
      const exec = await this.waitFor(emitter, PT.EXECUTION_EVENT, 20000);
      record(exec);

      const pos = exec.payload?.position;
      const positionId = pos?.positionId ?? exec.payload?.order?.positionId ?? null;

      // executionType 2 = ACCEPTED, 3 = FILLED. Stored distinctly for the same reason the
      // automatic path does it: acceptance is not evidence of a fill.
      await this.amend(recId, {
        status: exec.payload?.executionType === 3 ? 'filled' : 'accepted',
        executionType: exec.payload?.executionType ?? null,
        orderId: exec.payload?.order?.orderId ?? null,
        positionId,
        fillPrice: pos?.price ?? exec.payload?.deal?.executionPrice ?? null,
      });

      // Reconcile before returning. The acceptance event is NOT a fill and does not carry one:
      // measured on 2026-09-01 position 286152195 came back from EXECUTION_EVENT with
      // volume 0 and price 0, while the broker's own position list showed volume 100000 at
      // 1.15915. Reporting the acceptance figures would have recorded a fill at price ZERO.
      //
      // executeSignal already did this; the smoke test did not, so the operator's own test left a
      // row stuck at 'accepted @ 0' that never advanced. Same evidence standard for both paths.
      let reconciledOpen: boolean | null = null;
      let confirmedVolume: number | null = null;
      let confirmedPrice: number | null = null;
      try {
        this.send(socket, PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
        const rec = await this.waitFor(emitter, PT.RECONCILE_RES, 20000);
        record(rec);
        const open: any[] = rec.payload?.position ?? [];
        const mine = open.find((x: any) => x.positionId === positionId);
        reconciledOpen  = !!mine;
        confirmedVolume = mine?.tradeData?.volume ?? null;
        confirmedPrice  = mine?.price ?? null;
        await this.amend(recId, {
          status: reconciledOpen ? 'filled' : undefined,
          fillPrice: confirmedPrice,
          reconciledAt: new Date().toISOString(),
          reconciledOpen,
        });
      } catch (e: any) {
        console.warn(`[cTrader] smoke test could not reconcile: ${e.message}`);
      }

      return {
        placed: true,
        referencePrice: refPrice ?? null,
        stopLoss: stopLoss ?? null,
        takeProfit: takeProfit ?? null,
        riskRewardSent: stopLoss && takeProfit ? '2:1 (production geometry)' : 'NONE — no reference price',
        brokerConfirmedOpen: reconciledOpen,
        confirmedVolume,
        confirmedPrice,
        host: DEMO_HOST,
        accountId,
        accountIsLive: account.isLive === true,
        symbol: light.symbolName,
        symbolId,
        volume,
        volumeSource,
        minVolume, stepVolume,
        executionType: exec.payload?.executionType,
        positionId,
        entryPrice: pos?.price ?? exec.payload?.deal?.executionPrice,
        transcript,
      };
    } catch (err: any) {
      // RETURN the failure instead of throwing it, so the transcript survives.
      //
      // Previously any failure propagated to the route, which replied with `{placed:false,
      // error}` and nothing else — so the single most useful diagnostic, the actual sequence of
      // messages exchanged with the broker, was collected and then discarded at the moment it
      // was needed. A bare "Timeout waiting for payloadType 2126" tells you nothing about which
      // step failed or what the broker last said.
      const msg = err?.message ?? String(err);
      await this.amend(recId, {
        status: /ORDER REJECTED/.test(msg) ? 'rejected' : 'error',
        error: msg,
      });
      return { placed: false, error: msg, host: DEMO_HOST, transcript };
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }
}

export const ctraderExecutor = new CTraderExecutor();

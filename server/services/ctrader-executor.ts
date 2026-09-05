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
import { getDailyLossStatus } from './broker-deals';
import { propFirmService } from './prop-firm-config';
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
  /**
   * Amend SL/TP on an OPEN position. Its reply arrives as an EXECUTION_EVENT (2126), NOT a
   * dedicated *_RES — verified against help.ctrader.com/open-api/messages, 2026-09-04.
   */
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  RECONCILE_REQ:     2124,
  RECONCILE_RES:     2125,
  /** Deal history. Verified against help.ctrader.com/open-api/model-messages on 2026-09-02. */
  DEAL_LIST_REQ:     2133,
  DEAL_LIST_RES:     2134,
  /** Historical candles. Verified against the same page, 2026-09-02. */
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
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

/**
 * Build the execution alert text.
 *
 * EXPORTED so the admin format-test sends byte-identical text to what a real trade sends. A test
 * that reproduces the template instead of calling it proves only that the copy works, and the copy
 * drifts. Pure function: no I/O, no side effects.
 */
export function buildExecutionAlertMessage(a: {
  live: boolean; state: string; symbol: string; type: string; lots: number;
  fillPrice: number | null; stop: number; target: number;
  confidence: number; tier: string; positionId: number | null;
}): string {
  return `🤖 <b>AUTO-EXECUTED — ${a.live ? '⚠️ LIVE' : 'DEMO'}</b>
`
    + `${a.state}

`
    + `<b>${a.symbol} ${a.type}</b>
`
    + `Size: ${a.lots} lots
`
    + `Entry: ${a.fillPrice ? Number(a.fillPrice).toFixed(5) : 'pending fill'}
`
    + `Stop: ${a.stop.toFixed(5)}
`
    + `Target: ${a.target.toFixed(5)}
`
    + `Confidence: ${a.confidence} (${a.tier})
`
    + `Position: <code>${a.positionId ?? 'none'}</code>`;
}

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

export class CTraderExecutor {
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
   * The balance to size and guard against.
   *
   * CTRADER_ACCOUNT_BALANCE is a STATIC env constant, so every trade after the first was sized
   * against a number that no longer matched the account: on 2026-09-03 the env said 10000 while
   * the broker said 10085.34. The drift is silent, it compounds, and it moves the REAL risk
   * percentage away from the intended one in whichever direction the account has moved.
   *
   * The broker's own last closing balance is the truth. The env value survives only as a
   * cold-start fallback for an account that has never closed a trade.
   */
  private async liveBalance(): Promise<number> {
    try {
      const rows = (await db.execute(sql`
        SELECT balance_after FROM ctrader_deals
        WHERE is_close IS TRUE AND balance_after IS NOT NULL
        ORDER BY executed_at DESC LIMIT 1
      `)) as any[];
      const b = rows[0]?.balance_after;
      const n = b === null || b === undefined ? NaN : Number(b);
      return Number.isFinite(n) && n > 0 ? n : this.accountBalance;
    } catch {
      return this.accountBalance;   // never let a read failure block a trade
    }
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

  /**
   * Wait for a broker message.
   *
   * `match` EXISTS BECAUSE PAYLOAD TYPE ALONE IS NOT AN IDENTITY. Several execution events cross
   * this socket for a single order — ACCEPTED, then FILLED — and more still if anything else on
   * the account moves. Matching on type alone returns whichever arrived first, so "wait for the
   * amend's reply" was satisfied by the original order's own late ORDER_FILLED. That made the
   * amend's success flag meaningless on the one operation that protects the position.
   *
   * When `match` is supplied the listener is attached with `.on` rather than `.once`, so a
   * message that is not ours is IGNORED rather than consuming the wait.
   */
  private waitFor(
    emitter: EventEmitter, payloadType: number, timeoutMs = 25000,
    match?: (m: any) => boolean,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const onMsg = (m: any) => {
        if (match) {
          let ours = false;
          try { ours = !!match(m); } catch { ours = false; }   // a bad predicate must not wedge the wait
          if (!ours) return;
        }
        cleanup(); resolve(m);
      };
      const onErr = (e: Error) => { cleanup(); reject(e); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for payloadType ${payloadType}${match ? ' (filtered)' : ''}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        emitter.off(`type:${payloadType}`, onMsg);
        emitter.off('protoError', onErr);
      };
      emitter.on(`type:${payloadType}`, onMsg);
      emitter.once('protoError', onErr);
    });
  }


  /**
   * Ask the broker for ONE position, retrying briefly before giving up.
   *
   * A single reconcile races the broker. On 2026-09-04 the AUD/USD order was sent at 07:24:47.263
   * and the broker's own deal is stamped 07:24:47.595 — reconcile asked for the position list in
   * that 332 ms window, found nothing, and recorded `fill_price = 0` with `reconciled_open = false`
   * on a position that was genuinely open. Everything downstream then went blind: no fill price,
   * no re-anchor, no entry slippage — and it goes blind precisely when the broker is busy, which
   * is exactly when fills are worst. Three attempts 400 ms apart covers the observed race an order
   * of magnitude over.
   *
   * Ids are compared NUMERICALLY. A string/number mismatch would silently never match, and that
   * failure looks identical to "the position does not exist".
   */
  private async fetchPosition(
    socket: WebSocket, emitter: EventEmitter, accountId: number,
    positionId: number | null, attempts = 3, delayMs = 400,
  ): Promise<{ mine: any; open: any[]; attemptsUsed: number }> {
    let open: any[] = [];
    for (let i = 1; i <= attempts; i++) {
      this.send(socket, PT.RECONCILE_REQ, { ctidTraderAccountId: accountId });
      // 8s, not 20s. Reconcile answers in well under a second; a 20s ceiling x 3 attempts made
      // the worst case 60s on a call whose whole purpose is to be quick.
      const rec = await this.waitFor(emitter, PT.RECONCILE_RES, 8000);
      open = rec.payload?.position ?? [];
      const mine = positionId
        ? open.find((x: any) => Number(x.positionId) === Number(positionId))
        : undefined;
      if (mine || !positionId) return { mine, open, attemptsUsed: i };
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
    return { mine: undefined, open, attemptsUsed: attempts };
  }

  // ─── Position sizing ──────────────────────────────────────────────────────

  /**
   * Pip value per standard lot, in the account currency (USD).
   *
   * This was hardcoded as `symbol.includes('JPY') ? 9 : 10`, which is only correct when USD is the
   * QUOTE currency. Measured against a real closed trade on 2026-09-02 (position 286259147):
   * gross -137.15 on 0.78 lots over 14.3 pips gives 137.15 / (0.78 * 14.3) = **$12.30**, not $10.
   * USD/CHF positions were therefore ~23% too large — an intended 1% risk was really ~1.24%.
   *
   *   USD is the QUOTE currency (EUR/USD, GBP/USD, AUD/USD): pip value is fixed at
   *     pipSize * 100000 = $10. The rate does not enter into it.
   *   USD is the BASE currency (USD/CHF, USD/JPY): the pip is denominated in the quote currency,
   *     so it must be converted back: pipSize * 100000 / price.
   *       USD/CHF @ 0.8133 -> 0.0001 * 100000 / 0.8133 = $12.30  (matches the measured deal)
   *       USD/JPY @ 160    -> 0.01   * 100000 / 160    = $6.25   (the old constant 9 oversized
   *                                                               the stop, UNDER-sizing by ~30%)
   *
   * `price` is the signal's entry, which is the live rate at signal time — accurate to well
   * within the precision this needs, and it avoids an extra API call on the execution path.
   */
  private pipValuePerLot(symbol: string, price: number): number {
    const pipSize = symbol.includes('JPY') ? 0.01 : 0.0001;
    const perLotInQuote = pipSize * 100_000;
    // Base-currency USD means the P&L lands in the quote currency and must be converted.
    if (/^USD[\/]/.test(symbol)) {
      return Number.isFinite(price) && price > 0 ? perLotInQuote / price : perLotInQuote;
    }
    return perLotInQuote;   // USD is the quote currency: already in USD
  }

  private calcVolume(symbol: string, slPips: number, positionSizePercent = 1.0, price = 0, balance?: number): number {
    // Honour the signal's own sizing. This was hardcoded to 1%, so if the HIGH-tier guard were
    // ever relaxed a MEDIUM signal (positionSizePercent = 0, practice only) would have been
    // sized as a full live trade.
    const pct = Number.isFinite(positionSizePercent) ? Math.max(0, positionSizePercent) : 1.0;
    if (pct <= 0) return 0;
    const riskUsd        = (Number.isFinite(balance as number) && (balance as number) > 0 ? (balance as number) : this.accountBalance) * (pct / 100);
    const pipValuePerLot = this.pipValuePerLot(symbol, price);
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
          reconciled_open = COALESCE(${patch.reconciledOpen ?? null}, reconciled_open),
          alert_sent      = COALESCE(${patch.alertSent ?? null}, alert_sent),
          alert_error     = COALESCE(${patch.alertError ?? null}, alert_error)
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

    // DAILY LOSS GUARD.
    //
    // `canTrade()` implemented exactly this check and was called in three places, ALL of them GET
    // display endpoints (/api/prop-firm/can-trade, /api/prop-firm/dashboard). It appeared nowhere
    // on the path that actually places orders — so `enableDailyLossProtection: true` and
    // `dailyLossBuffer: 4.0` were configured, enabled, and never enforced.
    //
    // What was really protecting the account is maxTradesReached() — the 3/day COUNT cap, which
    // bounds loss to ~3% at 1% risk only as a side effect. That is protection by accident: when
    // sizing was 24% too large (found 2026-09-02) the real bound was 3.7% and nothing noticed, and
    // raising maxTradesPerDay would have removed the bound silently.
    //
    // Balance-based, matching The5ers: only CLOSED trades count — floating losses do not breach a
    // balance-based limit. Measured against the day's OPENING balance, broker day starting
    // 17:00 New York.
    //
    // FAILS CLOSED. If the loss cannot be computed we do not trade: a drawdown guard that lets
    // orders through when it cannot verify the limit is not a guard. The refusal is recorded, so a
    // database problem surfaces as refused trades in the data rather than as silence.
    {
      const cfg = propFirmService.getConfig();
      if (cfg.enableDailyLossProtection) {
        const st = await getDailyLossStatus(await this.liveBalance());
        if (st.lossPercent === null) {
          console.error(`[cTrader] REFUSING: daily loss undeterminable — ${st.reason}`);
          await this.record({ ...base, status: 'skipped_daily_loss',
            skipReason: `daily loss undeterminable (fail-closed): ${st.reason}` });
          return;
        }
        if (st.lossPercent >= cfg.dailyLossBuffer) {
          console.warn(`[cTrader] REFUSING: daily loss ${st.lossPercent.toFixed(2)}% >= buffer ${cfg.dailyLossBuffer}%`);
          await this.record({ ...base, status: 'skipped_daily_loss',
            skipReason: `daily realised loss ${st.lossPercent.toFixed(2)}% >= buffer ${cfg.dailyLossBuffer}% `
                      + `(realised ${st.realisedToday?.toFixed(2)} on anchor ${st.anchorBalance?.toFixed(2)} since ${st.dayStart})` });
          return;
        }
        console.log(`[cTrader] daily loss check: ${st.lossPercent.toFixed(2)}% of ${st.anchorBalance?.toFixed(2)} (buffer ${cfg.dailyLossBuffer}%) — OK`);
      }
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
      const balanceNow = await this.liveBalance();
      let volume      = this.calcVolume(signal.symbol, slPips, signal.positionSizePercent ?? 1.0, signal.entry, balanceNow);
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

        // THE BROKER'S OWN MINIMUM SL/TP DISTANCES, recorded but NOT yet enforced.
        //
        // ProtoOASymbol carries slDistance and tpDistance ("minimum allowed distance between
        // stop loss / take profit and current market price") plus distanceSetIn, which says
        // whether those are points or a percentage. We have been fetching this object all along
        // for minVolume/stepVolume and reading none of it.
        //
        // It matters for the re-anchor specifically: pinning the stop to exactly slDist from the
        // FILL moves it CLOSER to market than the quoted-entry stop whenever the fill was
        // adverse, so an amend can be rejected (TRADING_BAD_STOPS) where the original order was
        // accepted. Enforcing it needs distanceSetIn's units settled against this broker first,
        // and guessing that would trade a rare rejection for a systematically wrong stop.
        // Logging it costs nothing and turns the next fill into the measurement.
        if (detail?.slDistance !== undefined || detail?.tpDistance !== undefined) {
          console.log(
            `[cTrader] broker min distances for ${signal.symbol}: sl=${detail?.slDistance} `
            + `tp=${detail?.tpDistance} setIn=${detail?.distanceSetIn} `
            + `| our stop is ${(Math.abs(signal.entry - signal.stop) * pipFactor).toFixed(1)} pips`
          );
        }
      } catch (e: any) {
        console.warn(`[cTrader] could not read symbol limits (${e.message}); sending unclamped volume ${volume}.`);
      }

      const lots      = volume / LOTS_TO_VOLUME;

      // OUR OWN NAME FOR THIS ORDER.
      //
      // Without it we cannot tell our execution events from anything else on the account, and
      // "wait for an execution event" is the closest we can get to "wait for OUR order". That is
      // how the amend came to report success on the original order's late ORDER_FILLED. cTrader
      // echoes clientOrderId back on every event for the order (ProtoOAOrder.clientOrderId), so
      // this turns a guess into an identity.
      const clientOrderId = `argofx-${signal.signalId ?? 'manual'}-${Date.now()}`.slice(0, 50);
      const isOurs = (m: any) => m?.payload?.order?.clientOrderId === clientOrderId;

      // Step 7 — Place market order with SL + TP1
      this.send(socket, PT.NEW_ORDER_REQ, {
        ctidTraderAccountId: accountId,
        symbolId,
        orderType: 1,                                    // MARKET
        tradeSide: signal.type === 'LONG' ? 1 : 2,      // BUY=1, SELL=2
        volume,
        stopLoss:   signal.stop,
        takeProfit: signal.targets[0],                   // TP1 at 2:1 R:R
        clientOrderId,
      });

      // Recorded BEFORE the reply, so an order that is sent and then times out still leaves
      // evidence that it went to the broker. A missing row means the order was never sent; a
      // 'sent' row that never advances means we do not know what happened to it, which is a
      // materially different and much worse situation.
      recId = await this.record({
        ...base, status: 'sent', accountId, accountIsLive: matching[0].isLive === true,
        brokerSymbolId: symbolId, requestedVolume: volume, lots,
      });

      // Wait for execution confirmation — OURS, matched on clientOrderId.
      let exec = await this.waitFor(emitter, PT.EXECUTION_EVENT, 15000, isOurs);

      // ACCEPTED IS NOT A FILL, AND ACCEPTED CARRIES NO PRICE.
      //
      // executionType 2 (ACCEPTED) reports price 0. That is not an error, it is the event
      // arriving before the fill exists — and it is why 3 of 5 positioned rows recorded
      // fill_price 0. On 2026-09-04 AUD/USD's order was stamped 07:24:47.263 and its own deal
      // 07:24:47.595: the FILLED event was 332ms behind the ACCEPTED one and nothing waited for
      // it, so the true price was thrown away and the re-anchor never ran.
      //
      // Waiting for OUR next event is event-driven and exact. It replaces guessing, and it
      // cannot race — the broker either sends the fill or it does not.
      if (exec.payload?.executionType === 2) {
        try {
          const filled = await this.waitFor(
            emitter, PT.EXECUTION_EVENT, 8000,
            (m: any) => isOurs(m) && m?.payload?.executionType === 3,
          );
          console.log('[cTrader] ACCEPTED then FILLED — using the fill event for price');
          exec = filled;
        } catch {
          // Genuinely not filled inside the window. The reconcile below is the fallback, and the
          // recorded status stays 'accepted', which is the honest description.
          console.warn('[cTrader] order ACCEPTED but no FILLED event within 8s — falling back to reconcile');
        }
      }

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

      // The price the ALERT should quote. Starts as whatever the execution event gave, but the
      // event reports 0 when executionType is 2 (ACCEPTED) — which is what the real trade on
      // position 286227046 returned. Reconcile is the only source of the true price, so this is
      // reassigned below once the broker confirms. Without it the alert says "pending fill" a
      // moment after the fill was confirmed.
      let confirmedPrice: number | null = fillPrice;

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
        const { mine, open, attemptsUsed } = await this.fetchPosition(socket, emitter, accountId, positionId);
        if (attemptsUsed > 1) console.log(`[cTrader] position found on reconcile attempt ${attemptsUsed}`);
        reconciledOpen = positionId ? !!mine : open.length > 0;
        await this.amend(recId, {
          status: reconciledOpen ? 'filled' : undefined,
          // Backfill the REAL fill price. The execution event reports price 0 when executionType
          // is 2 (ACCEPTED) — measured on position 286227046, which recorded fill_price 0 while
          // the broker had filled at 0.81337. Only reconcile carries the true price, so without
          // this the executions table cannot measure slippage at all. The smoke test already did
          // this; the automatic path did not.
          fillPrice: mine?.price ?? undefined,
          reconciledAt: new Date().toISOString(), reconciledOpen,
        });
        // Use the broker-confirmed price in the alert, not the acceptance placeholder.
        if (mine?.price !== undefined && mine?.price !== null) confirmedPrice = Number(mine.price);

        // DID THE BROKER ACTUALLY ATTACH OUR STOP AND TARGET?
        //
        // On 2026-09-04 two positions exited at prices matching NEITHER their stop nor their
        // target: AUD/USD ran 28.4 pips against an 8.6-pip stop (3.3x the intended risk, -3.4%
        // of the account on one trade) and USD/CHF closed +$268.75 while its signal was recorded
        // STOP_HIT. Our code has exactly one close path and it fires only on EXPIRED, so we did
        // not close them — yet the levels we sent were not honoured either.
        //
        // Nothing stored could settle whether the levels were ever attached: deal payloads carry
        // the DEAL, not the POSITION. The reconcile response does carry it, and it is already in
        // hand here, so from now on every order records what protection the broker says it has.
        // An unprotected position that believes it has a stop is the worst state this can be in.
        if (mine) {
          const brokerSl = mine.stopLoss ?? null;
          const brokerTp = mine.takeProfit ?? null;
          if (brokerSl === null && brokerTp === null) {
            console.error(
              `[cTrader] 🚨 POSITION ${positionId} HAS NO SL/TP AT THE BROKER. `
              + `Sent SL ${signal.stop} TP ${signal.targets[0]} — the broker reports neither.`
            );
          } else {
            console.log(`[cTrader] broker confirms protection: SL=${brokerSl} TP=${brokerTp}`);
          }
        }
      } catch (e: any) {
        console.warn(`[cTrader] could not reconcile after order: ${e.message}`);
      }

      // ── RE-ANCHOR SL/TP TO THE ACTUAL FILL, AND MEASURE THE DRIFT ─────────────────────
      //
      // The order carries ABSOLUTE stop and target prices derived from `signal.entry` — a cached
      // 1H close the pre-registration measures as 5-8 pips STALE. The backtest harness instead
      // treats them as DISTANCES and re-anchors to the fill (`run-backtest.ts:226-233`), so live
      // and replay have never been trading the same geometry.
      //
      // Any drift s between the quoted entry and the real fill is a pure linear cost of
      // s/stopPips R, paid by winners and losers alike. Measured on current-generation signals:
      // +1.07 pips = 0.072 R per trade — LARGER than the entire measured deficit of 0.055 R.
      // Shrinking the stop from ~31 to ~14 pips (v3.2 -> v3.3) more than doubled that cost.
      //
      // FAIL-SAFE BY CONSTRUCTION: the absolute levels were already accepted with the order, so
      // if this amend fails the position keeps exactly the protection it has today. There is no
      // window in which the trade is unprotected.
      let slippagePips: number | null = null;
      if (confirmedPrice && positionId) {
        const isJpy     = signal.symbol.includes('JPY');
        const digits    = isJpy ? 3 : 5;
        const pipFactor = isJpy ? 100 : 10000;
        const long      = signal.type === 'LONG';
        const slDist    = Math.abs(signal.entry - signal.stop);
        const tpDist    = Math.abs(signal.targets[0] - signal.entry);
        const newStop   = Number((long ? confirmedPrice - slDist : confirmedPrice + slDist).toFixed(digits));
        const newTp     = Number((long ? confirmedPrice + tpDist : confirmedPrice - tpDist).toFixed(digits));

        // POSITIVE ALWAYS MEANS ADVERSE, on both sides. A signed number that means "worse for us"
        // whichever way the trade points is the only version that can be averaged across a book
        // containing both LONGs and SHORTs.
        slippagePips = Number(
          ((long ? confirmedPrice - signal.entry : signal.entry - confirmedPrice) * pipFactor).toFixed(2)
        );

        try {
          this.send(socket, PT.AMEND_POSITION_SLTP_REQ, {
            ctidTraderAccountId: accountId, positionId,
            stopLoss: newStop, takeProfit: newTp,
          });

          // VERIFY BY READBACK, NEVER BY "an event arrived".
          //
          // The obvious check — await waitFor(EXECUTION_EVENT) — cannot do this job. waitFor
          // matches on payload type ALONE: no clientMsgId, no executionType. The original order's
          // own late ORDER_FILLED satisfies it just as well as the amend's reply, so it would
          // resolve successfully whether or not the SL/TP ever changed. That is a fabricated
          // success flag on the one operation whose whole purpose is protecting the position.
          //
          // Asking the broker what it now holds is unambiguous, and reconcile is already proven.
          await new Promise(r => setTimeout(r, 500));
          const { mine: after } = await this.fetchPosition(socket, emitter, accountId, positionId, 2, 400);
          const halfPip = 0.5 / pipFactor;
          const matches = (got: any, want: number) =>
            got !== null && got !== undefined && Math.abs(Number(got) - want) <= halfPip;
          const amendOk = matches(after?.stopLoss, newStop) && matches(after?.takeProfit, newTp);

          if (amendOk) {
            console.log(
              `[cTrader] ✅ SL/TP re-anchored to fill ${confirmedPrice}: SL ${signal.stop} -> ${newStop} | `
              + `TP ${signal.targets[0]} -> ${newTp} | entry slippage ${slippagePips} pips (+ = adverse)`
            );
          } else {
            console.error(
              `[cTrader] ⚠️ AMEND NOT CONFIRMED for position ${positionId}. Wanted SL ${newStop} `
              + `TP ${newTp}; broker reports SL ${after?.stopLoss ?? 'none'} TP ${after?.takeProfit ?? 'none'}. `
              + `The original quoted-entry levels are what is live.`
            );
          }
        } catch (e: any) {
          // The quoted-entry levels stand. Worse than the fix, identical to yesterday.
          console.warn(`[cTrader] SL/TP re-anchor failed, absolute levels stand: ${e?.message ?? e}`);
        }

        // RECORD THE DRIFT REGARDLESS of whether the amend landed.
        //
        // `entry_slippage` has a schema default of '0.0' and the column comment already admits
        // "never populated -> grader is inert". 172 of 172 deduped rows read exactly 0.00, so
        // `execution-quality.ts` has been grading a number nobody writes, and production has
        // never once measured its own fill quality. It is the ONLY measurement that can move the
        // cost picture, and the cost picture is the whole question.
        if (signal.signalId) {
          try {
            await db.execute(sql`
              UPDATE signal_history SET entry_slippage = ${slippagePips}
              WHERE signal_id = ${signal.signalId}
            `);
          } catch (e: any) {
            console.warn(`[cTrader] could not record entry slippage: ${e?.message ?? e}`);
          }
        }
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
        const alert = await telegramNotifier.sendText(
          buildExecutionAlertMessage({
            live: this.isLiveMode, state, symbol: signal.symbol, type: signal.type,
            lots, fillPrice: confirmedPrice, stop: signal.stop, target: signal.targets[0],
            confidence: signal.confidence, tier: signal.tier, positionId,
          }),
          'paid', 'HTML'   // <b>/<code>; MarkdownV2 would 400 on the periods alone
        );

        // RECORD whether it actually arrived. sendText RETURNS failure rather than throwing, so
        // the catch below never fires on a rejected message — which is exactly how a full day of
        // alerts went missing on 2026-09-02 with no trace. Delivery is now a fact in the database.
        await this.amend(recId, {
          alertSent: alert.ok,
          alertError: alert.ok ? undefined : (alert.errors.join('; ') || 'unknown'),
        });
        if (!alert.ok) console.error(`[cTrader] EXECUTION ALERT FAILED: ${alert.errors.join('; ')}`);
      } catch (e: any) {
        // A notification failure must never affect a trade that has already been placed.
        console.warn(`[cTrader] execution alert not sent: ${e?.message ?? e}`);
        await this.amend(recId, { alertSent: false, alertError: String(e?.message ?? e) });
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
   * cTrader trendbar periods. Verified against help.ctrader.com/open-api/model-messages 2026-09-02
   * — NOT guessed. An unhandled or wrong payload type is what produced this executor's silent
   * 20-second timeout, so every constant here was read from the spec.
   */
  static readonly TRENDBAR_PERIOD = { M5: 5, M15: 7, M30: 8, H1: 9, H4: 10, D1: 12, W1: 13 } as const;

  /**
   * Historical candles from the BROKER's own feed. READ-ONLY — places nothing.
   *
   * Why this exists: signals are computed on Twelve Data prices and executed at cTrader prices.
   * That gap has never been measured, and it is a standing, unquantified source of error — the
   * two real trades on 2026-09-02 showed 0.4 and 1.1 pips of adverse slippage against the signal
   * entry, and nothing distinguishes "spread" from "our candles disagree with the broker's".
   *
   * This does NOT replace Twelve Data in production. Pre-registration Amendment 2 requires
   * production to stay on Twelve Data so the signal_provenance reproduction evidence stays
   * uncontaminated. This is a parallel measurement, nothing more.
   *
   * TWO ENCODING TRAPS, both from the spec rather than assumption:
   *   1. Prices are scaled by 100,000 and must be divided back, then rounded to symbol digits.
   *      Same family as the moneyDigits trap that would have overstated P&L 10^8x.
   *   2. A trendbar carries `low` plus DELTAS, not OHLC:
   *        open = low + deltaOpen, close = low + deltaClose, high = low + deltaHigh
   *      Reading `low` as the price, or treating deltas as absolute, silently yields plausible
   *      but wrong candles.
   *
   * Rate limit is 5 historical requests/second per connection (REQUEST_FREQUENCY_EXCEEDED on
   * breach, surfaced as ProtoOAErrorRes 2142). One request per timeframe is far inside that.
   */
  async listTrendbars(
    symbolName: string,
    period: number,
    fromMs: number,
    toMs: number,
  ): Promise<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }[]> {
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

      if (this.symbolIds.size === 0) {
        this.send(socket, PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
        const symMsg = await this.waitFor(emitter, PT.SYMBOLS_LIST_RES, 30000);
        for (const sym of (symMsg.payload?.symbol ?? [])) {
          if (sym.symbolName) this.symbolIds.set(sym.symbolName as string, sym.symbolId as number);
        }
      }
      const bare = symbolName.replace('/', '');
      const symbolId = this.symbolIds.get(bare) ?? this.symbolIds.get(symbolName);
      if (!symbolId) throw new Error(`Symbol ${symbolName} not found at the broker.`);

      this.send(socket, PT.GET_TRENDBARS_REQ, {
        ctidTraderAccountId: accountId, symbolId, period,
        fromTimestamp: Math.floor(fromMs), toTimestamp: Math.floor(toMs),
      });
      const res = await this.waitFor(emitter, PT.GET_TRENDBARS_RES, 30000);

      const digits = symbolName.includes('JPY') ? 3 : 5;
      const px = (v: number) => Number((v / 100_000).toFixed(digits));

      return (res.payload?.trendbar ?? []).map((b: any) => {
        const low = Number(b.low);
        return {
          timestamp: new Date(Number(b.utcTimestampInMinutes) * 60_000).toISOString(),
          open:  px(low + Number(b.deltaOpen  ?? 0)),
          high:  px(low + Number(b.deltaHigh  ?? 0)),
          low:   px(low),
          close: px(low + Number(b.deltaClose ?? 0)),
          volume: Number(b.volume ?? 0),
        };
      });
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
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
    /**
     * Chunk size. The docs state no maximum range for DEAL_LIST, but the tick endpoints cap at one
     * week and matching that is cheaper than discovering the real limit in production.
     */
    const DEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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

      // Chunk the whole range on ONE authenticated socket.
      //
      // The chunking used to live in the caller, which meant a fresh connection and a fresh OAuth
      // handshake per week of history. A cold start over a year would have opened ~52 sockets.
      // The window loop belongs here, where the connection already exists.
      for (let winStart = fromMs; winStart < toMs; winStart += DEAL_WINDOW_MS) {
        const winEnd = Math.min(winStart + DEAL_WINDOW_MS, toMs);
        let cursor = winStart;

        // Hard page cap. A server that keeps answering hasMore=true without advancing would
        // otherwise loop until the process dies.
        for (let page = 0; page < 20; page++) {
          this.send(socket, PT.DEAL_LIST_REQ, {
            ctidTraderAccountId: accountId, fromTimestamp: cursor, toTimestamp: winEnd, maxRows,
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
          // forever; de-duplication by dealId covers several deals sharing a timestamp.
          const newest = Math.max(...deals.map((d: any) => Number(d.executionTimestamp ?? d.createTimestamp ?? 0)));
          const next = newest + 1;
          if (!Number.isFinite(next) || next <= cursor || added === 0) break;   // no forward progress
          cursor = next;
        }
      }

      console.log(`[cTrader] deal history: ${all.length} deal(s) between ${new Date(fromMs).toISOString()} and ${new Date(toMs).toISOString()}`);
      return all;
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }

  /**
   * Close the broker position belonging to an EXPIRED signal.
   *
   * WHY THIS EXISTS
   *
   * `executeSignal` opens a position with SL and TP attached and then nothing ever closes it
   * except the broker hitting one of those levels. Our 48-hour expiry is a DATABASE event: the
   * validator marks the signal EXPIRED and moves on while the position is still live, so the
   * record says "closed" and real exposure continues — for days or weeks, invisible to the
   * correlation guard, which reads PENDING signals rather than broker positions.
   *
   * It bites hardest on a Friday. A Friday signal has 48 nominal hours but only 8-14 of open
   * market, expires during the weekend closure, and leaves a position exposed to the Sunday gap —
   * which a stop does not protect against.
   *
   * GUARDS, because this is the only automatic path in the system that can close a position:
   *   - EXPIRED only. TP1_HIT and STOP_HIT closed themselves at the broker.
   *   - Targeted by the positionId WE recorded at order time — never "close all".
   *   - demoPositions() refuses outright when live mode is set.
   *   - Reconciles first, so a position already gone is a no-op rather than an error.
   *   - Never throws: outcome recording must not depend on the broker being reachable.
   */
  async closePositionForSignal(signalId: string): Promise<{ closed: boolean; reason: string }> {
    try {
      if (!ctraderEnabled()) return { closed: false, reason: 'executor disabled' };
      if (!(await this.configured())) return { closed: false, reason: 'not configured' };
      if (this.isLiveMode) return { closed: false, reason: 'REFUSED: live mode' };

      const rows = (await db.execute(sql`
        SELECT position_id FROM ctrader_executions
        WHERE signal_id = ${signalId} AND position_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
      `)) as any[];
      const positionId = rows[0]?.position_id ? Number(rows[0].position_id) : null;
      if (!positionId) return { closed: false, reason: 'no broker position recorded for this signal' };

      const res = await this.demoPositions({
        close: true, confirm: 'CLOSE_DEMO_POSITIONS', positionId,
      });
      const closed = Array.isArray(res?.closed) && res.closed.some((c: any) => c.result === 'closed');
      const reason = closed
        ? `closed position ${positionId} on expiry`
        : `position ${positionId} was not open at the broker`;
      console.log(`[cTrader] expiry close: ${reason}`);
      return { closed, reason };
    } catch (e: any) {
      console.error(`[cTrader] expiry close failed for ${signalId}:`, e?.message ?? e);
      return { closed: false, reason: `error: ${e?.message ?? e}` };
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
  /**
   * Smoke test THE PRODUCTION PATH, not a parallel imitation of it.
   *
   * `smokeTestDemoOrder` proves the broker accepts our order SHAPE, and that was the right test
   * when the question was "does anything work at all". It is the wrong test now: every change
   * made on 2026-09-04/05 lives in `executeSignal` — the clientOrderId match, the ACCEPTED ->
   * FILLED chase, the reconcile retry, the SL/TP re-anchor and its readback verification — and
   * none of it is reachable from that method. A green smoke test would say nothing about them.
   *
   * So this drives `executeSignal` itself with a synthetic HIGH-tier signal built from a live
   * reference price and production geometry, then closes the position it opened.
   *
   * SIZED EXACTLY LIKE A REAL TRADE (1%), deliberately. Sizing it at the broker minimum would
   * make it a different code path through calcVolume than the one being tested, and the cost of
   * a full-size round trip on a demo account is one spread plus commission.
   *
   * Leaves nothing behind: the position is closed before returning. If that close fails the
   * response says so loudly rather than reporting success.
   */
  async smokeTestViaExecutor(confirm: string, symbol = 'EUR/USD'): Promise<any> {
    if (confirm !== 'PLACE_DEMO_ORDER') {
      throw new Error('Refused: confirmation string absent. This places a REAL order.');
    }
    if (!(await this.configured())) throw new Error('Refused: cTrader credentials are not configured.');
    if (this.isLiveMode) throw new Error('REFUSED: live mode is active. This only ever runs on demo.');

    const quotes = await exchangeRateAPI.fetchAllQuotes();
    const refPrice = quotes.find(q => q.symbol === symbol)?.exchangeRate;
    if (!refPrice || !Number.isFinite(refPrice)) {
      throw new Error(`Refused: no reference price for ${symbol}. Sending an order without one would test nothing.`);
    }

    const pipFactor = symbol.includes('JPY') ? 100 : 10000;
    const digits    = symbol.includes('JPY') ? 3 : 5;
    const MIN_SL_PIPS: Record<string, number> = { 'EUR/USD': 8, 'USD/CHF': 8, 'GBP/USD': 10, 'USD/JPY': 6 };
    const slPips    = MIN_SL_PIPS[symbol] ?? 8;

    const signalId = `smoke-${Date.now()}`;
    const entry = +refPrice.toFixed(digits);
    const stop  = +(entry - slPips / pipFactor).toFixed(digits);
    const tp1   = +(entry + (slPips * 2) / pipFactor).toFixed(digits);

    const startedAt = Date.now();
    await this.executeSignal({
      signalId, symbol, type: 'LONG', entry, stop,
      targets: [tp1, tp1, tp1], confidence: 999, tier: 'HIGH', positionSizePercent: 1.0,
    });
    const elapsedMs = Date.now() - startedAt;

    const rows = (await db.execute(sql`
      SELECT status, execution_type, order_id, position_id, fill_price, lots,
             signal_entry, signal_stop, signal_tp1, reconciled_open, alert_sent, alert_error, error
      FROM ctrader_executions WHERE signal_id = ${signalId} LIMIT 1
    `)) as any[];
    const row = rows[0] ?? null;

    // Close it. A smoke test that leaves exposure open is not a test, it is a trade.
    let closed: any = { closed: false, reason: 'no position to close' };
    if (row?.position_id) {
      try { closed = await this.closePositionForSignal(signalId); }
      catch (e: any) { closed = { closed: false, reason: e?.message ?? String(e) }; }
    }

    return {
      signalId, symbol, elapsedMs,
      sent: { entry, stop, tp1, slPips },
      broker: row,
      closed,
      // The four questions this test exists to answer.
      verdict: {
        orderFilled:        row?.execution_type === 3 || row?.status === 'filled',
        fillPriceCaptured:  row?.fill_price != null && Number(row.fill_price) > 0,
        positionReconciled: row?.reconciled_open === true,
        alertDelivered:     row?.alert_sent === true,
        positionClosed:     closed?.closed === true,
      },
      note: 'Check the Render logs for "SL/TP re-anchored" (confirmed) vs "AMEND NOT CONFIRMED", '
          + 'and for the "broker min distances" line — that is what settles whether distanceSetIn '
          + 'is points or percentage on this account, which relativeStopLoss adoption depends on.',
    };
  }

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

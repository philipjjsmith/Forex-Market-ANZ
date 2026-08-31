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
import { EventEmitter } from 'events';

const LIVE_HOST = 'live.ctraderapi.com';
const DEMO_HOST = 'demo.ctraderapi.com';
const LIVE_PORT = 5036; // JSON port — official docs: "JSON always requires port 5036 (and only this port)"

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
  SYMBOLS_LIST_REQ:  2114,
  SYMBOLS_LIST_RES:  2115,
  SYMBOL_BY_ID_REQ:  2116,
  SYMBOL_BY_ID_RES:  2117,
  EXECUTION_EVENT:   2126,
  GET_ACCOUNTS_REQ:  2149,
  GET_ACCOUNTS_RES:  2150,
  ERROR_RES:         2142,
  COMMON_ERROR:      50,
} as const;

export interface ExecuteSignalParams {
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

  get isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken);
  }

  /** Demo unless BOTH CTRADER_MODE=live and CTRADER_ALLOW_LIVE=true are set. */
  get isLiveMode(): boolean { return ctraderLiveMode(); }
  private get host(): string { return this.isLiveMode ? LIVE_HOST : DEMO_HOST; }

  // ─── Token management ────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

    const url = new URL('https://openapi.ctrader.com/apps/token');
    url.searchParams.set('grant_type', 'refresh_token');
    url.searchParams.set('refresh_token', this.refreshToken!);
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('client_secret', this.clientSecret!);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);

    const data = await res.json() as { accessToken: string; expiresIn: number; errorCode?: string };
    if (data.errorCode) throw new Error(`Token refresh error: ${data.errorCode}`);

    this.accessToken = data.accessToken;
    // Refresh 1 hour before actual expiry
    this.tokenExpiry = Date.now() + (data.expiresIn - 3600) * 1000;
    console.log('[cTrader] Access token refreshed ✅');
    return this.accessToken;
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
          // 2142 is ProtoOAErrorRes — surface it rather than letting callers time out blind.
          if (msg.payloadType === 2142) {
            emitter.emit('protoError', new Error(`${msg.payload?.errorCode}: ${msg.payload?.description}`));
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
    return Math.round(lots * 100); // cTrader API: volume = lots × 100
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
    if (!this.isConfigured) throw new Error('cTrader credentials are not configured');
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

  async executeSignal(signal: ExecuteSignalParams): Promise<void> {
    // Only HIGH tier trades live — MEDIUM is practice only
    if (signal.tier !== 'HIGH') return;

    // Arming switch first, so credentials alone can never place an order.
    if (!ctraderEnabled()) {
      console.log('[cTrader] DISABLED (CTRADER_ENABLED is not "true"). No order placed.');
      return;
    }

    if (!this.isConfigured) {
      // Deliberately does NOT tell the operator which variables to set. Setting them used to be
      // the only gate between a signal and a real trade.
      console.log('[cTrader] Enabled but not configured — credentials missing. No order placed.');
      return;
    }

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
      const volume    = this.calcVolume(signal.symbol, slPips, signal.positionSizePercent ?? 1.0);
      if (volume <= 0) {
        console.log(`[cTrader] positionSizePercent=${signal.positionSizePercent} -> zero volume. No order placed.`);
        return;
      }
      const lots      = volume / 100;

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

      // Wait for execution confirmation
      await this.waitFor(emitter, PT.EXECUTION_EVENT, 15000);
      console.log(`[cTrader] ✅ EXECUTED: ${signal.type} ${signal.symbol} | ${lots} lots | SL: ${signal.stop.toFixed(5)} | TP: ${signal.targets[0].toFixed(5)}`);

    } catch (err: any) {
      // Never crash signal generation — log and continue
      console.error('[cTrader] ❌ Execution failed:', err.message);
    } finally {
      socket?.close();
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
    if (!this.isConfigured) throw new Error('Refused: cTrader credentials are not configured.');
    if (this.isLiveMode) {
      throw new Error('REFUSED: live mode is active (CTRADER_MODE=live and CTRADER_ALLOW_LIVE=true). This test only ever runs on demo.');
    }

    const accessToken = await this.getAccessToken();
    const { socket, emitter } = await this.openConnection(DEMO_HOST);
    const transcript: any[] = [];
    const record = (m: any) => transcript.push({ type: m.payloadType, payload: CTraderExecutor.redact(m.payload) });

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

      this.send(socket, PT.NEW_ORDER_REQ, {
        ctidTraderAccountId: accountId,
        symbolId,
        orderType: 1,   // MARKET
        tradeSide: 1,   // BUY
        volume,
      });
      const exec = await this.waitFor(emitter, PT.EXECUTION_EVENT, 20000);
      record(exec);

      const pos = exec.payload?.position;
      return {
        placed: true,
        host: DEMO_HOST,
        accountId,
        accountIsLive: account.isLive === true,
        symbol: light.symbolName,
        symbolId,
        volume,
        volumeSource,
        minVolume, stepVolume,
        executionType: exec.payload?.executionType,
        positionId: pos?.positionId ?? exec.payload?.order?.positionId,
        entryPrice: pos?.price ?? exec.payload?.deal?.executionPrice,
        transcript,
      };
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  }
}

export const ctraderExecutor = new CTraderExecutor();

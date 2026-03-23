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
 * Protocol: TLS TCP to live.ctraderapi.com:5036 (JSON port)
 * Framing:  4-byte little-endian length prefix + UTF-8 JSON body
 * Auth:     AppAuth → GetAccounts → AccountAuth → SymbolLookup → NewOrder
 */

import tls from 'tls';
import { EventEmitter } from 'events';

const LIVE_HOST = 'live1.p.ctrader.com';
const LIVE_PORT = 5035; // JSON/protobuf port (confirmed from official SDK)

// cTrader Open API payload type numbers (decoded from protobuf binary)
const PT = {
  APP_AUTH_REQ:      2100,
  APP_AUTH_RES:      2101,
  ACCOUNT_AUTH_REQ:  2102,
  ACCOUNT_AUTH_RES:  2103,
  NEW_ORDER_REQ:     2106,
  SYMBOLS_LIST_REQ:  2114,
  SYMBOLS_LIST_RES:  2115,
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

  private openConnection(): Promise<{ socket: tls.TLSSocket; emitter: EventEmitter }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: LIVE_HOST, port: LIVE_PORT, rejectUnauthorized: true });
      const emitter = new EventEmitter();
      emitter.setMaxListeners(20);
      let buf = Buffer.alloc(0);

      socket.once('secureConnect', () => {
        console.log('[cTrader] TLS connected to live.ctraderapi.com:5036 ✅');
        resolve({ socket, emitter });
      });

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // Parse all complete messages from the buffer
        while (buf.length >= 4) {
          const msgLen = buf.readUInt32BE(0); // 4-byte big-endian length prefix (network byte order)
          if (buf.length < 4 + msgLen) break;
          const msgBuf = buf.subarray(4, 4 + msgLen);
          buf = buf.subarray(4 + msgLen);
          try {
            const msg = JSON.parse(msgBuf.toString('utf8'));
            console.log(`[cTrader] ← type:${msg.payloadType}`, JSON.stringify(msg.payload ?? {}).substring(0, 150));
            emitter.emit(`type:${msg.payloadType}`, msg);
          } catch { /* skip malformed */ }
        }
      });

      socket.on('error', (err) => {
        console.error('[cTrader] Socket error:', err.message);
        reject(err);
      });

      socket.setTimeout(30000, () => {
        socket.destroy();
        reject(new Error('Connection timed out after 30s'));
      });
    });
  }

  // ─── Message helpers ──────────────────────────────────────────────────────

  private send(socket: tls.TLSSocket, payloadType: number, payload: object): void {
    const json = JSON.stringify({ payloadType, payload });
    const msgBuf = Buffer.from(json, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    console.log(`[cTrader] → type:${payloadType}`, JSON.stringify(payload).substring(0, 150));
    socket.write(Buffer.concat([lenBuf, msgBuf]));
  }

  private waitFor(emitter: EventEmitter, payloadType: number, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for payloadType ${payloadType}`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        emitter.off(`type:${payloadType}`, onOk);
        emitter.off(`type:${PT.ERROR_RES}`, onErr);
        emitter.off(`type:${PT.COMMON_ERROR}`, onErr);
      };

      const onOk  = (msg: any) => { cleanup(); resolve(msg); };
      const onErr = (msg: any) => { cleanup(); reject(new Error(`cTrader error: ${JSON.stringify(msg.payload)}`)); };

      emitter.on(`type:${payloadType}`, onOk);
      emitter.on(`type:${PT.ERROR_RES}`,    onErr);
      emitter.on(`type:${PT.COMMON_ERROR}`, onErr);
    });
  }

  // ─── Position sizing ──────────────────────────────────────────────────────

  private calcVolume(symbol: string, slPips: number): number {
    const riskUsd        = this.accountBalance * 0.01; // 1% risk
    const pipValuePerLot = symbol.includes('JPY') ? 9 : 10; // USD value per pip per standard lot
    const lots = Math.min(10, Math.max(0.01,
      Math.round((riskUsd / (slPips * pipValuePerLot)) * 100) / 100
    ));
    return Math.round(lots * 100); // cTrader API: volume = lots × 100
  }

  // ─── Main execution flow ──────────────────────────────────────────────────

  async executeSignal(signal: ExecuteSignalParams): Promise<void> {
    // Only HIGH tier trades live — MEDIUM is practice only
    if (signal.tier !== 'HIGH') return;

    if (!this.isConfigured) {
      console.log('[cTrader] Skipping — add CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, CTRADER_REFRESH_TOKEN, CTRADER_ACCOUNT_BALANCE to Render env vars');
      return;
    }

    let socket: tls.TLSSocket | null = null;
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
      const liveAccounts = allAccounts.filter((a: any) => a.isLive === true);
      if (!liveAccounts.length) throw new Error(`No live accounts found. All accounts: ${JSON.stringify(allAccounts)}`);
      const accountId = liveAccounts[0].ctidTraderAccountId;
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
      const volume    = this.calcVolume(signal.symbol, slPips);
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
      socket?.destroy();
    }
  }
}

export const ctraderExecutor = new CTraderExecutor();

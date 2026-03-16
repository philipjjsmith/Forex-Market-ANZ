/**
 * Trade Executor — MatchTrader REST API
 * Auto-places trades on The5ers prop firm account when HIGH-tier signals fire.
 *
 * Required Render environment variables (add AFTER creating The5ers account):
 *   MTR_SERVER_URL       — MatchTrader server URL (from The5ers account email, e.g. https://xxx.match-trade.com)
 *   MTR_BROKER_ID        — Broker ID for The5ers (from The5ers account email)
 *   MTR_EMAIL            — Your The5ers login email
 *   MTR_PASSWORD         — Your The5ers login password
 *   MTR_ACCOUNT_BALANCE  — Starting balance in USD (default: 5000 for Bootcamp)
 *
 * How it works:
 *   1. HIGH-tier signal fires → authenticate with MatchTrader REST API
 *   2. Calculate lot size: 1% account risk ÷ (SL pips × pip value per lot)
 *   3. POST position/open with entry side, SL price, TP1 price
 *   4. Token cached 30 min to avoid repeated logins
 *   5. Any failure is caught and logged — NEVER crashes signal generation
 *
 * MEDIUM-tier signals are skipped — those are practice signals only.
 *
 * API source confirmed: github.com/fg0611/matchtraderapi
 *   POST /mtr-core-edge/login            → { tradingApiToken, uuid }
 *   POST /mtr-api/{uuid}/position/open   → places market order
 */

interface ExecuteSignalParams {
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  targets: number[];
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
}

class TradeExecutor {
  private token: string | null = null;
  private uuid: string | null = null;
  private tokenExpiry: number = 0;

  private get serverUrl() { return process.env.MTR_SERVER_URL; }
  private get brokerId() { return process.env.MTR_BROKER_ID; }
  private get email() { return process.env.MTR_EMAIL; }
  private get password() { return process.env.MTR_PASSWORD; }
  private get accountBalance() { return parseFloat(process.env.MTR_ACCOUNT_BALANCE || '5000'); }

  get isConfigured(): boolean {
    return !!(this.serverUrl && this.brokerId && this.email && this.password);
  }

  private async authenticate(): Promise<void> {
    // Reuse cached token for 30 minutes to avoid repeated logins
    if (this.token && Date.now() < this.tokenExpiry) return;

    const res = await fetch(`${this.serverUrl}/mtr-core-edge/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.email,
        password: this.password,
        brokerId: this.brokerId,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MatchTrader login failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { tradingApiToken: string; uuid: string };
    this.token = data.tradingApiToken;
    this.uuid = data.uuid;
    this.tokenExpiry = Date.now() + 30 * 60 * 1000; // 30-minute token cache
    console.log('[TradeExecutor] Authenticated with MatchTrader ✅');
  }

  private calculateLots(symbol: string, slPips: number): number {
    const riskAmount = this.accountBalance * 0.01; // 1% risk per trade
    // Standard lot pip values: EUR/USD and USD/CHF ≈ $10/pip/lot
    // JPY pairs: pip value ≈ $9/pip/lot at current rates
    const pipValuePerLot = symbol.includes('JPY') ? 9 : 10;
    const lots = riskAmount / (slPips * pipValuePerLot);
    // Clamp to valid range, round to 2 decimal places
    return Math.min(10, Math.max(0.01, Math.round(lots * 100) / 100));
  }

  async executeSignal(signal: ExecuteSignalParams): Promise<void> {
    // MEDIUM tier = practice only — skip live execution
    if (signal.tier !== 'HIGH') return;

    if (!this.isConfigured) {
      console.log('[TradeExecutor] Skipping — add MTR_SERVER_URL, MTR_BROKER_ID, MTR_EMAIL, MTR_PASSWORD to Render env vars to enable auto-execution');
      return;
    }

    try {
      await this.authenticate();

      const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
      const slPips = Math.abs(signal.entry - signal.stop) * pipFactor;
      const lots = this.calculateLots(signal.symbol, slPips);
      const instrument = signal.symbol.replace('/', ''); // EUR/USD → EURUSD

      const payload = {
        instrument,
        volume: lots,
        orderSide: signal.type === 'LONG' ? 'BUY' : 'SELL',
        slPrice: signal.stop,
        tpPrice: signal.targets[0], // TP1 at 2:1 R:R minimum
        isMobile: false,
      };

      const res = await fetch(`${this.serverUrl}/mtr-api/${this.uuid}/position/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Auth-Trading-Api': this.token!,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Position open failed (${res.status}): ${body}`);
      }

      console.log(
        `[TradeExecutor] ✅ Executed: ${signal.type} ${signal.symbol} | ` +
        `${lots} lots | SL: ${signal.stop.toFixed(5)} | TP1: ${signal.targets[0].toFixed(5)}`
      );
    } catch (err: any) {
      // Never crash signal generation — log and move on
      console.error('[TradeExecutor] ❌ Execution failed:', err.message);
      // Invalidate token on auth errors so next signal re-authenticates
      if (err.message?.includes('login failed') || err.message?.includes('401')) {
        this.token = null;
        this.tokenExpiry = 0;
      }
    }
  }
}

export const tradeExecutor = new TradeExecutor();

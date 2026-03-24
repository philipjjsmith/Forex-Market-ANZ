/**
 * Telegram Notification Service — ArgoFX
 *
 * Sends signal alerts, trade outcomes, and weekly summaries
 * to the ArgoFX free and paid Telegram channels.
 *
 * Required Render environment variables:
 *   TELEGRAM_BOT_TOKEN      — from @BotFather on Telegram
 *   TELEGRAM_CHAT_ID_PAID   — paid/live channel chat ID (bot must be admin there)
 *   TELEGRAM_CHAT_ID_FREE   — free/practice channel chat ID (bot must be admin there)
 *
 * Backward compatible: if new vars not set, falls back to TELEGRAM_CHAT_ID.
 *
 * Routing:
 *   HIGH-tier signals   → paid channel only
 *   MEDIUM-tier signals → free channel only
 *   Outcomes            → whichever channel the signal was posted to
 *   Weekly summary      → both channels
 */

// ─── Public interfaces (used by outcome-validator.ts) ────────────────────────

export interface OutcomeNotification {
  signalNumber: number;
  symbol: string;
  type: 'LONG' | 'SHORT';
  outcome: 'TP1_HIT' | 'STOP_HIT' | 'EXPIRED';
  entryPrice: number;
  outcomePrice: number;
  profitLossPips: number;
  stopPips: number;       // SL distance in pips — used to calculate R multiple
  durationMs: number;
  tier: 'HIGH' | 'MEDIUM';
  monthWins: number;
  monthLosses: number;
  monthPips: number;
  currentStreak: number;
}

export interface WeeklySummaryData {
  weekWins: number;
  weekLosses: number;
  weekExpired: number;
  weekNetPips: number;
  monthWins: number;
  monthLosses: number;
  monthNetPips: number;
  totalSignals: number;
}

// ─── Internal interface ───────────────────────────────────────────────────────

interface SignalNotification {
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  riskReward: number;
  rationale: string;
  version: string;
  signalNumber?: number; // optional — populated in Step 3
}

// ─── Static disclaimer — pre-escaped for MarkdownV2 ─────────────────────────
// Every dot, pipe, and exclamation must be escaped outside code/bold/italic spans.

const DISCLAIMER =
  '📡 ArgoFX \\| General advice only\\. Not tailored to your circumstances\\.' +
  ' Forex trading carries significant risk of loss\\. Trade at your own risk\\.';

// ─── Class ───────────────────────────────────────────────────────────────────

class TelegramNotifier {
  private botToken:    string | undefined;
  private chatIdPaid:  string | undefined; // HIGH-tier signals + outcomes
  private chatIdFree:  string | undefined; // MEDIUM-tier signals + outcomes

  constructor() {
    this.botToken   = process.env.TELEGRAM_BOT_TOKEN;
    const legacy    = process.env.TELEGRAM_CHAT_ID;
    this.chatIdPaid = process.env.TELEGRAM_CHAT_ID_PAID || legacy;
    this.chatIdFree = process.env.TELEGRAM_CHAT_ID_FREE || legacy;

    const hasSplit = !!(process.env.TELEGRAM_CHAT_ID_PAID && process.env.TELEGRAM_CHAT_ID_FREE);

    if (this.botToken && (this.chatIdPaid || this.chatIdFree)) {
      console.log(
        `[ArgoFX Telegram] Enabled — ${hasSplit
          ? 'two-channel routing (paid + free)'
          : 'single channel fallback (add TELEGRAM_CHAT_ID_PAID + TELEGRAM_CHAT_ID_FREE to split channels)'
        }`
      );
    } else {
      console.log('[ArgoFX Telegram] DISABLED — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID_PAID + TELEGRAM_CHAT_ID_FREE in Render env vars');
    }
  }

  get isEnabled(): boolean {
    return !!(this.botToken && (this.chatIdPaid || this.chatIdFree));
  }

  // ─── MarkdownV2 escape helper ──────────────────────────────────────────────
  // Apply to ALL dynamic text that sits outside a `code`, *bold*, or _italic_ span.
  // Prices always go inside `code` backtick spans — no escaping needed inside those.

  private static esc(value: string | number): string {
    return String(value).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
  }

  // Formats a pip value with sign, escaped for MarkdownV2 plain text context
  private static fmtPips(pips: number): string {
    const abs = Math.abs(pips).toFixed(1);
    return pips >= 0 ? `\\+${abs}` : `\\-${abs}`;
  }

  // Formats milliseconds as "6h 22m" or "45m"
  private static fmtDuration(ms: number): string {
    const totalMins = Math.floor(ms / 60000);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Win rate as integer percentage
  private static winRate(wins: number, losses: number): number {
    return wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
  }

  // ─── Signal Alert ──────────────────────────────────────────────────────────

  async sendSignalAlert(signal: SignalNotification): Promise<void> {
    if (!this.isEnabled) return;

    const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
    const slPips    = Math.abs(signal.entry - signal.stop)   * pipFactor;
    const tp1Pips   = Math.abs(signal.tp1   - signal.entry)  * pipFactor;
    const tp2Pips   = Math.abs(signal.tp2   - signal.entry)  * pipFactor;
    const tp3Pips   = Math.abs(signal.tp3   - signal.entry)  * pipFactor;

    const isHigh    = signal.tier === 'HIGH';
    const direction = signal.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    const tierLabel = isHigh ? 'Live Trade' : 'Practice Signal';
    const numStr    = signal.signalNumber ? `\\#${signal.signalNumber} — ` : '';
    const sym       = TelegramNotifier.esc(signal.symbol);
    const conf      = TelegramNotifier.esc(signal.confidence);
    const rr        = TelegramNotifier.esc(signal.riskReward.toFixed(1));

    // Condense rationale: take first 2 lines starting with ✅ or 🎯,
    // strip the point values like "(+25)" and escape the remainder.
    const rationaleLines = signal.rationale
      .split(' | ')
      .filter(l => l.startsWith('✅') || l.startsWith('🎯'))
      .slice(0, 2)
      .map(l => TelegramNotifier.esc(l.replace(/\s*\(\+?\-?\d+\)/g, '').trim()))
      .join('\n');

    const lines: string[] = [
      `🚨 *Signal ${numStr}${sym}*`,
      ``,
      `${direction} — ${tierLabel}`,
      `Confidence: *${conf}%* \\| R:R *${rr}:1*`,
      ``,
      `📍 Entry:  \`${signal.entry.toFixed(5)}\``,
      `🛑 Stop:   \`${signal.stop.toFixed(5)}\`  \\(${TelegramNotifier.esc(slPips.toFixed(1))} pips\\)`,
      `🎯 TP1:   \`${signal.tp1.toFixed(5)}\`  \\(\\+${TelegramNotifier.esc(tp1Pips.toFixed(1))} pips \\| ${rr}R\\)`,
      `🎯 TP2:   \`${signal.tp2.toFixed(5)}\`  \\(\\+${TelegramNotifier.esc(tp2Pips.toFixed(1))} pips\\)`,
      `🎯 TP3:   \`${signal.tp3.toFixed(5)}\`  \\(\\+${TelegramNotifier.esc(tp3Pips.toFixed(1))} pips\\)`,
    ];

    if (rationaleLines) {
      lines.push(``, rationaleLines);
    }

    lines.push(``, DISCLAIMER);

    const chatId = isHigh ? this.chatIdPaid : this.chatIdFree;
    if (chatId) await this.sendToChannel(lines.join('\n'), chatId);
  }

  // ─── Outcome Alert ─────────────────────────────────────────────────────────

  async sendOutcomeAlert(data: OutcomeNotification): Promise<void> {
    if (!this.isEnabled) return;

    const numStr  = data.signalNumber ? `\\#${data.signalNumber} ` : '';
    const sym     = TelegramNotifier.esc(data.symbol);
    const dir     = data.type === 'LONG' ? 'LONG' : 'SHORT';
    const wr      = TelegramNotifier.winRate(data.monthWins, data.monthLosses);
    const pipsStr = TelegramNotifier.fmtPips(data.profitLossPips);
    const mthPips = TelegramNotifier.fmtPips(data.monthPips);
    const dur     = TelegramNotifier.fmtDuration(data.durationMs);

    // R multiple — how many R units gained/lost
    const rMultiple = data.stopPips > 0
      ? Math.abs(data.profitLossPips / data.stopPips).toFixed(1)
      : '?';

    const lines: string[] = [];

    if (data.outcome === 'TP1_HIT') {
      lines.push(
        `✅ *Signal ${numStr}Closed — WIN*`,
        ``,
        `${sym} ${dir} → \`${pipsStr} pips\` \\| *${TelegramNotifier.esc(rMultiple)}R*`,
        ``,
        `📍 Entry:   \`${data.entryPrice.toFixed(5)}\``,
        `🎯 TP1 hit: \`${data.outcomePrice.toFixed(5)}\``,
        `⏱ Duration: \`${dur}\``,
        ``,
        `📊 *This month:* ${data.monthWins}W \\/ ${data.monthLosses}L \\(${wr}%\\) \\| \`${mthPips} pips\``,
      );
      if (data.currentStreak >= 2) {
        lines.push(`🔥 *Win streak: ${data.currentStreak}*`);
      }

    } else if (data.outcome === 'STOP_HIT') {
      lines.push(
        `❌ *Signal ${numStr}Closed — LOSS*`,
        ``,
        `${sym} ${dir} → \`${pipsStr} pips\` \\| *\\-1R*`,
        ``,
        `📍 Entry:    \`${data.entryPrice.toFixed(5)}\``,
        `🛑 Stop hit: \`${data.outcomePrice.toFixed(5)}\``,
        `⏱ Duration:  \`${dur}\``,
        ``,
        `📊 *This month:* ${data.monthWins}W \\/ ${data.monthLosses}L \\(${wr}%\\) \\| \`${mthPips} pips\``,
      );
      const streakMsg = data.currentStreak <= -2
        ? `📉 Loss streak: ${Math.abs(data.currentStreak)} — part of the process\\.`
        : 'Streak reset — back to work\\.';
      lines.push(TelegramNotifier.esc(streakMsg));

    } else {
      // EXPIRED
      lines.push(
        `⏰ *Signal ${numStr}Expired*`,
        ``,
        `${sym} ${dir} — no clear move in 48h`,
        `Entry: \`${data.entryPrice.toFixed(5)}\` — neither TP nor stop hit`,
        ``,
        `📊 *This month:* ${data.monthWins}W \\/ ${data.monthLosses}L`,
        `_Expired signals are not counted in win rate_`,
      );
    }

    lines.push(``, DISCLAIMER);

    const chatId = data.tier === 'HIGH' ? this.chatIdPaid : this.chatIdFree;
    if (chatId) await this.sendToChannel(lines.join('\n'), chatId);
  }

  // ─── Weekly Summary ────────────────────────────────────────────────────────

  async sendWeeklySummary(data: WeeklySummaryData): Promise<void> {
    if (!this.isEnabled) return;

    const weekWR  = TelegramNotifier.winRate(data.weekWins, data.weekLosses);
    const monthWR = TelegramNotifier.winRate(data.monthWins, data.monthLosses);
    const wkPips  = TelegramNotifier.fmtPips(data.weekNetPips);
    const moPips  = TelegramNotifier.fmtPips(data.monthNetPips);
    const total   = TelegramNotifier.esc(data.totalSignals);

    const message = [
      `📈 *ArgoFX Weekly Summary*`,
      ``,
      `*This week:*`,
      `✅ ${data.weekWins}W  ❌ ${data.weekLosses}L  ⏰ ${data.weekExpired} expired`,
      `Net: \`${wkPips} pips\` \\| Win rate: *${weekWR}%*`,
      ``,
      `*Month to date:*`,
      `${data.monthWins}W \\/ ${data.monthLosses}L — *${monthWR}% WR*`,
      `Net: \`${moPips} pips\``,
      ``,
      `📊 *All\\-time:* ${total} signals tracked`,
      `_Signals fire Mon–Fri during London \\& NY sessions_`,
      ``,
      DISCLAIMER,
    ].join('\n');

    // Weekly summary goes to BOTH channels
    const sends: Promise<void>[] = [];
    if (this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdPaid));
    }
    if (this.chatIdFree && this.chatIdFree !== this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdFree));
    }
    await Promise.all(sends);
  }

  // ─── sendText (ad-hoc / debug messages) ───────────────────────────────────

  async sendText(message: string, channel: 'paid' | 'free' | 'both' = 'paid'): Promise<void> {
    if (!this.isEnabled) return;
    if ((channel === 'paid' || channel === 'both') && this.chatIdPaid) {
      await this.sendToChannel(message, this.chatIdPaid);
    }
    if (
      (channel === 'free' || channel === 'both') &&
      this.chatIdFree &&
      this.chatIdFree !== this.chatIdPaid
    ) {
      await this.sendToChannel(message, this.chatIdFree);
    }
  }

  // ─── Core sender ───────────────────────────────────────────────────────────

  private async sendToChannel(text: string, chatId: string): Promise<void> {
    if (!this.botToken) return;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          text,
          parse_mode: 'MarkdownV2',
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[ArgoFX Telegram] Send failed (${response.status}): ${body}`);
      } else {
        console.log(`[ArgoFX Telegram] Message sent ✅`);
      }
    } catch (err) {
      // Never let a Telegram failure affect signal generation or outcome recording
      console.error('[ArgoFX Telegram] Network error:', err);
    }
  }
}

export const telegramNotifier = new TelegramNotifier();

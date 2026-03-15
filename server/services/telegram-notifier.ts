/**
 * Telegram Notification Service
 * Sends instant alerts when a trading signal fires.
 *
 * Required Render environment variables:
 *   TELEGRAM_BOT_TOKEN  — get from @BotFather on Telegram
 *   TELEGRAM_CHAT_ID    — your personal chat ID (get from @userinfobot)
 *
 * Setup (5 minutes):
 *   1. Message @BotFather on Telegram → /newbot → copy the token
 *   2. Message @userinfobot → copy your chat ID
 *   3. Add both to Render environment variables
 *   4. Message your bot once to activate the chat
 */

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
}

class TelegramNotifier {
  private botToken: string | undefined;
  private chatId: string | undefined;
  private enabled: boolean;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID;
    this.enabled = !!(this.botToken && this.chatId);

    if (this.enabled) {
      console.log('[Telegram] Notification service enabled');
    } else {
      console.log('[Telegram] Notification service DISABLED (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in Render env vars)');
    }
  }

  async sendSignalAlert(signal: SignalNotification): Promise<void> {
    if (!this.enabled) return;

    const direction = signal.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
    const tierBadge = signal.tier === 'HIGH' ? '⭐ LIVE TRADE' : '📋 PRACTICE';
    const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
    const slPips = Math.abs(signal.entry - signal.stop) * pipFactor;
    const tp1Pips = Math.abs(signal.tp1 - signal.entry) * pipFactor;

    const message = [
      `🚨 *NEW SIGNAL — ${signal.symbol}*`,
      ``,
      `${direction} ${tierBadge}`,
      `Confidence: *${signal.confidence}%*  |  R:R *${signal.riskReward.toFixed(1)}:1*`,
      ``,
      `📍 *Entry:* \`${signal.entry.toFixed(5)}\``,
      `🛑 *Stop:*  \`${signal.stop.toFixed(5)}\` (${slPips.toFixed(1)} pips)`,
      `🎯 *TP1:*  \`${signal.tp1.toFixed(5)}\` (+${tp1Pips.toFixed(1)} pips)`,
      `🎯 *TP2:*  \`${signal.tp2.toFixed(5)}\``,
      `🎯 *TP3:*  \`${signal.tp3.toFixed(5)}\``,
      ``,
      `📊 ${signal.rationale.split(' | ').slice(0, 3).join('\n📊 ')}`,
      ``,
      `_Strategy v${signal.version} — The5ers Bootcamp_`,
    ].join('\n');

    await this.send(message);
  }

  async sendText(message: string): Promise<void> {
    if (!this.enabled) return;
    await this.send(message);
  }

  private async send(text: string): Promise<void> {
    if (!this.botToken || !this.chatId) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`[Telegram] Send failed (${response.status}): ${body}`);
      } else {
        console.log('[Telegram] Signal notification sent ✅');
      }
    } catch (err) {
      // Never let Telegram failure crash signal generation
      console.error('[Telegram] Network error sending notification:', err);
    }
  }
}

export const telegramNotifier = new TelegramNotifier();

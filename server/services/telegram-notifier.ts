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

export interface DailySummaryData {
  resolved: { symbol: string; type: 'LONG' | 'SHORT'; outcome: string; profitLossPips: number }[];
  newSignals: number;
  monthWins: number;
  monthLosses: number;
  monthNetPips: number;
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
  orderType: string;
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

  /**
   * Config state for the admin panel. Reports PRESENCE, never values — a chat id is not a secret
   * but a bot token is, and a diagnostic that leaks the thing it is diagnosing is a bad trade.
   *
   * Exists because "I will get a Telegram when it trades" was an ASSUMPTION. The constructor logs
   * its state once at boot, to a Render free-tier console that does not survive a restart, so
   * nobody could actually check. An unconfigured notifier fails silently and by design — every
   * send is wrapped so a notification can never disturb a trade — which is correct behaviour and
   * also means silence is indistinguishable from success.
   */
  get configState() {
    return {
      enabled: this.isEnabled,
      botToken: this.botToken ? 'set' : 'MISSING',
      paidChannel: this.chatIdPaid ? 'set' : 'MISSING',
      freeChannel: this.chatIdFree ? 'set' : 'MISSING',
      routing: (process.env.TELEGRAM_CHAT_ID_PAID && process.env.TELEGRAM_CHAT_ID_FREE)
        ? 'two-channel (paid + free)'
        : this.chatIdPaid ? 'single channel via legacy TELEGRAM_CHAT_ID' : 'none',
    };
  }

  /**
   * Ask Telegram what the configured chats actually ARE.
   *
   * "It says sent but I see nothing" has two very different causes: the message was rejected, or
   * it went somewhere the operator is not looking. Config state cannot tell them apart — a chat id
   * is just a number, and a wrong number is indistinguishable from a right one until you ask
   * Telegram to name it.
   *
   * Returns the chat TITLE and id. Neither is a credential; the bot token is, and it is never
   * returned. `getChat` also fails in exactly the informative ways that matter: bot removed from
   * the group, chat deleted, or token revoked.
   */
  async describeChats(): Promise<any> {
    if (!this.botToken) return { error: 'no bot token' };

    const describe = async (label: string, chatId?: string) => {
      if (!chatId) return { label, configured: false };
      try {
        const r = await fetch(`https://api.telegram.org/bot${this.botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
        const j: any = await r.json();
        if (!j?.ok) return { label, chatId, ok: false, error: j?.description ?? `HTTP ${r.status}` };
        return {
          label, chatId, ok: true,
          title: j.result?.title ?? j.result?.username ?? '(no title)',
          type: j.result?.type,
        };
      } catch (e: any) {
        return { label, chatId, ok: false, error: e?.message ?? String(e) };
      }
    };

    // Identify the bot too — "which bot is even posting?" is the other half of the question.
    let bot: any = null;
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
      const j: any = await r.json();
      bot = j?.ok ? { username: j.result?.username, name: j.result?.first_name } : { error: j?.description };
    } catch (e: any) {
      bot = { error: e?.message ?? String(e) };
    }

    const paid = await describe('paid', this.chatIdPaid);
    const free = this.chatIdFree && this.chatIdFree !== this.chatIdPaid
      ? await describe('free', this.chatIdFree)
      : { label: 'free', sameAsPaid: true };

    return { bot, paid, free };
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

  /**
   * TP1 ONLY. TP2 and TP3 are computed and stored, but never advertised.
   *
   * They were shown until 2026-08-31, and every one of them was a promise the system could not
   * keep:
   *   - `checkOutcomeFromCandles` returns only TP1_HIT | STOP_HIT | EXPIRED, so TP2_HIT and
   *     TP3_HIT are UNREACHABLE outcomes. Across 72 deduplicated trades the record is
   *     STOP_HIT 44 / TP1_HIT 24 / EXPIRED 4 — neither has ever been written, and neither can be.
   *   - the cTrader executor, which is the system of record, sends ONE order with
   *     `takeProfit: targets[0]`. TP2 and TP3 are not traded on that path at all.
   *   - TP2 (6.0xATR) is used by nothing anywhere: not the validator, not either executor.
   *
   * A subscriber reading "TP2 +40 pips" reasonably takes it as an objective the system tracks.
   * It is not tracked and, on the live path, not traded. So it is not shown.
   *
   * The values remain in SignalNotification and in the database because the MT5 EA still reads
   * TP3 for its 50/50 split. Removing them from the alert does not remove them from the data.
   */
  async sendSignalAlert(signal: SignalNotification): Promise<void> {
    if (!this.isEnabled) return;

    const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
    const slPips    = Math.abs(signal.entry - signal.stop)   * pipFactor;
    const tp1Pips   = Math.abs(signal.tp1   - signal.entry)  * pipFactor;
    // tp2/tp3 are deliberately NOT shown. See the block comment on the alert body below.

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
      `📋 Order:  *${signal.orderType}*`,
      `📍 Entry:  \`${signal.entry.toFixed(5)}\``,
      `🛑 Stop:   \`${signal.stop.toFixed(5)}\`  \\(${TelegramNotifier.esc(slPips.toFixed(1))} pips\\)`,
      `🎯 TP1:   \`${signal.tp1.toFixed(5)}\`  \\(\\+${TelegramNotifier.esc(tp1Pips.toFixed(1))} pips \\| ${rr}R\\)`,
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

  async sendWeeklySummary(_data: WeeklySummaryData): Promise<void> {
    // Weekly summary temporarily disabled — re-enable by removing this line
    return;

    const wkPips  = TelegramNotifier.fmtPips(data.weekNetPips);
    const moPips  = TelegramNotifier.fmtPips(data.monthNetPips);
    const total   = TelegramNotifier.esc(data.totalSignals);

    const message = [
      `📈 *ArgoFX Weekly Summary*`,
      ``,
      `*This week:*`,
      `✅ *${data.weekWins} wins*${data.weekExpired > 0 ? `  ⏰ ${TelegramNotifier.esc(data.weekExpired)} no\\-trade` : ''}`,
      `Net: \`${wkPips} pips\``,
      ``,
      `*Month to date:*`,
      `✅ *${data.monthWins} wins* \\| Net: \`${moPips} pips\``,
      ``,
      `📊 *All\\-time:* ${total} signals tracked`,
      `_Signals fire Mon–Fri during London \\& NY sessions_`,
      ``,
      DISCLAIMER,
    ].join('\n');

    // Weekly summary goes to BOTH channels
    const sends: Promise<{ ok: boolean; error?: string }>[] = [];
    if (this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdPaid));
    }
    if (this.chatIdFree && this.chatIdFree !== this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdFree));
    }
    await Promise.all(sends);
  }

  // ─── Daily Summary ─────────────────────────────────────────────────────────

  async sendDailySummary(data: DailySummaryData): Promise<void> {
    if (!this.isEnabled) return;

    // Only post if something actually happened today
    if (data.resolved.length === 0 && data.newSignals === 0) return;

    const moPips   = TelegramNotifier.fmtPips(data.monthNetPips);
    const today    = new Date().toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });

    const lines: string[] = [
      `📋 *ArgoFX Daily Close — ${TelegramNotifier.esc(today)}*`,
      ``,
    ];

    if (data.resolved.length > 0) {
      for (const sig of data.resolved) {
        const sym     = TelegramNotifier.esc(sig.symbol);
        const dir     = sig.type === 'LONG' ? 'L' : 'S';
        const pipsStr = TelegramNotifier.fmtPips(sig.profitLossPips);

        const isWin = sig.outcome === 'TP1_HIT' || sig.outcome === 'TP2_HIT' || sig.outcome === 'TP3_HIT' ||
                      (sig.outcome === 'MANUALLY_CLOSED' && sig.profitLossPips > 0);
        const isLoss = sig.outcome === 'STOP_HIT' ||
                       (sig.outcome === 'MANUALLY_CLOSED' && sig.profitLossPips < 0);
        const icon = isWin ? '✅' : isLoss ? '❌' : '⏰';

        if (sig.outcome === 'EXPIRED') {
          lines.push(`${icon} ${sym} ${dir} — Expired`);
        } else {
          lines.push(`${icon} ${sym} ${dir} \\| \`${pipsStr} pips\``);
        }
      }
    }

    lines.push(
      ``,
      `📊 *Month to date:* ✅ ${data.monthWins} wins \\| \`${moPips} pips\``,
    );

    if (data.newSignals > 0) {
      lines.push(`🔔 *New signals today:* ${TelegramNotifier.esc(data.newSignals)}`);
    } else {
      lines.push(`_No new signals generated today_`);
    }

    lines.push(``, DISCLAIMER);

    const message = lines.join('\n');

    // Daily summary goes to BOTH channels
    const sends: Promise<{ ok: boolean; error?: string }>[] = [];
    if (this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdPaid));
    }
    if (this.chatIdFree && this.chatIdFree !== this.chatIdPaid) {
      sends.push(this.sendToChannel(message, this.chatIdFree));
    }
    await Promise.all(sends);
  }

  // ─── sendText (ad-hoc / debug messages) ───────────────────────────────────

  /**
   * Ad-hoc send. RETURNS THE RESULT — it used to return void.
   *
   * That mattered on 2026-09-02: the admin test button reported `sent: true` for a message
   * Telegram had REJECTED, because sendToChannel logged the failure and resolved anyway. The
   * operator saw nothing on their phone while the system said the send succeeded. Every
   * notification path here is deliberately non-fatal so a failed alert can never disturb a trade —
   * correct, and exactly why a caller that wants to VERIFY delivery has to be told the truth.
   *
   * `parseMode` defaults to MarkdownV2 for the existing callers, whose text is escaped for it.
   * Pass 'HTML' for anything using <b>/<code>: MarkdownV2 requires escaping `.`, `-`, `(`, `)`
   * and more, so an unescaped period is a 400.
   */
  async sendText(
    message: string,
    channel: 'paid' | 'free' | 'both' = 'paid',
    parseMode: 'MarkdownV2' | 'HTML' = 'MarkdownV2',
  ): Promise<{ ok: boolean; attempted: number; errors: string[] }> {
    if (!this.isEnabled) return { ok: false, attempted: 0, errors: ['Telegram is not configured'] };

    const results: { ok: boolean; error?: string }[] = [];
    if ((channel === 'paid' || channel === 'both') && this.chatIdPaid) {
      results.push(await this.sendToChannel(message, this.chatIdPaid, parseMode));
    }
    if (
      (channel === 'free' || channel === 'both') &&
      this.chatIdFree &&
      this.chatIdFree !== this.chatIdPaid
    ) {
      results.push(await this.sendToChannel(message, this.chatIdFree, parseMode));
    }
    return {
      ok: results.length > 0 && results.every(r => r.ok),
      attempted: results.length,
      errors: results.filter(r => !r.ok).map(r => r.error ?? 'unknown'),
    };
  }

  // ─── Core sender ───────────────────────────────────────────────────────────

  private async sendToChannel(
    text: string,
    chatId: string,
    parseMode: 'MarkdownV2' | 'HTML' = 'MarkdownV2',
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.botToken) return { ok: false, error: 'no bot token' };
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    chatId,
          text,
          parse_mode: parseMode,
        }),
      });

      // Telegram reports application failures in the BODY, not only the status. Check both:
      // a malformed entity, a bot removed from the group, or a chat id that no longer exists all
      // come back as ok:false with a description that names the actual problem.
      const body = await response.text();
      let payload: any = {};
      try { payload = JSON.parse(body); } catch { /* non-JSON: fall through to the status check */ }

      if (!response.ok || payload?.ok === false) {
        const why = payload?.description ?? body.slice(0, 300);
        console.error(`[ArgoFX Telegram] Send failed (${response.status}) to ${chatId}: ${why}`);
        return { ok: false, error: `${response.status}: ${why}` };
      }
      console.log(`[ArgoFX Telegram] Message sent ✅ to ${chatId}`);
      return { ok: true };
    } catch (err: any) {
      // Never let a Telegram failure affect signal generation or outcome recording — but DO
      // report it, so a caller that exists to verify delivery is not told it succeeded.
      console.error('[ArgoFX Telegram] Network error:', err);
      return { ok: false, error: `network: ${err?.message ?? err}` };
    }
  }
}

export const telegramNotifier = new TelegramNotifier();

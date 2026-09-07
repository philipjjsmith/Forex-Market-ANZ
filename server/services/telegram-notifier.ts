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
  /**
   * WHAT THE BROKER ACTUALLY PAID, when this signal was really executed.
   *
   * Everything above is MODELLED -- derived by replaying 5-minute candles, gross of spread,
   * commission and swap. On 2026-09-04 the two diverged catastrophically: USD/CHF was recorded
   * STOP_HIT at -9.8 pips while the broker settled it at +$268.75 (+2.755 R), and AUD/USD was
   * recorded -8.6 pips when the real loss was 28.4 pips (-3.30 R).
   *
   * Announcing a loss on a trade a subscriber won, and understating a real loss by 3.3x, is
   * worse than a thin explanation: it is contradicted by the reader's own account statement.
   * Absent when the signal was not auto-executed (MEDIUM tier, approval hold, executor off).
   */
  broker?: {
    realisedPnl: number | null;
    realisedR: number | null;
    realisedPips: number | null;
    exitPrice: number | null;
  };
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

/**
 * Escape for Telegram HTML parse mode. Three special characters, against MarkdownV2's eighteen.
 * That ratio is the entire reason the signal alert uses HTML: the reasoning lines are full of
 * brackets, parentheses, plus and minus signs and decimal points, and one missed MarkdownV2
 * escape is a 400 that silently drops the whole alert. That is how a full day of alerts was lost
 * on 2026-09-02.
 */
function htmlEsc(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A photo caption is capped at 1024 characters; a text message at 4096. Four times smaller, for
 * the message type we most want to carry the full reasoning.
 */
export const TELEGRAM_CAPTION_LIMIT = 1024;
/** sendPhoto accepts at most 10 MB when the file is uploaded rather than passed by URL. */
const TELEGRAM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * The length Telegram will actually measure a caption by.
 *
 * The documented cap is "0-1024 characters AFTER ENTITIES PARSING" — the markup does not count,
 * only what the reader sees. Checking `caption.length` therefore over-counts by the weight of
 * every tag, and the two numbers diverge by enough to matter: a real 108-point USD/CHF alert is
 * 1259 raw characters but 1151 visible.
 *
 * That 1151 is the point of this function. THE FULL SIGNAL ALERT DOES NOT RELIABLY FIT IN A
 * CAPTION. Measured on real signals, a thinner one lands at 756 (fits, 268 to spare) while the
 * rich one overflows by 127 — so a naive "send the alert as the caption" passes in testing and
 * then 400s in production on precisely the S-TIER signals with the most confluence lines, which
 * are the ones most worth publishing. The caller has to decide what to do about that; this
 * function is how it finds out, before sending rather than after.
 *
 * Telegram counts UTF-16 code units, which is what String.length already is, so an emoji counts
 * as the 2 it occupies for Telegram too.
 */
export function captionLength(caption: string): number {
  return caption
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .length;
}

/**
 * DEMO LABEL, carried by every signal.
 *
 * NFA Interpretive Notice 9025 names the exact abuse of "disguis[ing] hypothetical performance
 * results by referring to the performance with terms such as 'live' or 'real-time'". Nothing in
 * this system has ever traded real money. The label lives in the message itself rather than in a
 * channel description, because a forwarded message does not carry the channel with it.
 */
const DEMO_LABEL =
  '⚠️ <b>DEMO ACCOUNT — SIMULATED.</b> No real money is traded. Simulated results do not' +
  ' represent actual trading and are prepared with the benefit of hindsight.';

/**
 * HTML twin of DISCLAIMER.
 *
 * "General information published identically to all subscribers, not tailored" is not decoration.
 * It is the operative language for 17 CFR 4.14(a)(9)(ii), which is forfeited by PROVIDING advice
 * tailored to a particular client. The exemption is lost by the act, not the intent, so this
 * sentence has to remain true of every message the system sends.
 */
const DISCLAIMER_HTML =
  '📡 <i>ArgoFX · General information published identically to all subscribers. Not tailored to' +
  ' your circumstances, account or risk tolerance. Not investment advice. Forex trading carries a' +
  ' substantial risk of loss. Past performance is not necessarily indicative of future results.</i>';

/**
 * S/A/B tier label for a 135-point confidence score.
 *
 * Extracted so the alert body, the compact photo caption and the chart header cannot drift apart:
 * three places rendering the same score under three different names is a defect waiting to be
 * reported by a subscriber. The thresholds are the generator's own.
 */
export function signalTierName(confidence: number): 'S-TIER' | 'A-TIER' | 'B-TIER' {
  return confidence >= 115 ? 'S-TIER' : confidence >= 90 ? 'A-TIER' : 'B-TIER';
}

/**
 * Build the signal message.
 *
 * EXPORTED so it can be rendered and inspected without sending — the same reason
 * `buildExecutionAlertMessage` is exported, which is how the "Entry: pending fill" defect was
 * caught before any subscriber saw it. A formatter that can only be tested by publishing to a
 * live channel does not get tested.
 */
export function buildSignalAlertMessage(signal: SignalNotification): string {
  const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
  const slPips    = Math.abs(signal.entry - signal.stop)  * pipFactor;
  const tp1Pips   = Math.abs(signal.tp1   - signal.entry) * pipFactor;

  const isHigh    = signal.tier === 'HIGH';
  const direction = signal.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const digits    = signal.symbol.includes('JPY') ? 3 : 5;
  const px        = (v: number) => v.toFixed(digits);

  // A DISCRETE TIER, NOT A PERCENTAGE.
  //
  // This printed `Confidence: {confidence}%` on a 135-POINT scale, so 99 of 312 production signals
  // advertised a confidence ABOVE 100% -- up to 120%. It sat on the first line after the
  // direction, the worst possible place for a number that cannot be true.
  //
  // The deeper problem is that a percentage is a claim of CALIBRATION, and this project has
  // already refuted it: corr(confidence, R) = -0.0048 at n=1095. Publishing it as a probability
  // asserts something our own pre-registered work measured as false. The thresholds below are the
  // generator's own (signal-generator.ts:1169,1176) so the label cannot drift away from it.
  const tierName = signalTierName(signal.confidence);
  const tierNote = isHigh ? 'live trade' : 'practice signal — not traded';

  // EVERY LINE OF REASONING, NOT TWO.
  //
  // This used to `.slice(0, 2)` and strip the point values. Because the array is built
  // weekly -> daily -> 4H -> entry -> indicators -> ICT -> session, the first two are ALWAYS the
  // most generic lines in it. Replayed against a real 108-point USD/CHF signal, the engine
  // produced 13 lines and the alert sent two -- discarding the fair value gap and its consequent
  // encroachment level, the order block zone, the OB+FVG overlap, the pullback, and the actual
  // RSI and ADX readings. That is everything which makes this ICT rather than a moving-average
  // crossover, and it was the whole of the operator's complaint that the explanation did not
  // pertain to the strategy.
  //
  // The point values STAY. They are what shows a reader this is a scored system, not an opinion.
  const reasons = signal.rationale
    .split(' | ')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    // Drop the two trailing bookkeeping lines: the tier is rendered above in its own right, and
    // the prop-firm line is internal and means nothing to a subscriber.
    .filter(l => !/^(🟢|🟡)\s*[SAB]-TIER/.test(l) && !/^📊\s/.test(l))
    .map(l => htmlEsc(l));

  const lines: string[] = [
    `🚨 <b>SIGNAL${signal.signalNumber ? ' #' + signal.signalNumber : ''} · ${htmlEsc(signal.symbol)}</b>`,
    ``,
    `${direction} — <b>${tierName}</b> (${signal.confidence}/135) · <i>${tierNote}</i>`,
    `R:R <b>${signal.riskReward.toFixed(1)}:1</b> · ${htmlEsc(signal.orderType)}`,
    ``,
    `📍 Entry    <code>${px(signal.entry)}</code>`,
    `🛑 Stop     <code>${px(signal.stop)}</code>  (${slPips.toFixed(1)} pips · 1R)`,
    `🎯 Target   <code>${px(signal.tp1)}</code>  (+${tp1Pips.toFixed(1)} pips · ${signal.riskReward.toFixed(1)}R)`,
    ``,
    // INVALIDATION, stated as its own idea. A stop is where the position closes; invalidation is
    // what would make the reasoning wrong. Naming it is among the strongest credibility signals a
    // trade message can carry, and it costs nothing because the level already exists.
    `⚠️ <b>Invalidation:</b> price through <code>${px(signal.stop)}</code> ends this thesis.`,
  ];

  if (reasons.length) {
    lines.push(``, `<b>WHY THIS SETUP</b> — ${signal.confidence} of 135 confluence points`, ...reasons);
  }

  lines.push(``, DEMO_LABEL, DISCLAIMER_HTML);
  return lines.join('\n');
}

/**
 * The chart's caption. Deliberately compact, and deliberately NOT the full alert.
 *
 * WHY NOT JUST CAPTION THE WHOLE ALERT: a caption is capped at 1024 characters after entities
 * parsing, against 4096 for a message. Measured on real signals the full alert runs 756 visible
 * characters on a thin one and 1151 on a 108-point one — so it fits SOMETIMES. Captioning the
 * alert would therefore work in testing and then fail in production on precisely the richest
 * signals, and Telegram answers an over-long caption with a 400 that delivers nothing at all.
 * A fixed short caption plus the full message is the shape that behaves the same every time.
 *
 * WHY IT REPEATS THE PRICES THE CHART ALREADY DRAWS: a caption travels with a forwarded photo and
 * the neighbouring message does not. Someone who receives this second-hand gets the instrument,
 * the direction, the levels and the demo label without the picture having to be legible on their
 * screen — and the numbers stay selectable and copyable, which pixels are not.
 *
 * The demo label is here for the same forwarding reason it is in the alert body: NFA Interpretive
 * Notice 9025 is about the claim travelling with the content. The full disclaimer stays on the
 * message that follows, which is sent on every signal whether or not the chart renders.
 */
export function buildSignalCaption(signal: SignalNotification): string {
  const pipFactor = signal.symbol.includes('JPY') ? 100 : 10000;
  const digits    = signal.symbol.includes('JPY') ? 3 : 5;
  const px        = (v: number) => v.toFixed(digits);
  const slPips    = Math.abs(signal.entry - signal.stop)  * pipFactor;
  const tp1Pips   = Math.abs(signal.tp1   - signal.entry) * pipFactor;
  const direction = signal.type === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const tierNote  = signal.tier === 'HIGH' ? 'live trade' : 'practice signal — not traded';

  return [
    `🚨 <b>SIGNAL${signal.signalNumber ? ' #' + signal.signalNumber : ''} · ${htmlEsc(signal.symbol)}</b>`,
    `${direction} — <b>${signalTierName(signal.confidence)}</b> (${signal.confidence}/135) · <i>${tierNote}</i>`,
    `📍 <code>${px(signal.entry)}</code>  🛑 <code>${px(signal.stop)}</code> (${slPips.toFixed(1)}p)` +
      `  🎯 <code>${px(signal.tp1)}</code> (${tp1Pips.toFixed(1)}p · ${signal.riskReward.toFixed(1)}R)`,
    ``,
    `⚠️ <b>DEMO — SIMULATED.</b> No real money is traded. General information, not tailored advice.`,
    `<i>Full reasoning and disclaimer below ↓</i>`,
  ].join('\n');
}

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
   * Are the configured chats actually reachable? Cached, so it is safe on a polled endpoint.
   *
   * Config state proves the env vars are SET; it cannot prove they are VALID. On 2026-09-02
   * `TELEGRAM_CHAT_ID_PAID` held the literal string "FREE" — present, non-empty, and completely
   * unusable. Every HIGH-tier alert died on "chat not found" for a full day and the config check
   * reported `paidChannel: "set"` throughout.
   *
   * Only Telegram can answer this, so ask it — but at most every 10 minutes, because the admin
   * health endpoint is polled every 10 seconds and an uncached check would be ~8,600 calls a day.
   */
  private reachCache: { at: number; result: any } | null = null;

  async checkChatsReachable(maxAgeMs = 10 * 60_000): Promise<any> {
    if (this.reachCache && Date.now() - this.reachCache.at < maxAgeMs) {
      return { ...this.reachCache.result, cached: true };
    }
    if (!this.isEnabled) {
      const r = { ok: false, problems: ['Telegram is not configured'] };
      this.reachCache = { at: Date.now(), result: r };
      return r;
    }
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const [label, chatId] of [['paid', this.chatIdPaid], ['free', this.chatIdFree]] as const) {
      if (!chatId || seen.has(chatId)) continue;
      seen.add(chatId);
      try {
        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`);
        const j: any = await res.json();
        if (!j?.ok) problems.push(`${label} (${chatId}): ${j?.description ?? 'unreachable'}`);
      } catch (e: any) {
        problems.push(`${label} (${chatId}): ${e?.message ?? e}`);
      }
    }
    const result = { ok: problems.length === 0, problems };
    this.reachCache = { at: Date.now(), result };
    return result;
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
  async sendSignalAlert(
    signal: SignalNotification,
    /** Annotated setup chart. Optional: a signal without one is delivered exactly as before. */
    chart?: Buffer | null,
    /**
     * Banner prefixed to BOTH the caption and the message.
     *
     * Exists for the admin format test. That test previously marked itself only by writing
     * "FORMAT TEST" into the rationale — which appears in the message body and NOT in the photo
     * caption, so once a chart was attached the picture and its caption were indistinguishable
     * from a tradeable signal. A subscriber scrolling past reads the image, not the twelfth line
     * of the message under it.
     */
    opts: { note?: string } = {},
  ): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isEnabled) return { ok: false, errors: ['Telegram is not configured'] };
    const chatId = signal.tier === 'HIGH' ? this.chatIdPaid : this.chatIdFree;
    if (!chatId) return { ok: false, errors: ['no chat id for this tier'] };

    const errors: string[] = [];

    // THE CHART IS AN ENHANCEMENT; THE TEXT IS THE DELIVERABLE.
    //
    // It goes first so the picture leads the bubble, but a failure here must not cost the
    // subscriber their signal — so it is sent, recorded, and NOT allowed to short-circuit the
    // message below. `ok` therefore tracks the TEXT alone; a chart failure shows up in `errors`
    // where the admin format-test can see it, without the alert reporting itself as undelivered.
    const banner = opts.note ? `${opts.note}\n` : '';

    if (chart) {
      const p = await this.sendPhotoToChannel(
        chart, chatId, banner + buildSignalCaption(signal), 'HTML', 'setup.png');
      if (!p.ok) errors.push(`chart: ${p.error ?? 'unknown'}`);
    }

    const r = await this.sendToChannel(banner + buildSignalAlertMessage(signal), chatId, 'HTML');
    if (!r.ok) errors.push(r.error ?? 'unknown');
    return { ok: r.ok, errors };
  }

  // ─── Outcome Alert ─────────────────────────────────────────────────────────

  async sendOutcomeAlert(data: OutcomeNotification): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.isEnabled) return { ok: false, errors: ['Telegram is not configured'] };

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
      // DOUBLE-ESCAPE BUG, fixed 2026-09-02. These two strings were written PRE-escaped and then
      // passed through esc() again. esc() escapes backslashes as well, so the backslash became a
      // double backslash and the period gained its own escape — subscribers saw a stray backslash
      // before the period, on the LOSS notification specifically. The text is raw now and is
      // escaped exactly once, by esc(), which is the only place escaping should happen.
      const streakMsg = data.currentStreak <= -2
        ? `📉 Loss streak: ${Math.abs(data.currentStreak)} — part of the process.`
        : 'Streak reset — back to work.';
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

    // BROKER-REALISED RESULT, when the trade was actually executed.
    //
    // Everything above is the candle model. On 2026-09-04 the two disagreed by 3.76 R on one
    // trade -- STOP_HIT reported on a position the broker settled at +$268.75 -- and by 3.3x on
    // another, where a reported -8.6 pips was really -28.4. A subscriber checking their own
    // account would have caught both. Publishing the modelled figure alone is how a channel ends
    // up contradicted by its own readers.
    //
    // Every literal below goes through esc(). Hand-written MarkdownV2 backslashes are what cost
    // this project a full day of dropped alerts on 2026-09-02, and a first attempt at this very
    // block lost a backslash off a regex in the process of writing it.
    if (data.broker && (data.broker.realisedPnl !== null || data.broker.realisedR !== null)) {
      const b = data.broker;
      const E = TelegramNotifier.esc;
      lines.push(``, `🏦 *${E('Broker-realised (demo)')}*`);
      if (b.exitPrice !== null)    lines.push(`${E('Exit:')}   \`${b.exitPrice.toFixed(5)}\``);
      if (b.realisedPips !== null) lines.push(`${E('Result:')} \`${E(b.realisedPips.toFixed(1))} pips\``);
      if (b.realisedR !== null)    lines.push(`${E('R:')}      *${E(b.realisedR.toFixed(2))}R*`);
      if (b.realisedPnl !== null)  lines.push(`${E('Net:')}    *${E(b.realisedPnl.toFixed(2))}* ${E('(after commission and swap)')}`);
      lines.push(`_${E('Figures above are modelled from 5-minute candles and are gross of spread, commission and swap. This block is the money that actually moved.')}_`);
    }

    lines.push(``, DISCLAIMER);

    const chatId = data.tier === 'HIGH' ? this.chatIdPaid : this.chatIdFree;
    if (!chatId) return { ok: false, errors: ['no chat id for this tier'] };
    const r = await this.sendToChannel(lines.join('\n'), chatId);
    return { ok: r.ok, errors: r.ok ? [] : [r.error ?? 'unknown'] };
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

  /**
   * Send an image, with an optional caption, to the same channels `sendText` routes to.
   *
   * IT REFUSES AN OVER-LONG CAPTION RATHER THAN SENDING ONE.
   *
   * Telegram answers a 1025-character caption with a 400 and delivers nothing — not a truncated
   * caption, not a bare photo. Silently trimming here would be worse: the reasoning is the whole
   * point of the alert, and a transport that quietly edits the message is exactly how the signal
   * alert came to publish two rationale lines out of thirteen. So the transport refuses, names
   * the overflow, and leaves the decision with the caller, which is the only layer that knows
   * what may be dropped. Callers measure first with `captionLength`.
   *
   * Non-fatal like every other send here: it reports failure, it never throws into the pipeline.
   */
  async sendPhoto(
    photo: Buffer,
    opts: {
      caption?: string;
      channel?: 'paid' | 'free' | 'both';
      parseMode?: 'MarkdownV2' | 'HTML';
      /** Telegram infers the image type from this. */
      filename?: string;
    } = {},
  ): Promise<{ ok: boolean; attempted: number; errors: string[] }> {
    const { caption, channel = 'paid', parseMode = 'HTML', filename = 'chart.png' } = opts;

    if (!this.isEnabled) return { ok: false, attempted: 0, errors: ['Telegram is not configured'] };

    if (!Buffer.isBuffer(photo) || photo.length === 0) {
      return { ok: false, attempted: 0, errors: ['photo is empty — nothing to send'] };
    }
    if (photo.length > TELEGRAM_PHOTO_MAX_BYTES) {
      return {
        ok: false, attempted: 0,
        errors: [`photo is ${(photo.length / 1048576).toFixed(1)} MB — over Telegram's 10 MB upload limit`],
      };
    }
    if (caption) {
      const len = captionLength(caption);
      if (len > TELEGRAM_CAPTION_LIMIT) {
        return {
          ok: false, attempted: 0,
          errors: [`caption is ${len} visible characters — ${len - TELEGRAM_CAPTION_LIMIT} over Telegram's ${TELEGRAM_CAPTION_LIMIT} cap`],
        };
      }
    }

    const results: { ok: boolean; error?: string }[] = [];
    if ((channel === 'paid' || channel === 'both') && this.chatIdPaid) {
      results.push(await this.sendPhotoToChannel(photo, this.chatIdPaid, caption, parseMode, filename));
    }
    if (
      (channel === 'free' || channel === 'both') &&
      this.chatIdFree &&
      this.chatIdFree !== this.chatIdPaid
    ) {
      results.push(await this.sendPhotoToChannel(photo, this.chatIdFree, caption, parseMode, filename));
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
        // HARD TIMEOUT. This fetch had no upper bound, and until 2026-09-06 the signal alert
        // was awaited BEFORE the broker order was placed -- so a slow or hanging Telegram
        // delayed a live fill by however long it hung. The ordering is fixed separately; this
        // makes the notifier structurally incapable of blocking a trade for long even if that
        // regresses.
        signal: AbortSignal.timeout(10_000),
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

  /**
   * Upload one image to one chat.
   *
   * MULTIPART, NOT JSON. `sendPhoto` takes the file as a multipart/form-data part; there is no
   * JSON form of it for an uploaded buffer. Node 22's fetch (undici) builds the body and sets the
   * boundary itself, so THE CONTENT-TYPE HEADER MUST NOT BE SET HERE — writing it by hand emits a
   * boundary-less `multipart/form-data` and Telegram rejects the request. The filename is not
   * decoration either: Telegram infers the image type from it.
   *
   * Telegram re-encodes whatever arrives as JPEG at roughly 80-87%, which is not a defect to work
   * around — signal-chart.ts is drawn for it (large flat chips over thin coloured glyphs, nothing
   * below 15px, no 1px lines). Sending as a document would preserve the pixels exactly but would
   * arrive as a file attachment rather than an inline image, which defeats the purpose.
   *
   * The timeout is longer than the text sender's 10s because this uploads ~60-90 KB rather than
   * posting a JSON string. It is still bounded: since 3e72c5a the alert is sent AFTER the broker
   * order, so no wait here can delay a fill, but an unbounded notifier fetch is the specific
   * defect that once did.
   */
  private async sendPhotoToChannel(
    photo: Buffer,
    chatId: string,
    caption: string | undefined,
    parseMode: 'MarkdownV2' | 'HTML',
    filename: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.botToken) return { ok: false, error: 'no bot token' };
    try {
      const type = /\.jpe?g$/i.test(filename) ? 'image/jpeg' : 'image/png';
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', new Blob([photo], { type }), filename);
      if (caption) {
        form.append('caption', caption);
        form.append('parse_mode', parseMode);
      }

      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20_000),
      });

      // Same two-part check as the text sender: Telegram reports application failures in the
      // BODY, not only the status, so a 200 with ok:false is still a failure.
      const body = await response.text();
      let payload: any = {};
      try { payload = JSON.parse(body); } catch { /* non-JSON: fall through to the status check */ }

      if (!response.ok || payload?.ok === false) {
        const why = payload?.description ?? body.slice(0, 300);
        console.error(`[ArgoFX Telegram] Photo send failed (${response.status}) to ${chatId}: ${why}`);
        return { ok: false, error: `${response.status}: ${why}` };
      }
      console.log(`[ArgoFX Telegram] Photo sent ✅ to ${chatId} (${(photo.length / 1024).toFixed(0)} KB)`);
      return { ok: true };
    } catch (err: any) {
      console.error('[ArgoFX Telegram] Photo network error:', err);
      return { ok: false, error: `network: ${err?.message ?? err}` };
    }
  }
}

export const telegramNotifier = new TelegramNotifier();

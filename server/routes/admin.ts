import type { Express } from "express";
import { db } from "../db";
import { sql } from 'drizzle-orm';
import { signalGenerator } from '../services/signal-generator';
import { twelveDataAPI } from '../services/twelve-data';
import { exchangeRateAPI } from '../services/exchangerate-api';
import { ctraderExecutor, CTRADER_HOSTS } from '../services/ctrader-executor';
import { syncBrokerDeals } from '../services/broker-deals';
import { buildFidelityReport } from '../services/execution-fidelity';
import { telegramNotifier } from '../services/telegram-notifier';
import { buildPerformanceReport } from '../services/performance-report';
import { buildExecutionAlertMessage } from '../services/ctrader-executor';
import { buildCloseAlertMessage } from '../services/broker-deals';
import { runPriceCrosscheck } from '../services/price-crosscheck';
import { requireAuth, requireAdmin } from '../auth-middleware';
import { propFirmService } from '../services/prop-firm-config';
import { MAX_EFFECTIVE_EXPOSURE } from '../services/correlation-guard';

export function registerAdminRoutes(app: Express) {
  console.log('✅ Admin routes registered');

  /**
   * GET /api/admin/health
   * Returns system health status
   */
  /**
   * GET /api/admin/ctrader-diagnose  — READ ONLY.
   *
   * Reports the executor's arming state and enumerates the accounts on this cTID with their
   * live/demo flags. **Places no orders**; it never reaches NEW_ORDER_REQ.
   *
   * Needed because the credentials live only in Render, so the connection cannot be tested from
   * a developer machine without copying secrets around. Demo mode selects `isLive === false`, and
   * if no demo account exists the executor must refuse rather than fall back to a live one —
   * this is how you find that out before arming anything.
   */
  app.get("/api/admin/ctrader-diagnose", requireAuth, requireAdmin, async (_req, res) => {
    const state = {
      enabled: process.env.CTRADER_ENABLED === 'true',
      mode: process.env.CTRADER_MODE ?? '(unset -> demo)',
      allowLive: process.env.CTRADER_ALLOW_LIVE === 'true',
      // The real gate, which consults the PERSISTED token — not the env seed, whose value is
      // dead after its first use. Both are shown so a disagreement is visible rather than
      // silently deciding whether signals execute.
      configured: await ctraderExecutor.configured(),
      configuredFromEnvSeed: (ctraderExecutor as any).isConfiguredFromEnv === true,
      resolvedMode: (ctraderExecutor as any).isLiveMode ? 'LIVE' : 'DEMO',
      // Surfaced because position sizing depends on it and it was previously unobservable.
      // CTRADER_ACCOUNT_BALANCE defaults to 2500; the demo account actually holds 10000, so an
      // unset var silently sizes every trade at 0.25% risk while the code and the UI both say 1%.
      // "I think I set it" is not a verification — this makes the value the system is ACTUALLY
      // using visible, rather than the value anyone believes is configured.
      accountBalanceUsed: (ctraderExecutor as any).accountBalance,
      accountBalanceSource: process.env.CTRADER_ACCOUNT_BALANCE
        ? 'CTRADER_ACCOUNT_BALANCE'
        : 'DEFAULT 2500 — env var NOT set',
      // Whether execution alerts can actually REACH a phone. Reported here because an armed
      // executor the operator cannot hear from is only half a system.
      telegram: telegramNotifier.configState,
    };
    // Probe BOTH hosts read-only. APP_AUTH uses only CLIENT_ID/CLIENT_SECRET and never the
    // refresh token, so a failure there is a connectivity/app-registration problem, NOT a token
    // problem — distinguishing the two is the whole point of testing both.
    const probe = async (label: 'demo' | 'live') => {
      const t0 = Date.now();
      try {
        const r = await ctraderExecutor.listAccounts(CTRADER_HOSTS[label]);
        return { host: r.host, ok: true, ms: Date.now() - t0, accounts: r.accounts };
      } catch (e: any) {
        return { host: CTRADER_HOSTS[label], ok: false, ms: Date.now() - t0, error: String(e?.message).slice(0, 200) };
      }
    };

    const demo = await probe('demo');
    const live = await probe('live');
    const accounts = (demo.ok ? demo.accounts : live.ok ? live.accounts : []) ?? [];
    const demoCount = accounts.filter((a: any) => !a.isLive).length;

    // The OAuth token exchange happens BEFORE any socket is opened, so its failures must be
    // reported as token problems — not as host/handshake problems. Getting this backwards sends
    // you looking at firewalls when the answer is "mint a new token".
    const tokenFailed = [demo, live].every(p => /token refresh|ACCESS_DENIED|invalid_grant/i.test((p as any).error ?? ''));

    let verdict: string;
    if (tokenFailed) {
      verdict = 'OAUTH TOKEN REJECTED (ACCESS_DENIED) — this fails before any host is contacted, so it is not connectivity. The refresh token is expired, revoked, or was issued for a closed account or a different CLIENT_ID. Re-run the OAuth flow at /api/ctrader/auth-url to mint a new one.';
    } else if (!demo.ok && !live.ok) {
      verdict = 'NEITHER host completed the app handshake. APP_AUTH uses only CLIENT_ID/CLIENT_SECRET, so this is credentials or outbound connectivity on port 5036 — not the refresh token.';
    } else if (demoCount > 0) {
      verdict = 'A demo account exists — demo mode can run.';
    } else if (accounts.length) {
      verdict = 'Accounts found but NONE are demo. Demo mode will refuse to run (correct and safe). Create a demo account in cTrader.';
    } else {
      verdict = 'Handshake succeeded but no accounts were returned for this cTID — the refresh token may not be linked to any account.';
    }

    res.json({ success: demo.ok || live.ok, state, demo, live, demoAccounts: demoCount, verdict });
  });

  /**
   * POST /api/admin/ctrader-smoke-test — PLACES A REAL ORDER on the DEMO account.
   *
   * The only endpoint in this codebase that can open a position. Every guard lives in
   * smokeTestDemoOrder(): exact confirmation string, refuses live mode, demo-only account
   * selection, and a re-check that the broker authenticated the account we chose.
   *
   * POST rather than GET so it cannot be triggered by a prefetch, a link, or a monitor URL.
   */
  app.post("/api/admin/ctrader-smoke-test", requireAuth, requireAdmin, async (req, res) => {
    try {
      const confirm = (req.body?.confirm ?? req.query.confirm ?? '') as string;
      const symbol  = (req.body?.symbol  ?? req.query.symbol  ?? 'EUR/USD') as string;
      // viaExecutor drives the REAL executeSignal path -- clientOrderId matching, the
      // ACCEPTED->FILLED chase, the reconcile retry, the SL/TP re-anchor and its readback.
      // The legacy smoke test reaches none of that; it only proves the order SHAPE is accepted.
      if (req.body?.viaExecutor === true) {
        return res.json(await ctraderExecutor.smokeTestViaExecutor(confirm, symbol));
      }
      res.json(await ctraderExecutor.smokeTestDemoOrder(confirm, symbol));
    } catch (err: any) {
      res.status(400).json({ placed: false, error: err?.message ?? 'smoke test failed' });
    }
  });

  /**
   * GET  /api/admin/performance-report — PREVIEW only. Composes, posts nothing.
   * POST /api/admin/performance-report — publishes it to the channel.
   *
   * Split deliberately. Publishing to a subscriber channel is not something that should be one
   * click away from a page you opened to read a number, and a performance claim is the single
   * most consequential thing this system can say in public. Preview first, publish on purpose.
   */
  app.get("/api/admin/performance-report", requireAuth, requireAdmin, async (_req, res) => {
    try {
      res.json(await buildPerformanceReport());
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'failed' });
    }
  });

  app.post("/api/admin/performance-report", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (req.body?.confirm !== 'PUBLISH_PERFORMANCE') {
        return res.status(400).json({ published: false, error: 'Refused: confirmation string absent.' });
      }
      const report = await buildPerformanceReport();
      const result = await telegramNotifier.sendText(report.message, 'both', 'HTML');
      res.status(result.ok ? 200 : 400).json({ published: result.ok, errors: result.errors, report });
    } catch (err: any) {
      res.status(400).json({ published: false, error: err?.message ?? 'failed' });
    }
  });

  /**
   * GET /api/admin/price-crosscheck — do the prices we ANALYSE match the prices we TRADE?
   *
   * Read-only on both sides. Compares Twelve Data candles against cTrader's own trendbars for
   * every pair and timeframe, matched on exact timestamp. Changes no decision and touches no
   * signal; production stays on Twelve Data per pre-registration Amendment 2.
   *
   * Deliberately NOT on a cron. The Twelve Data side costs one call per pair per timeframe
   * (15 calls) against a shared 800/day budget that live signal generation depends on, so this
   * runs on demand and outside kill zones.
   */
  // POST, not GET. It has real side effects — ~15 Twelve Data calls against a shared 800/day
  // budget and a ~2 minute runtime — and a GET is retried freely by browsers and proxies, each
  // retry re-spending the whole budget.
  app.post("/api/admin/price-crosscheck", requireAuth, requireAdmin, async (req, res) => {
    try {
      const bars = Math.min(200, Math.max(10, parseInt(String(req.body?.bars ?? '60'), 10) || 60));
      res.json(await runPriceCrosscheck(bars, { force: req.body?.force === true }));
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'crosscheck failed' });
    }
  });

  /**
   * POST /api/admin/telegram-format-test — send ONE of every alert type and report which arrived.
   *
   * WHY THIS EXISTS
   *
   * Only the plain test alert has ever been confirmed delivering. The signal and outcome alerts
   * use MarkdownV2, where an unescaped period is a 400, and the OUTCOME alert has never once been
   * observed arriving in this system's history — there is a recorded month (27 May - 19 Jun 2026)
   * in which five trades resolved and no outcome notification appeared.
   *
   * Waiting for a real trade to find out means losing that trade's notification. This exercises
   * every format now.
   *
   * It calls the REAL builders and the REAL send methods — never a reproduction of the template.
   * A test that copies the message proves only that the copy works, and copies drift.
   */
  app.post("/api/admin/telegram-format-test", requireAuth, requireAdmin, async (req, res) => {
    try {
      if (req.body?.confirm !== 'SEND_FORMAT_TESTS') {
        return res.status(400).json({ error: 'Refused: confirmation string absent.' });
      }
      const results: Record<string, any> = {};

      // 1. SIGNAL alert — MarkdownV2, the real method.
      results.signalAlert = await telegramNotifier.sendSignalAlert({
        symbol: 'USD/CHF', type: 'LONG', entry: 0.81333, stop: 0.81238,
        tp1: 0.81523, tp2: 0.81713, tp3: 0.82188, confidence: 108, tier: 'HIGH',
        // rationale is a STRING, not an array — sendSignalAlert calls .split() on it. The first
        // run of this test passed an array and failed with "signal.rationale.split is not a
        // function", which is the test doing its job: a wrong fixture caught here rather than a
        // wrong assumption surviving into a real signal.
        riskReward: 2, rationale: 'FORMAT TEST - not a real signal',
        version: 'format-test', signalNumber: 0, orderType: 'MARKET',
      } as any);

      // 2. OUTCOME alert — MarkdownV2. The one with no delivery history.
      results.outcomeAlert = await telegramNotifier.sendOutcomeAlert({
        signalNumber: 0, symbol: 'USD/CHF', type: 'LONG', outcome: 'STOP_HIT',
        entryPrice: 0.81459, outcomePrice: 0.81330, profitLossPips: -12.9,
        stopPips: 12.9, durationMs: 43 * 60_000, tier: 'HIGH',
        monthWins: 54, monthLosses: 110, monthPips: -555, currentStreak: -1,
      } as any);

      // 3. EXECUTION alert — HTML, built by the same function production uses.
      results.executionAlert = await telegramNotifier.sendText(
        '🧪 <b>FORMAT TEST</b>\n' + buildExecutionAlertMessage({
          live: false, state: 'OPEN AT BROKER ✅', symbol: 'USD/CHF', type: 'LONG',
          lots: 0.86, fillPrice: 0.81337, stop: 0.81238, target: 0.81523,
          confidence: 108, tier: 'HIGH', positionId: 286227046,
        }), 'paid', 'HTML');

      // 4. CLOSE alert — HTML, same builder as the real close path.
      results.closeAlert = await telegramNotifier.sendText(
        '🧪 <b>FORMAT TEST</b>\n' + buildCloseAlertMessage({
          win: false, exitPrice: 0.81327, entryPrice: 0.81470,
          grossProfit: -137.15, swap: 0, closeCommission: -7.02,
          netProfit: -144.17, balanceAfter: 10085.34, positionId: 286259147,
        }), 'paid', 'HTML');

      const failed = Object.entries(results).filter(([, v]: any) => !v?.ok).map(([k]) => k);
      res.status(failed.length ? 400 : 200).json({
        allDelivered: failed.length === 0, failed, results,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'format test failed' });
    }
  });

  /**
   * POST /api/admin/telegram-test — send one real message to the paid channel.
   *
   * Config state proves the variables are SET; only an actual send proves the bot is still in the
   * channel, still an admin there, and that the token has not been revoked. Those fail
   * independently of configuration and all three fail silently, because every notification path is
   * deliberately wrapped so it can never disturb a trade.
   *
   * POST so no prefetch or monitor URL can spam the channel.
   */
  app.post("/api/admin/telegram-test", requireAuth, requireAdmin, async (_req, res) => {
    try {
      if (!telegramNotifier.isEnabled) {
        return res.status(400).json({ sent: false, reason: 'Telegram is not configured', state: telegramNotifier.configState });
      }
      // HTML, not MarkdownV2: this text contains periods, and MarkdownV2 400s on an unescaped
      // one. That is exactly why the first version of this test reported success on a rejected
      // message.
      const result = await telegramNotifier.sendText(
        `🔔 <b>ArgoFX test alert</b>

`
        + `If you can read this on your phone, execution and close alerts will reach you.
`
        + `Sent ${new Date().toISOString()}`,
        'paid', 'HTML'
      );
      // Report what Telegram actually said. `sent` used to be hardcoded true.
      res.status(result.ok ? 200 : 400).json({
        sent: result.ok, channel: 'paid', attempted: result.attempted,
        errors: result.errors, state: telegramNotifier.configState,
        // Which chat it actually went to, by NAME. The whole point: 'sent' plus a chat id
        // still cannot tell you whether it landed where you are looking.
        chats: await telegramNotifier.describeChats(),
      });
    } catch (err: any) {
      res.status(400).json({ sent: false, error: err?.message ?? 'send failed', state: telegramNotifier.configState });
    }
  });

  /**
   * POST /api/admin/broker-deals/sync — pull cTrader's own deal history.
   *
   * READ-ONLY against the broker: it fetches history and places, amends and closes nothing. POST
   * rather than GET because it WRITES to our database (and so must not be triggerable by a
   * prefetch or a monitor URL), not because it risks anything at the broker.
   *
   * This is what makes modelled outcomes falsifiable. Until it existed, every win/loss and pip
   * figure came from scanning candles, and nothing had ever been checked against a real fill.
   */
  app.post("/api/admin/broker-deals/sync", requireAuth, requireAdmin, async (_req, res) => {
    try {
      res.json(await syncBrokerDeals());
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'deal sync failed' });
    }
  });

  /**
   * GET /api/admin/broker-deals — what the broker says, next to what we modelled.
   *
   * The comparison is the point. `signal_history` holds the modelled outcome; `ctrader_deals`
   * holds what actually filled and closed. Showing them apart would let them drift; showing them
   * together is what surfaces slippage, swap and gap-throughs.
   */
  app.get("/api/admin/broker-deals", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const deals = await db.execute(sql`
        SELECT deal_id, position_id, symbol_id, trade_side, filled_volume, execution_price,
               deal_status, is_close, entry_price, gross_profit, swap, close_commission,
               net_profit, balance_after, executed_at
        FROM ctrader_deals ORDER BY executed_at DESC NULLS LAST LIMIT 50
      `);
      const closed = await db.execute(sql`
        SELECT e.symbol, e.side, e.tier, e.signal_id, e.position_id,
               e.signal_entry, e.broker_entry_price, e.fill_price,
               e.signal_stop, e.signal_tp1, e.exit_price, e.realized_pnl,
               e.created_at, e.closed_at
        FROM ctrader_executions e
        WHERE e.position_id IS NOT NULL
        ORDER BY e.created_at DESC LIMIT 50
      `);
      const [sync] = (await db.execute(sql`SELECT * FROM ctrader_deal_sync WHERE id = 1`)) as any[];
      // Modelled record vs the broker's own money, per trade. Added 2026-09-05 after a USD/CHF
      // LONG recorded STOP_HIT at -9.8 pips settled at +$268.75 — a 3.76 R error on one trade,
      // against a programme whose whole measured edge is -0.055 R. Never throws: a reporting
      // failure must not take down the page that shows the trades.
      let fidelity: any = null;
      try { fidelity = await buildFidelityReport(); }
      catch (e: any) { fidelity = { error: e?.message ?? 'fidelity report failed' }; }
      res.json({ sync: sync ?? null, orders: closed, deals, fidelity });
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'failed' });
    }
  });

  /** GET = list open demo positions (read-only). POST = close them (needs the confirm string). */
  app.get("/api/admin/ctrader-positions", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await ctraderExecutor.demoPositions()); }
    catch (err: any) { res.status(400).json({ error: err?.message ?? 'failed' }); }
  });

  app.post("/api/admin/ctrader-positions/close", requireAuth, requireAdmin, async (req, res) => {
    try {
      res.json(await ctraderExecutor.demoPositions({
        close: true,
        confirm: (req.body?.confirm ?? req.query.confirm ?? '') as string,
        positionId: req.body?.positionId ? Number(req.body.positionId) : undefined,
      }));
    } catch (err: any) { res.status(400).json({ error: err?.message ?? 'failed' }); }
  });

  app.get("/api/admin/health", requireAuth, requireAdmin, async (req, res) => {
    try {
      // Get pending signals count
      const pendingResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM signal_history
        WHERE outcome = 'PENDING'
      `);
      const pendingSignals = (pendingResult as any)[0]?.count || 0;

      // Get validated today count
      const validatedResult = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM signal_history
        WHERE outcome_time >= CURRENT_DATE
        AND outcome IN ('TP1_HIT', 'STOP_HIT')
      `);
      const validatedToday = (validatedResult as any)[0]?.count || 0;

      // Get API usage stats
      const exchangeRateStats = exchangeRateAPI.getCacheStats();
      const twelveDataStats = await twelveDataAPI.getCacheStats();
      const twelveDataUsage = await twelveDataAPI.getUsageStats();

      // Calculate cache hit rates (simplified - you'd track this in production)
      const exchangeRateCacheHitRate = exchangeRateStats.size > 0 ? 85 : 0;
      const twelveDataCacheHitRate = twelveDataStats.size > 0 ? 75 : 0;

      // Telegram reachability, cached in the notifier so this polled endpoint stays cheap.
      // Reported here because a broken chat id is invisible everywhere else until a trade fires
      // and the alert silently fails — which is exactly what happened on 2026-09-02.
      const telegram = {
        ...telegramNotifier.configState,
        reachability: await telegramNotifier.checkChatsReachable(),
      };

      const health = {
        status: 'healthy' as const,
        telegram,
        signalGenerator: {
          isRunning: false, // We'd track this in a real implementation
          lastRun: new Date().toISOString(), // Placeholder
          nextRun: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 mins from now
          signalsGenerated: 0,
          signalsTracked: 0,
        },
        outcomeValidator: {
          isRunning: false,
          lastRun: new Date().toISOString(),
          pendingSignals,
          validatedToday,
        },
        apiUsage: {
          exchangeRateAPI: {
            callsToday: 0, // Would track this in production
            limit: 1500,
            cacheHitRate: exchangeRateCacheHitRate,
          },
          twelveDataAPI: {
            callsToday: 0, // Would track this in production
            limit: 800,
            cacheHitRate: twelveDataCacheHitRate,
          },
        },
      };

      res.json(health);
    } catch (error: any) {
      console.error('Error fetching admin health:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/logs
   * Returns recent signal generation logs
   */
  app.get("/api/admin/logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      // In a real implementation, you'd store these in a separate logs table
      // For now, we'll derive from signal_history
      const result = await db.execute(sql`
        SELECT
          DATE_TRUNC('hour', created_at) as hour,
          COUNT(*) as signals_tracked,
          MIN(created_at) as timestamp
        FROM signal_history
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY hour DESC
        LIMIT 10
      `);

      const logs = (result as any[]).map((row, idx) => ({
        id: `log-${idx}`,
        timestamp: row.timestamp,
        duration: Math.floor(Math.random() * 60) + 30, // Simulated
        pairsProcessed: 5,
        signalsGenerated: parseInt(row.signals_tracked) || 0,
        signalsTracked: parseInt(row.signals_tracked) || 0,
        errors: [],
        status: 'success' as const,
      }));

      res.json(logs);
    } catch (error: any) {
      console.error('Error fetching admin logs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/admin/trigger-generation
   * Manually trigger signal generation
   */
  app.post("/api/admin/trigger-generation", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('🎯 Manual signal generation triggered by admin');

      // Trigger generation in the background
      signalGenerator.generateSignals().catch(error => {
        console.error('Error in manual signal generation:', error);
      });

      res.json({
        success: true,
        message: 'Signal generation started. Check logs for progress.'
      });
    } catch (error: any) {
      console.error('Error triggering generation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/growth-stats-dual
   * Returns DUAL growth tracking metrics: FXIFY-only (HIGH tier) + All signals
   * This separates real trading performance from AI learning data
   * Query params:
   * - days: filter by days (7, 30, 90, or 0 for all time - default 0)
   */
  app.get("/api/admin/growth-stats-dual", requireAuth, requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 0; // 0 = all time
      const versionFilter = req.query.version as string || 'all';
      const historicalFilter = req.query.historical as string || 'all'; // 🆕 Historical data filter
      const dataQualityFilter = req.query.dataQuality as string || 'production'; // 🆕 Data quality filter (DEFAULT: production only)

      // Build date filter
      let dateFilter = sql``;

      // 🆕 Historical filter takes precedence (100% accurate date-based filtering)
      if (historicalFilter === 'freshstart') {
        // FRESH START: Jan 19, 2026 - Clean slate for new strategy tracking
        dateFilter = sql`AND created_at >= '2026-01-19 00:00:00 UTC'`;
      } else if (historicalFilter === 'nov4forward') {
        // Show only signals from Nov 4, 2025 05:44:16 UTC forward (after fix deployment)
        dateFilter = sql`AND created_at >= '2025-11-04 05:44:16 UTC'`;
      } else if (days > 0) {
        // Use days-based filter (Last 7/30/90 days)
        dateFilter = sql`AND outcome_time >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`;
      }
      // else: all time (no date filter)

      // 🆕 Version filtering for v2.2.0 comparison (less accurate than date filter)
      let strategyVersionFilter = sql``;
      if (versionFilter === 'v2.2.0') {
        strategyVersionFilter = sql`AND strategy_version = '2.2.0'`;
      } else if (versionFilter === 'v2.1.0') {
        strategyVersionFilter = sql`AND strategy_version = '2.1.0'`;
      } else if (versionFilter === 'legacy') {
        strategyVersionFilter = sql`AND strategy_version IN ('1.0.0', '2.0.0')`;
      }

      // 🆕 Data quality filtering (Professional soft delete)
      // Defaults to 'production' to show only clean v3.1.0+ signals
      // Options: 'production' (v3.1.0+), 'legacy' (pre-Nov 19 buggy data), 'all' (everything)
      let dataQualitySQL = sql``;
      if (dataQualityFilter === 'production') {
        dataQualitySQL = sql`AND data_quality = 'production'`;
      } else if (dataQualityFilter === 'legacy') {
        dataQualitySQL = sql`AND data_quality = 'legacy'`;
      }
      // else: 'all' - no filter, show everything

      // ============================================================
      // FXIFY PERFORMANCE (HIGH TIER ONLY - 80+ confidence)
      // ============================================================

      // 1. FXIFY Overall metrics
      const fxifyOverallResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COALESCE(SUM(profit_loss_pips), 0) as total_profit_pips,
          COALESCE(AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')), 0) as avg_win_pips,
          COALESCE(AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'), 0) as avg_loss_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          ROUND(AVG(EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600)::numeric, 1) as avg_hold_hours,
          ROUND(MAX(profit_loss_pips)::numeric, 1) as best_trade_pips,
          ROUND(MIN(profit_loss_pips)::numeric, 1) as worst_trade_pips,
          ROUND(STDDEV_SAMP(profit_loss_pips)::numeric, 4) as sd_pips,
          COUNT(*) FILTER (WHERE type = 'LONG') as longs,
          COUNT(*) FILTER (WHERE type = 'SHORT') as shorts,
          COUNT(*) FILTER (WHERE type = 'LONG'  AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as long_wins,
          COUNT(*) FILTER (WHERE type = 'SHORT' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as short_wins
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          AND trade_live = true
          AND tier = 'HIGH'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
      `);

      const fxifyOverall = (fxifyOverallResult as any)[0];

      // 2. FXIFY Cumulative profit over time
      const fxifyCumulativeProfitResult = await db.execute(sql`
        WITH daily_profits AS (
          SELECT
            DATE(outcome_time) as date,
            SUM(profit_loss_pips) as daily_pips
          FROM signal_history_deduped
          WHERE outcome != 'PENDING'
            AND trade_live = true
            AND tier = 'HIGH'
            ${dateFilter}
            ${strategyVersionFilter}
            ${dataQualitySQL}
          GROUP BY DATE(outcome_time)
          ORDER BY date ASC
        )
        SELECT
          date,
          daily_pips,
          SUM(daily_pips) OVER (ORDER BY date ASC) as cumulative_pips
        FROM daily_profits
      `);

      // 3. FXIFY Monthly comparison
      const fxifyMonthlyResult = await db.execute(sql`
        SELECT
          DATE_TRUNC('month', outcome_time) as month,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          AND trade_live = true
          AND tier = 'HIGH'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
        GROUP BY DATE_TRUNC('month', outcome_time)
        ORDER BY month DESC
        LIMIT 12
      `);

      // 4. FXIFY Symbol performance
      const fxifySymbolResult = await db.execute(sql`
        SELECT
          symbol,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          AND trade_live = true
          AND tier = 'HIGH'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
        GROUP BY symbol
        ORDER BY profit_pips DESC
      `);

      // 5. Calculate FXIFY metrics
      const fxifyTotalTrades = parseInt(fxifyOverall.wins) + parseInt(fxifyOverall.losses);
      const fxifyWinRate = parseFloat(fxifyOverall.win_rate) || 0;
      const fxifyAvgWinPips = parseFloat(fxifyOverall.avg_win_pips) || 0;
      const fxifyAvgLossPips = parseFloat(fxifyOverall.avg_loss_pips) || 0;

      const fxifyTotalWinPips = parseInt(fxifyOverall.wins) * fxifyAvgWinPips;
      const fxifyTotalLossPips = parseInt(fxifyOverall.losses) * fxifyAvgLossPips;
      const fxifyProfitFactor = fxifyTotalLossPips > 0 ? fxifyTotalWinPips / fxifyTotalLossPips : 0;

      // Real Sharpe: mean / sd of per-trade pips. The previous version was `mean / 100` with
      // no variance term and was clamped to 0 whenever the mean was negative, so it could never
      // report a losing system as losing. Allowed to be negative now, because it usually is.
      const fxifyAvgProfitPerTrade = fxifyTotalTrades > 0
        ? parseFloat(fxifyOverall.total_profit_pips) / fxifyTotalTrades : 0;
      const fxifySdPips = parseFloat(fxifyOverall.sd_pips) || 0;
      const fxifySharpeRatio = fxifySdPips > 0 ? fxifyAvgProfitPerTrade / fxifySdPips : 0;

      // FXIFY Max Drawdown
      let fxifyPeak = 0;
      let fxifyMaxDrawdown = 0;

      for (const point of fxifyCumulativeProfitResult as any[]) {
        const current = parseFloat(point.cumulative_pips);
        if (current > fxifyPeak) {
          fxifyPeak = current;
        }
        const drawdown = fxifyPeak - current;
        if (drawdown > fxifyMaxDrawdown) {
          fxifyMaxDrawdown = drawdown;
        }
      }

      // ============================================================
      // ALL SIGNALS PERFORMANCE (HIGH + MEDIUM tier)
      // ============================================================

      // 1. All signals overall metrics
      const allOverallResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COALESCE(SUM(profit_loss_pips), 0) as total_profit_pips,
          COALESCE(AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')), 0) as avg_win_pips,
          COALESCE(AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'), 0) as avg_loss_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          ROUND(AVG(EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600)::numeric, 1) as avg_hold_hours,
          ROUND(MAX(profit_loss_pips)::numeric, 1) as best_trade_pips,
          ROUND(MIN(profit_loss_pips)::numeric, 1) as worst_trade_pips,
          ROUND(STDDEV_SAMP(profit_loss_pips)::numeric, 4) as sd_pips,
          COUNT(*) FILTER (WHERE type = 'LONG') as longs,
          COUNT(*) FILTER (WHERE type = 'SHORT') as shorts,
          COUNT(*) FILTER (WHERE type = 'LONG'  AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as long_wins,
          COUNT(*) FILTER (WHERE type = 'SHORT' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as short_wins
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
      `);

      const allOverall = (allOverallResult as any)[0];

      // 2. All signals cumulative profit
      const allCumulativeProfitResult = await db.execute(sql`
        WITH daily_profits AS (
          SELECT
            DATE(outcome_time) as date,
            SUM(profit_loss_pips) as daily_pips
          FROM signal_history_deduped
          WHERE outcome != 'PENDING'
            ${dateFilter}
            ${strategyVersionFilter}
            ${dataQualitySQL}
          GROUP BY DATE(outcome_time)
          ORDER BY date ASC
        )
        SELECT
          date,
          daily_pips,
          SUM(daily_pips) OVER (ORDER BY date ASC) as cumulative_pips
        FROM daily_profits
      `);

      // 3. All signals monthly comparison
      const allMonthlyResult = await db.execute(sql`
        SELECT
          DATE_TRUNC('month', outcome_time) as month,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
        GROUP BY DATE_TRUNC('month', outcome_time)
        ORDER BY month DESC
        LIMIT 12
      `);

      // 4. All signals symbol performance
      const allSymbolResult = await db.execute(sql`
        SELECT
          symbol,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
          ${strategyVersionFilter}
          ${dataQualitySQL}
        GROUP BY symbol
        ORDER BY profit_pips DESC
      `);

      // 5. Calculate All signals metrics
      const allTotalTrades = parseInt(allOverall.wins) + parseInt(allOverall.losses);
      const allWinRate = parseFloat(allOverall.win_rate) || 0;
      const allAvgWinPips = parseFloat(allOverall.avg_win_pips) || 0;
      const allAvgLossPips = parseFloat(allOverall.avg_loss_pips) || 0;

      const allTotalWinPips = parseInt(allOverall.wins) * allAvgWinPips;
      const allTotalLossPips = parseInt(allOverall.losses) * allAvgLossPips;
      const allProfitFactor = allTotalLossPips > 0 ? allTotalWinPips / allTotalLossPips : 0;

      // Real Sharpe: mean / sd of per-trade pips. The previous version was `mean / 100` with
      // no variance term and was clamped to 0 whenever the mean was negative, so it could never
      // report a losing system as losing. Allowed to be negative now, because it usually is.
      const allAvgProfitPerTrade = allTotalTrades > 0
        ? parseFloat(allOverall.total_profit_pips) / allTotalTrades : 0;
      const allSdPips = parseFloat(allOverall.sd_pips) || 0;
      const allSharpeRatio = allSdPips > 0 ? allAvgProfitPerTrade / allSdPips : 0;

      // All signals max drawdown
      let allPeak = 0;
      let allMaxDrawdown = 0;

      for (const point of allCumulativeProfitResult as any[]) {
        const current = parseFloat(point.cumulative_pips);
        if (current > allPeak) {
          allPeak = current;
        }
        const drawdown = allPeak - current;
        if (drawdown > allMaxDrawdown) {
          allMaxDrawdown = drawdown;
        }
      }

      // ============================================================
      // COMPARISON METRICS
      // ============================================================
      const signalCountDiff = parseInt(allOverall.total_signals) - parseInt(fxifyOverall.total_signals);
      const winRateDiff = fxifyWinRate - allWinRate;
      const profitDiff = parseFloat(fxifyOverall.total_profit_pips) - parseFloat(allOverall.total_profit_pips);

      // Reconciliation status, open exposure and the live risk configuration.
      //
      // Global, not per-arm: they describe the record and the system, not a filtered slice.
      // This panel exists because the dashboard has twice reported untrue numbers - fabricated
      // winning trades served as real, and a corrected outcome column no route read. The reader
      // is now told how much of the record was re-derived from candles and how much of it
      // DISAGREED with what the system originally recorded.
      const integrityResult = await db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(corrected_outcome) as reconciled,
          COUNT(*) FILTER (WHERE corrected_outcome IS NOT NULL
                             AND corrected_outcome <> raw_outcome) as disagreed,
          COUNT(*) FILTER (WHERE requires_approval) as escalated,
          MAX(last_validated_at) as last_validated_at
        FROM signal_history_deduped
      `);
      const integ = (integrityResult as any)[0];

      // Realised and unrealised are never summed. Every figure in the arms above is REALISED.
      const openResult = await db.execute(sql`
        SELECT COUNT(*) as pending, MIN(created_at) as oldest_pending_at
        FROM signal_history_deduped WHERE outcome = 'PENDING'
      `);
      const openRow = (openResult as any)[0];

      // Read from the service rather than restated, so this cannot drift from the live config.
      const propConfig = propFirmService.getConfig();
      const reconciledCount = parseInt(integ.reconciled) || 0;
      const disagreedCount = parseInt(integ.disagreed) || 0;

      res.json({
        integrity: {
          totalRows: parseInt(integ.total) || 0,
          reconciled: reconciledCount,
          disagreed: disagreedCount,
          disagreementPct: reconciledCount > 0
            ? parseFloat((100 * disagreedCount / reconciledCount).toFixed(1))
            : 0,
          escalated: parseInt(integ.escalated) || 0,
          lastValidatedAt: integ.last_validated_at,
          note: 'Outcomes re-derived from 5-minute candles. "disagreed" is how many differed '
              + 'from what the system originally recorded.',
        },
        open: {
          pending: parseInt(openRow.pending) || 0,
          oldestPendingAt: openRow.oldest_pending_at,
          note: 'Unrealised. Never combined with the realised figures.',
        },
        riskConfig: {
          maxTradesPerDay: propConfig.maxTradesPerDay,
          riskPerTradePercent: propConfig.riskPerTrade,
          positionSizeHighPercent: propFirmService.getPositionSize('HIGH'),
          positionSizeMediumPercent: propFirmService.getPositionSize('MEDIUM'),
          signalCooldownMinutes: 240,
          highTierConfidence: 90,
          confidenceScaleMax: 130,
          maxEffectiveExposure: MAX_EFFECTIVE_EXPOSURE,
          correlationControlNote: 'Effective exposure counts the candidate as 1.0 and adds '
              + 'direction x direction x measured correlation for every open position, so a '
              + 'signal that compounds an existing bet is held for approval rather than '
              + 'auto-executed. Correlations are measured from ~24,573 aligned hourly returns '
              + '(2022-2026): EUR/USD vs GBP/USD +0.78 is the strongest pairing, and EUR/USD vs '
              + 'USD/CHF is -0.75, where OPPOSITE directions are the same bet twice.',
        },
        fxifyOnly: {
          overall: {
            totalSignals: parseInt(fxifyOverall.total_signals),
            wins: parseInt(fxifyOverall.wins),
            losses: parseInt(fxifyOverall.losses),
            totalProfitPips: parseFloat(fxifyOverall.total_profit_pips),
            winRate: fxifyWinRate,
            avgWinPips: fxifyAvgWinPips,
            avgLossPips: fxifyAvgLossPips,
            profitFactor: parseFloat(fxifyProfitFactor.toFixed(2)),
            sharpeRatio: parseFloat(fxifySharpeRatio.toFixed(4)),
            sharpeNote: 'mean / sd of per-trade pips. Negative is a real value, not an error.',
            sdPips: parseFloat(fxifySdPips.toFixed(2)),
            maxDrawdown: parseFloat(fxifyMaxDrawdown.toFixed(2)),
            avgHoldHours: parseFloat(fxifyOverall.avg_hold_hours) || 0,
            bestTradePips: parseFloat(fxifyOverall.best_trade_pips) || 0,
            worstTradePips: parseFloat(fxifyOverall.worst_trade_pips) || 0,
            longs: parseInt(fxifyOverall.longs) || 0,
            shorts: parseInt(fxifyOverall.shorts) || 0,
            longWinRate: parseInt(fxifyOverall.longs) > 0
              ? parseFloat((100 * parseInt(fxifyOverall.long_wins) / parseInt(fxifyOverall.longs)).toFixed(1))
              : 0,
            shortWinRate: parseInt(fxifyOverall.shorts) > 0
              ? parseFloat((100 * parseInt(fxifyOverall.short_wins) / parseInt(fxifyOverall.shorts)).toFixed(1))
              : 0,
          },
          cumulativeProfit: fxifyCumulativeProfitResult as any[],
          monthlyComparison: fxifyMonthlyResult as any[],
          symbolPerformance: fxifySymbolResult as any[],
        },
        allSignals: {
          overall: {
            totalSignals: parseInt(allOverall.total_signals),
            wins: parseInt(allOverall.wins),
            losses: parseInt(allOverall.losses),
            totalProfitPips: parseFloat(allOverall.total_profit_pips),
            winRate: allWinRate,
            avgWinPips: allAvgWinPips,
            avgLossPips: allAvgLossPips,
            profitFactor: parseFloat(allProfitFactor.toFixed(2)),
            sharpeRatio: parseFloat(allSharpeRatio.toFixed(4)),
            sharpeNote: 'mean / sd of per-trade pips. Negative is a real value, not an error.',
            sdPips: parseFloat(allSdPips.toFixed(2)),
            maxDrawdown: parseFloat(allMaxDrawdown.toFixed(2)),
            avgHoldHours: parseFloat(allOverall.avg_hold_hours) || 0,
            bestTradePips: parseFloat(allOverall.best_trade_pips) || 0,
            worstTradePips: parseFloat(allOverall.worst_trade_pips) || 0,
            longs: parseInt(allOverall.longs) || 0,
            shorts: parseInt(allOverall.shorts) || 0,
            longWinRate: parseInt(allOverall.longs) > 0
              ? parseFloat((100 * parseInt(allOverall.long_wins) / parseInt(allOverall.longs)).toFixed(1))
              : 0,
            shortWinRate: parseInt(allOverall.shorts) > 0
              ? parseFloat((100 * parseInt(allOverall.short_wins) / parseInt(allOverall.shorts)).toFixed(1))
              : 0,
          },
          cumulativeProfit: allCumulativeProfitResult as any[],
          monthlyComparison: allMonthlyResult as any[],
          symbolPerformance: allSymbolResult as any[],
        },
        comparison: {
          signalCountDiff,
          winRateDiff: parseFloat(winRateDiff.toFixed(2)),
          profitDiff: parseFloat(profitDiff.toFixed(2)),
        },
        timeframe: days === 0 ? 'All Time' : `Last ${days} days`,
      });
    } catch (error: any) {
      console.error('Error fetching dual growth stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/growth-stats
   * Returns growth tracking metrics and profitability data
   * Query params:
   * - days: filter by days (7, 30, 90, or 0 for all time - default 0)
   */
  app.get("/api/admin/growth-stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 0; // 0 = all time

      // Build date filter
      const dateFilter = days > 0
        ? sql`AND outcome_time >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
        : sql``;

      // 1. Overall metrics
      const overallResult = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          COALESCE(SUM(profit_loss_pips), 0) as total_profit_pips,
          COALESCE(AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')), 0) as avg_win_pips,
          COALESCE(AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'), 0) as avg_loss_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate,
          -- Phase 1 additions. Hold time is measured, not assumed: it is the single number
          -- that says whether this is an intraday system or a swing system.
          ROUND(AVG(EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600)::numeric, 1) as avg_hold_hours,
          ROUND(MAX(profit_loss_pips)::numeric, 1) as best_trade_pips,
          ROUND(MIN(profit_loss_pips)::numeric, 1) as worst_trade_pips,
          -- Needed for a REAL Sharpe. The previous one had no variance term at all.
          ROUND(STDDEV_SAMP(profit_loss_pips)::numeric, 4) as sd_pips,
          COUNT(*) FILTER (WHERE type = 'LONG') as longs,
          COUNT(*) FILTER (WHERE type = 'SHORT') as shorts,
          COUNT(*) FILTER (WHERE type = 'LONG'  AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as long_wins,
          COUNT(*) FILTER (WHERE type = 'SHORT' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as short_wins
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
      `);

      const overall = (overallResult as any)[0];

      // 2. Cumulative profit over time (daily aggregation)
      const cumulativeProfitResult = await db.execute(sql`
        WITH daily_profits AS (
          SELECT
            DATE(outcome_time) as date,
            SUM(profit_loss_pips) as daily_pips
          FROM signal_history_deduped
          WHERE outcome != 'PENDING'
            ${dateFilter}
          GROUP BY DATE(outcome_time)
          ORDER BY date ASC
        )
        SELECT
          date,
          daily_pips,
          SUM(daily_pips) OVER (ORDER BY date ASC) as cumulative_pips
        FROM daily_profits
      `);

      // 3. Monthly comparison
      const monthlyResult = await db.execute(sql`
        SELECT
          DATE_TRUNC('month', outcome_time) as month,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
        GROUP BY DATE_TRUNC('month', outcome_time)
        ORDER BY month DESC
        LIMIT 12
      `);

      // 4. Symbol performance comparison
      const symbolResult = await db.execute(sql`
        SELECT
          symbol,
          COUNT(*) as total_signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COALESCE(SUM(profit_loss_pips), 0) as profit_pips,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT', 'STOP_HIT')), 0),
            2
          ) as win_rate
        FROM signal_history_deduped
        WHERE outcome != 'PENDING'
          ${dateFilter}
        GROUP BY symbol
        ORDER BY profit_pips DESC
      `);

      // 5. Calculate key metrics
      const totalTrades = parseInt(overall.wins) + parseInt(overall.losses);
      const winRate = parseFloat(overall.win_rate) || 0;
      const avgWinPips = parseFloat(overall.avg_win_pips) || 0;
      const avgLossPips = parseFloat(overall.avg_loss_pips) || 0;

      // Profit Factor = (Wins * AvgWin) / (Losses * AvgLoss)
      const totalWinPips = parseInt(overall.wins) * avgWinPips;
      const totalLossPips = parseInt(overall.losses) * avgLossPips;
      const profitFactor = totalLossPips > 0 ? totalWinPips / totalLossPips : 0;

      // Sharpe ratio, per trade.
      //
      // The previous implementation was `avgProfitPerTrade / 100` and returned 0 whenever the
      // mean was negative. It contained NO standard deviation, so it was not a Sharpe ratio in
      // any sense - it was mean pips with a decimal moved, on a page whose entire purpose is
      // honest measurement. Replaced with the actual definition: mean / sd of per-trade pips.
      // It is deliberately allowed to be negative, because it usually is.
      const avgProfitPerTrade = totalTrades > 0 ? parseFloat(overall.total_profit_pips) / totalTrades : 0;
      const sdPips = parseFloat(overall.sd_pips) || 0;
      const sharpeRatio = sdPips > 0 ? avgProfitPerTrade / sdPips : 0;

      // Max Drawdown (proper peak-to-trough calculation)
      let peak = 0;
      let maxDrawdown = 0;

      for (const point of cumulativeProfitResult as any[]) {
        const current = parseFloat(point.cumulative_pips);

        if (current > peak) {
          peak = current;
        }

        const drawdown = peak - current;

        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }

      // 6. Reconciliation status.
      //
      // This dashboard has reported untrue numbers twice: fabricated winning trades served as
      // real, and a corrected outcome column that no route read. So the reader is now told how
      // much of the record has been re-derived from candle data and how much of it DISAGREED
      // with what the system originally recorded. A silent correction is still a correction the
      // reader cannot audit.
      const integrityResult = await db.execute(sql`
        SELECT
          COUNT(*) as total,
          COUNT(corrected_outcome) as reconciled,
          COUNT(*) FILTER (WHERE corrected_outcome IS NOT NULL
                             AND corrected_outcome <> raw_outcome) as disagreed,
          COUNT(*) FILTER (WHERE requires_approval) as escalated,
          MAX(last_validated_at) as last_validated_at
        FROM signal_history_deduped
      `);
      const integ = (integrityResult as any)[0];

      // 7. Open exposure - realised and unrealised must never be added together.
      // Every figure below this point is REALISED (outcome != 'PENDING').
      const openResult = await db.execute(sql`
        SELECT COUNT(*) as pending, MIN(created_at) as oldest_pending_at
        FROM signal_history_deduped WHERE outcome = 'PENDING'
      `);
      const open = (openResult as any)[0];

      // 8. The live risk configuration, read from the service rather than restated here, so
      // this panel cannot drift away from what the system is actually doing.
      const propConfig = propFirmService.getConfig();

      const reconciledCount = parseInt(integ.reconciled) || 0;
      const disagreedCount = parseInt(integ.disagreed) || 0;

      res.json({
        integrity: {
          totalRows: parseInt(integ.total) || 0,
          reconciled: reconciledCount,
          disagreed: disagreedCount,
          disagreementPct: reconciledCount > 0
            ? parseFloat((100 * disagreedCount / reconciledCount).toFixed(1))
            : 0,
          escalated: parseInt(integ.escalated) || 0,
          lastValidatedAt: integ.last_validated_at,
          note: 'Outcomes re-derived from 5-minute candles. "disagreed" is how many differed '
              + 'from what the system originally recorded.',
        },
        open: {
          pending: parseInt(open.pending) || 0,
          oldestPendingAt: open.oldest_pending_at,
          note: 'Unrealised. Never combined with the realised figures.',
        },
        riskConfig: {
          maxTradesPerDay: propConfig.maxTradesPerDay,
          riskPerTradePercent: propConfig.riskPerTrade,
          positionSizeHighPercent: propFirmService.getPositionSize('HIGH'),
          positionSizeMediumPercent: propFirmService.getPositionSize('MEDIUM'),
          signalCooldownMinutes: 240,
          highTierConfidence: 90,
          confidenceScaleMax: 130,
          maxEffectiveExposure: MAX_EFFECTIVE_EXPOSURE,
          correlationControlNote: 'Effective exposure counts the candidate as 1.0 and adds '
              + 'direction x direction x measured correlation for every open position, so a '
              + 'signal that compounds an existing bet is held for approval rather than '
              + 'auto-executed. Correlations are measured from ~24,573 aligned hourly returns '
              + '(2022-2026): EUR/USD vs GBP/USD +0.78 is the strongest pairing, and EUR/USD vs '
              + 'USD/CHF is -0.75, where OPPOSITE directions are the same bet twice.',
        },
        overall: {
          totalSignals: parseInt(overall.total_signals),
          wins: parseInt(overall.wins),
          losses: parseInt(overall.losses),
          totalProfitPips: parseFloat(overall.total_profit_pips),
          winRate,
          avgWinPips,
          avgLossPips,
          profitFactor: parseFloat(profitFactor.toFixed(2)),
          sharpeRatio: parseFloat(sharpeRatio.toFixed(4)),
          sharpeNote: 'mean / sd of per-trade pips. Negative is a real value, not an error.',
          sdPips: parseFloat(sdPips.toFixed(2)),
          maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
          avgHoldHours: parseFloat(overall.avg_hold_hours) || 0,
          bestTradePips: parseFloat(overall.best_trade_pips) || 0,
          worstTradePips: parseFloat(overall.worst_trade_pips) || 0,
          longs: parseInt(overall.longs) || 0,
          shorts: parseInt(overall.shorts) || 0,
          longWinRate: parseInt(overall.longs) > 0
            ? parseFloat((100 * parseInt(overall.long_wins) / parseInt(overall.longs)).toFixed(1))
            : 0,
          shortWinRate: parseInt(overall.shorts) > 0
            ? parseFloat((100 * parseInt(overall.short_wins) / parseInt(overall.shorts)).toFixed(1))
            : 0,
        },
        cumulativeProfit: cumulativeProfitResult as any[],
        monthlyComparison: monthlyResult as any[],
        symbolPerformance: symbolResult as any[],
        timeframe: days === 0 ? 'All Time' : `Last ${days} days`,
      });
    } catch (error: any) {
      console.error('Error fetching growth stats:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/diagnose-fxify-losses
   * Diagnostic endpoint to analyze FXIFY losses
   */
  app.get("/api/admin/diagnose-fxify-losses", requireAuth, requireAdmin, async (req, res) => {
    try {
      console.log('🔍 Running FXIFY diagnostic...');
      // Query 1: Monthly Performance
      const monthlyResults = await db.execute(sql`
        SELECT
          DATE_TRUNC('month', outcome_time) as month,
          COUNT(*) as signals,
          ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
          ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
          ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
        FROM signal_history_deduped
        WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
        GROUP BY DATE_TRUNC('month', outcome_time)
        ORDER BY month DESC
        LIMIT 12
      `);

      // Query 2: Symbol Performance
      const symbolResults = await db.execute(sql`
        SELECT
          symbol,
          COUNT(*) as signals,
          ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
          ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
          ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
        FROM signal_history_deduped
        WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
        GROUP BY symbol
        ORDER BY total_pips ASC
      `);

      // Query 3: Strategy Version Performance
      const versionResults = await db.execute(sql`
        SELECT
          strategy_version,
          COUNT(*) as signals,
          ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
          ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
          ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate
        FROM signal_history_deduped
        WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
        GROUP BY strategy_version
        ORDER BY total_pips ASC
      `);

      // Query 4: Recent Signals Sample
      const recentSignals = await db.execute(sql`
        SELECT
          symbol,
          type as signal_type,
          confidence,
          outcome,
          profit_loss_pips,
          strategy_version,
          outcome_time
        FROM signal_history_deduped
        WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
        ORDER BY outcome_time DESC
        LIMIT 50
      `);

      // Query 5: Overall Summary
      const summary = await db.execute(sql`
        SELECT
          COUNT(*) as total_signals,
          ROUND(AVG(confidence)::numeric, 2) as avg_confidence,
          ROUND(MIN(profit_loss_pips)::numeric, 2) as min_pips,
          ROUND(MAX(profit_loss_pips)::numeric, 2) as max_pips,
          ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
          ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
          ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*) FILTER (WHERE outcome != 'PENDING'), 0), 2) as win_rate,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses
        FROM signal_history_deduped
        WHERE trade_live = true AND tier = 'HIGH' AND outcome != 'PENDING'
      `);

      // Query 6: Pending v2.2.0 Signals (Phase 2 & 3 tracking)
      const pendingV220 = await db.execute(sql`
        SELECT
          COUNT(*) as count,
          MIN(created_at) as first_signal,
          MAX(created_at) as latest_signal
        FROM signal_history_deduped
        WHERE strategy_version = '2.2.0'
          AND outcome = 'PENDING'
          AND trade_live = true
          AND tier = 'HIGH'
      `);

      // Query 7: Post-Nov4 Completed Signals (date-based Phase 2 & 3 results)
      const postFixResults = await db.execute(sql`
        SELECT
          COUNT(*) as signals,
          COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) as wins,
          COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
          ROUND(SUM(profit_loss_pips)::numeric, 2) as total_pips,
          ROUND(AVG(profit_loss_pips)::numeric, 2) as avg_pips,
          ROUND(100.0 * COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT', 'TP2_HIT', 'TP3_HIT')) /
            NULLIF(COUNT(*), 0), 2) as win_rate,
          MIN(outcome_time) as first_completion,
          MAX(outcome_time) as latest_completion
        FROM signal_history_deduped
        WHERE created_at >= '2025-11-04 05:44:16 UTC'
          AND outcome != 'PENDING'
          AND trade_live = true
          AND tier = 'HIGH'
      `);

      const v220Data = (pendingV220 as any[])[0];
      const postFixData = (postFixResults as any[])[0];

      res.json({
        monthly: monthlyResults,
        bySymbol: symbolResults,
        byVersion: versionResults,
        recentSignals: recentSignals,
        summary: (summary as any)[0],
        pendingV220: {
          count: v220Data?.count || 0,
          firstSignal: v220Data?.first_signal,
          latestSignal: v220Data?.latest_signal,
        },
        postNov4: {
          signals: postFixData?.signals || 0,
          wins: postFixData?.wins || 0,
          losses: postFixData?.losses || 0,
          totalPips: postFixData?.total_pips || 0,
          avgPips: postFixData?.avg_pips || 0,
          winRate: postFixData?.win_rate || 0,
          firstCompletion: postFixData?.first_completion,
          latestCompletion: postFixData?.latest_completion,
        },
      });
    } catch (error: any) {
      console.error('❌ Error in diagnose-fxify-losses:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        error: error.message,
        details: error.toString(),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });
}

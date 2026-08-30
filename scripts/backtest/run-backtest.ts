/**
 * Phase A — the chronological replay loop.
 *
 * Walks time forward once, applying production's four gates in production's order, and calls the
 * REAL analyze() at each surviving decision point. Nothing about the strategy is reimplemented
 * here; if it were, the backtest would measure a different system than the one that trades.
 *
 * WHY TRADES RESOLVE THE MOMENT THEY OPEN
 * ---------------------------------------
 * The cooldown's real clause is `outcome = 'PENDING' OR created_at > NOW() - 240min`, so a
 * symbol is blocked until its trade RESOLVES. Rather than re-scanning open trades at every later
 * decision point (quadratic), each trade is resolved forward as soon as it is opened and its
 * close time recorded; the symbol is then blocked until that time.
 *
 * That is not look-ahead. The entry decision is already final when resolution runs — the outcome
 * never feeds back into whether to enter. It only answers "when does this symbol free up?",
 * which is the same question production answers with the validator.
 *
 * It IS optimistic in one respect, and that is declared: production only unblocks when the
 * THROTTLED validator gets round to marking the row, which is later than the true touch. The
 * design note calls for running both extremes; `cooldownMode` exists for that.
 *
 * SLICING
 * -------
 * aggregate.ts stamps every bar with its TRUE OPEN, so the label-vs-open skew that
 * candle-slicer's inferOpenSkewMs exists to recover is zero here by construction. This file
 * therefore uses its own slicer: same semantics, no inference, and no O(n^2) rescan of a 24k-bar
 * series at each of ~30k decision points.
 *
 * USAGE:
 *   npx tsx scripts/backtest/run-backtest.ts --from=2024-08-01 --to=2026-08-01
 *   npx tsx scripts/backtest/run-backtest.ts --from=2026-05-01 --to=2026-08-01 --pairs=EUR/USD,USD/CHF
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { MACrossoverStrategy } from '../../server/services/signal-generator';
import { buildTimeframes, tradingDay, type Ohlc } from './aggregate';
import { PRODUCTION_SIZES, lastN, type Bar } from './candle-slicer';
import {
  isMarketOpen, isInKillZone, resolveTrade, costTrade, pipSize,
  DEFAULT_CONFIG, type EngineConfig, type Trade,
} from './engine';
import { randomArm, trendOnlyArm, makeRng, summarise, type ArmName } from './control-arms';

/** Production's own array order. Gate 3 is order-dependent — do NOT sort this. */
const PRODUCTION_ORDER = ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD'];
const CACHE_DIR = path.resolve('.backtest-cache');

/** A fill more than one cron interval after the decision means the data had a hole. */
const MAX_FILL_LAG_MIN = 15;
/** Analysing on a slice older than this is analysing a different moment than the one claimed. */
const MAX_STALE_MIN = 60;

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;

/** Index of the last bar with timestamp <= t, or -1. Binary search: called millions of times. */
function lastIndexAtOrBefore(bars: Ohlc[], t: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp.getTime() <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/**
 * The series as it stood at `asOf`: every fully-closed bar, plus the in-progress bar rebuilt
 * from 5-minute data so it contains only what had happened by then.
 */
function sliceTrueOpen(bars: Ohlc[], asOf: Date, m5: Ohlc[], n: number): Bar[] {
  const t = asOf.getTime();
  const i = lastIndexAtOrBefore(bars, t);
  if (i < 0) return [];

  const closed = bars.slice(Math.max(0, i - n), i);      // bars[i] is the one still forming
  const start = bars[i].timestamp.getTime();

  let lo = lastIndexAtOrBefore(m5, start - 1) + 1;
  const hi = lastIndexAtOrBefore(m5, t - 1);
  if (hi >= lo) {
    let high = -Infinity, low = Infinity;
    for (let k = lo; k <= hi; k++) { if (m5[k].high > high) high = m5[k].high; if (m5[k].low < low) low = m5[k].low; }
    closed.push({ timestamp: bars[i].timestamp, open: m5[lo].open, high, low, close: m5[hi].close, volume: 0 });
  }
  return lastN(closed, n) as unknown as Bar[];
}

interface PairData { m5: Ohlc[]; h1: Ohlc[]; h4: Ohlc[]; d1: Ohlc[]; w1: Ohlc[] }

function loadPair(symbol: string, from: string, to: string): PairData | null {
  const f = path.join(CACHE_DIR, `duka-${symbol.replace('/', '')}-m5-${from}-${to}.json`);
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const m5: Ohlc[] = raw.map((b: any) => ({
    timestamp: new Date(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0,
  }));
  return buildTimeframes(m5) as PairData;
}

export interface BacktestResult {
  trades: Trade[];
  unresolved: number;
  decisionPoints: number;
  analyzeCalls: number;
  blocked: { cooldown: number; dailyCap: number; belowThreshold: number; noSignal: number; staleData: number; staleFill: number };
}

/**
 * `arm` selects what produces signals. Everything else — gates, cooldown, daily cap, fill, costs,
 * resolution — is held IDENTICAL across arms, which is the only way the comparison means
 * anything. A control arm that got easier gates would not be a control.
 */
export async function runBacktest(
  pairs: string[], from: string, to: string, windowFrom: Date, windowTo: Date, cfg: EngineConfig,
  arm: 'strategy' | ArmName = 'strategy', seed = 20260829
): Promise<BacktestResult> {
  const data: Record<string, PairData> = {};
  for (const p of pairs) {
    const d = loadPair(p, from, to);
    if (!d) { console.log(`  (no data file for ${p} — skipped)`); continue; }
    data[p] = d;
  }
  const active = PRODUCTION_ORDER.filter(p => data[p]);
  if (!active.length) throw new Error('no pair data loaded');

  // Decision points: every 1H bar open, deduplicated across pairs, that survives gates 1 and 2.
  const stamps = new Set<number>();
  for (const p of active) for (const b of data[p].h1) {
    const t = b.timestamp;
    if (t < windowFrom || t > windowTo) continue;
    if (!isMarketOpen(t) || !isInKillZone(t)) continue;
    stamps.add(t.getTime());
  }
  const decisionPoints = [...stamps].sort((a, b) => a - b);

  const strat = new MACrossoverStrategy();
  const trades: Trade[] = [];
  const blockedUntil: Record<string, number> = {};   // symbol -> ms; PENDING-or-cooldown
  const perDay: Record<number, number> = {};
  const blocked = { cooldown: 0, dailyCap: 0, belowThreshold: 0, noSignal: 0, staleData: 0, staleFill: 0 };
  let analyzeCalls = 0, unresolved = 0;
  const rng = makeRng(seed);

  for (const ms of decisionPoints) {
    const now = new Date(ms);

    // Gate 3 — PORTFOLIO-WIDE, evaluated once before the symbol loop, exactly as production does.
    const day = tradingDay(now);
    if ((perDay[day] ?? 0) >= cfg.maxTradesPerDay) { blocked.dailyCap++; continue; }

    for (const symbol of active) {
      if ((perDay[day] ?? 0) >= cfg.maxTradesPerDay) break;   // a slot may be taken mid-loop
      const d = data[symbol];

      if ((blockedUntil[symbol] ?? 0) > ms) { blocked.cooldown++; continue; }

      // A pair can have a multi-hour Dukascopy hole while others trade on. decisionPoints is the
      // UNION across pairs, so without this guard the pair with the hole is analysed on a stale
      // slice — measured up to 38h old on AUD/USD — with no warning at all.
      const freshIdx = lastIndexAtOrBefore(d.m5, ms - 1);
      if (freshIdx < 0 || (ms - +d.m5[freshIdx].timestamp) > MAX_STALE_MIN * 60_000) {
        blocked.staleData++;
        continue;
      }

      const wk = sliceTrueOpen(d.w1, now, d.m5, PRODUCTION_SIZES.weekly);
      const dy = sliceTrueOpen(d.d1, now, d.m5, PRODUCTION_SIZES.daily);
      const h4 = sliceTrueOpen(d.h4, now, d.m5, PRODUCTION_SIZES.fourHour);
      const h1 = sliceTrueOpen(d.h1, now, d.m5, PRODUCTION_SIZES.oneHour);

      // Only the SIGNAL SOURCE varies between arms. Gates, cooldown, cap, fill, costs and
      // resolution are identical, or the comparison would measure the harness, not the edge.
      let sig: any = null;
      if (arm === 'strategy') {
        sig = await strat.analyze(wk, dy, h4, h1, symbol, { asOf: now, approvedParams: null });
      } else {
        const a = arm === 'random'
          ? randomArm(h1 as any, rng)
          : trendOnlyArm(dy as any, h4 as any, h1 as any);
        if (a) {
          const px = (h1[h1.length - 1] as any).close;
          sig = {
            type: a.type, confidence: a.confidence, tier: a.tier, entry: px,
            stop: a.type === 'LONG' ? px - a.stopDist : px + a.stopDist,
            targets: [a.type === 'LONG' ? px + a.targetDist : px - a.targetDist],
          };
        }
      }
      analyzeCalls++;
      // Gate 4 (confidence >= 70) is enforced INSIDE analyze(), which returns null below the
      // threshold. So a null here means "no entry OR below 70" and the two cannot be separated
      // from the outside. Kept as a defensive check rather than a counter that can never fire.
      if (!sig) { blocked.noSignal++; continue; }
      // Gate 4 applies to the strategy only. Control arms carry confidence 0 by construction and
      // must not be filtered by a threshold they were never scored against.
      if (arm === 'strategy' && sig.confidence < 70) { blocked.belowThreshold++; continue; }

      // --- fill: next bar's open + half spread (§6) ---
      //
      // `ms` is a 1H boundary and an m5 bar opens exactly on it, so lastIndexAtOrBefore(ms)
      // returns THAT bar and +1 landed on the SECOND bar of the hour — a fill 5 minutes later
      // than the documented model. Using ms-1 selects the first bar opening at or after ms.
      // Not look-ahead: sliceTrueOpen cuts inputs at ms-1, so the decision never saw this bar.
      // Measured cost of the old behaviour: 0.0191 R, and 13x larger for the strategy than for
      // the random arm — it was discarding short-lived directional information.
      const fi = lastIndexAtOrBefore(d.m5, ms - 1) + 1;
      if (fi >= d.m5.length) continue;

      // BUG 2/3 — a data hole can place the fill long after the decision, on a different
      // trading day and outside the kill zone. Production cannot do that: it re-decides on the
      // next cron tick. Four such trades existed, opening at 00:00 UTC with meanR +1.215, which
      // both breached the 3/day cap (perDay is keyed on the DECISION day) and smuggled
      // out-of-session trades into the result.
      const fillAt = d.m5[fi].timestamp;
      const fillLagMin = (+fillAt - ms) / 60_000;
      if (fillLagMin > MAX_FILL_LAG_MIN || tradingDay(fillAt) !== day || !isInKillZone(fillAt)) {
        blocked.staleFill++;
        continue;
      }
      const pip = pipSize(symbol);
      const half = ((cfg.spreadPips[symbol] ?? 1.5) / 2) * pip;
      const isLong = sig.type === 'LONG';
      const fill = d.m5[fi].open + (isLong ? half : -half);

      // Stop/target as DISTANCES from the quoted entry, re-anchored to the actual fill.
      const stopDist = Math.abs(sig.entry - sig.stop);
      const tgtDist = Math.abs(sig.targets[0] - sig.entry);

      const trade: Trade = {
        symbol, type: sig.type, openedAt: d.m5[fi].timestamp, entry: fill,
        stop: isLong ? fill - stopDist : fill + stopDist,
        target: isLong ? fill + tgtDist : fill - tgtDist,
        confidence: sig.confidence, tier: sig.tier,
      };

      const expiry = new Date(+trade.openedAt + cfg.expiryHours * 3600_000);
      const r = resolveTrade(trade, d.m5.slice(fi), expiry);
      if (r) {
        trade.closedAt = r.at; trade.outcome = r.outcome; trade.exitPrice = r.price;
        trade.mfeR = r.mfeR; trade.maeR = r.maeR;
        costTrade(trade, cfg);
      } else {
        unresolved++;                       // ran off the end of the data — never booked as a loss
      }

      trades.push(trade);
      perDay[day] = (perDay[day] ?? 0) + 1;

      // Cooldown: blocked until resolution, or 4h, whichever is later — production's real clause.
      const expiryMs = +trade.openedAt + cfg.expiryHours * 3600_000;
      const freeAt =
        cfg.cooldownMode === 'instant' ? +trade.openedAt
        : cfg.cooldownMode === 'until-expiry' ? expiryMs
        : (trade.closedAt ? +trade.closedAt : expiryMs);   // 'until-resolved'
      blockedUntil[symbol] = Math.max(freeAt, +trade.openedAt + cfg.cooldownMinutes * 60_000);
    }
  }

  return { trades, unresolved, decisionPoints: decisionPoints.length, analyzeCalls, blocked };
}

if (process.argv[1] && process.argv[1].includes('run-backtest')) {
  (async () => {
    const dataFrom = arg('data-from', '2022-08-01'), dataTo = arg('data-to', '2026-08-01');
    const from = new Date(arg('from', '2024-08-01')), to = new Date(arg('to', '2026-08-01'));
    const pairs = arg('pairs', PRODUCTION_ORDER.join(',')).split(',');

    console.log(`Phase A replay  ${arg('from', '2024-08-01')} -> ${arg('to', '2026-08-01')}  pairs: ${pairs.join(', ')}\n`);
    const t0 = Date.now();
    const mode = arg('cooldown', 'until-resolved') as EngineConfig['cooldownMode'];
    const res = await runBacktest(pairs, dataFrom, dataTo, from, to, { ...DEFAULT_CONFIG, cooldownMode: mode });
    const mins = (Date.now() - t0) / 60000;

    const done = res.trades.filter(t => t.outcome);
    const wins = done.filter(t => t.outcome === 'TP1_HIT').length;
    const losses = done.filter(t => t.outcome === 'STOP_HIT').length;
    const exp = done.filter(t => t.outcome === 'EXPIRED').length;
    const netPips = done.reduce((s, t) => s + (t.netPips ?? 0), 0);
    const rs = done.map(t => t.r ?? 0);
    const meanR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;

    console.log(`decision points : ${res.decisionPoints}`);
    console.log(`analyze() calls : ${res.analyzeCalls}`);
    console.log(`blocked         : cooldown ${res.blocked.cooldown}, daily cap ${res.blocked.dailyCap}, no entry or <70 ${res.blocked.noSignal}`);
    console.log(`data quality    : skipped for stale slice ${res.blocked.staleData}, unusable fill ${res.blocked.staleFill}`);
    console.log(`\ntrades          : ${res.trades.length}  (unresolved at data end: ${res.unresolved})`);
    console.log(`  TP1_HIT ${wins}   STOP_HIT ${losses}   EXPIRED ${exp}`);
    if (done.length) {
      console.log(`  win rate      : ${(100 * wins / done.length).toFixed(1)}%`);
      console.log(`  net           : ${netPips.toFixed(1)} pips`);
      console.log(`  expectancy    : ${meanR.toFixed(4)} R/trade  (net of spread and swap)`);
    }
    console.log(`\nruntime ${mins.toFixed(1)} min`);
    process.exit(0);
  })();
}

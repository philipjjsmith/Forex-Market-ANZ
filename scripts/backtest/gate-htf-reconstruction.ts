/**
 * GATE 1 — does as-of slicing reproduce what production actually saw?
 *
 * Runs each live v3.3.0 signal through the real analyze() twice:
 *
 *   NAIVE  — `timestamp <= asOf`. Looks right, and is the trap: Twelve Data timestamps bars
 *            by their OPEN and stores them COMPLETE, so this hands the harness the finished
 *            daily bar (all 24h) when production saw only 00:00-asOf. Up to 15h of future
 *            price flows straight into `dailyTrend`, a HARD GATE. Weekly leaks up to 6 days.
 *
 *   PROPER — closed bars only, plus the forming bar rebuilt from 1H up to asOf.
 *
 * The difference between them IS the look-ahead, measured rather than argued.
 *
 * Pass condition (docs/BACKTEST_PREREGISTRATION.md §9): `htfTrend` must match EXACTLY, 100%.
 * A mismatch means the slicing is wrong and no downstream number means anything.
 *
 * Development set only — the 30% holdout is reserved and must not be run here.
 * USAGE: npx tsx scripts/backtest/gate-htf-reconstruction.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { MACrossoverStrategy } from '../../server/services/signal-generator';
import { twelveDataAPI } from '../../server/services/twelve-data';
import { sliceAsOf, sliceOneHourAsOf, lastN, PRODUCTION_SIZES, type Bar } from './candle-slicer';
import { loadHistory, estimateCalls } from './history-loader';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });
const HOLDOUT_FRACTION = 0.3;

(async () => {
  const all: any[] = await sql`
    SELECT signal_id, symbol, type, confidence, created_at, indicators
    FROM signal_history_deduped
    WHERE strategy_version = '3.3.0'
    ORDER BY created_at ASC`;

  // Deterministic holdout: every Nth signal by time order. Fixed before results exist.
  const holdoutEvery = Math.round(1 / HOLDOUT_FRACTION);
  const dev = all.filter((_, i) => (i + 1) % holdoutEvery !== 0);
  const holdout = all.filter((_, i) => (i + 1) % holdoutEvery === 0);
  console.log(`${all.length} v3.3.0 signals -> ${dev.length} development / ${holdout.length} HOLDOUT (reserved)\n`);

  const symbols = [...new Set(dev.map(s => s.symbol))];
  const hist: Record<string, { wk: Bar[]; dy: Bar[]; h4: Bar[]; h1: Bar[]; m5: Bar[] }> = {};

  for (const sym of symbols) {
    console.log(`fetching deep history for ${sym}...`);
    const [wk, dy, h4, h1] = await Promise.all([
      twelveDataAPI.fetchHistoricalCandles(sym, '1week', 300),
      twelveDataAPI.fetchHistoricalCandles(sym, '1day', 800),
      twelveDataAPI.fetchHistoricalCandles(sym, '4h', 2000),
      twelveDataAPI.fetchHistoricalCandles(sym, '1h', 5000),
    ]);
    hist[sym] = { wk: wk as Bar[], dy: dy as Bar[], h4: h4 as Bar[], h1: h1 as Bar[], m5: [] as Bar[] };
  }

  // 5-MINUTE DATA IS MANDATORY, not an optimisation.
  // Production reads currentPrice from the FORMING 1H bar. Handing analyze() the completed
  // bar changes ADX/RSI/ATR computed off that tail — measured ADX 19.52 vs a stored 25.27,
  // which falls below the mandatory ADX>=25 gate and silently deletes the signal.
  const from = new Date(Math.min(...all.map(s => new Date(s.created_at).getTime())) - 3 * 3600_000);
  const to = new Date(Math.max(...all.map(s => new Date(s.created_at).getTime())) + 3 * 3600_000);
  const est = symbols.reduce((n, _) => n + estimateCalls('5min', from, to), 0);
  console.log(`
loading 5-min data ${from.toISOString().slice(0,10)} -> ${to.toISOString().slice(0,10)} (~${est} API calls)`);
  for (const sym of symbols) {
    hist[sym].m5 = await loadHistory(sym, '5min', from, to);
  }

  const strat = new MACrossoverStrategy();
  let naiveMatch = 0, properMatch = 0, naiveNull = 0, properNull = 0, evaluated = 0;
  const disagreements: string[] = [];

  for (const s of dev) {
    const asOf = new Date(s.created_at);
    const h = hist[s.symbol];
    if (!h) continue;
    const storedHtf = (s.indicators || {}).htfTrend;
    if (!storedHtf) continue;

    const upTo = (b: Bar[]) => b.filter(x => new Date(x.timestamp).getTime() <= asOf.getTime());

    // --- NAIVE: complete bars, look-ahead included ---
    const nSig = await strat.analyze(
      lastN(upTo(h.wk), PRODUCTION_SIZES.weekly),
      lastN(upTo(h.dy), PRODUCTION_SIZES.daily),
      lastN(upTo(h.h4), PRODUCTION_SIZES.fourHour),
      lastN(upTo(h.h1), PRODUCTION_SIZES.oneHour),
      s.symbol, { asOf, approvedParams: null }
    );

    // --- PROPER: closed bars + reconstructed forming bar ---
    const pSig = await strat.analyze(
      lastN(sliceAsOf(h.wk, h.h1, asOf, '1week'), PRODUCTION_SIZES.weekly),
      lastN(sliceAsOf(h.dy, h.h1, asOf, '1day'), PRODUCTION_SIZES.daily),
      lastN(sliceAsOf(h.h4, h.h1, asOf, '4h'), PRODUCTION_SIZES.fourHour),
      lastN(sliceOneHourAsOf(h.h1, asOf, { includeForming: true, fiveMin: h.m5 }), PRODUCTION_SIZES.oneHour),
      s.symbol, { asOf, approvedParams: null }
    );

    evaluated++;
    const nHtf = nSig ? (nSig as any).indicators?.htfTrend : null;
    const pHtf = pSig ? (pSig as any).indicators?.htfTrend : null;
    if (!nSig) naiveNull++;
    if (!pSig) properNull++;
    if (nHtf === storedHtf) naiveMatch++;
    if (pHtf === storedHtf) properMatch++;

    if (pHtf !== storedHtf) {
      disagreements.push(
        `  ${new Date(s.created_at).toISOString().slice(0, 16)} ${s.symbol} ${s.type}\n` +
        `      stored: ${storedHtf}\n` +
        `      proper: ${pHtf ?? '(no signal)'}\n` +
        `      naive : ${nHtf ?? '(no signal)'}`
      );
    }
  }

  const pct = (x: number) => evaluated ? (100 * x / evaluated).toFixed(1) + '%' : 'n/a';
  console.log(`\n=== htfTrend REPRODUCTION (n=${evaluated} development signals) ===`);
  console.log(`  NAIVE  (timestamp <= asOf, look-ahead): ${naiveMatch}/${evaluated}  ${pct(naiveMatch)}   [nulls: ${naiveNull}]`);
  console.log(`  PROPER (closed + rebuilt forming bar) : ${properMatch}/${evaluated}  ${pct(properMatch)}   [nulls: ${properNull}]`);
  console.log(`\n  GATE: proper must be 100%. -> ${properMatch === evaluated ? '✅ PASS' : '❌ FAIL'}`);

  if (disagreements.length) {
    console.log(`\n=== ${disagreements.length} disagreement(s) ===`);
    disagreements.slice(0, 10).forEach(d => console.log(d));
  }

  await sql.end({ timeout: 5 });
  process.exit(0);
})();

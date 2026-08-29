/**
 * REPRODUCTION GATE — implements docs/BACKTEST_PREREGISTRATION.md Amendment 1 (§A1.4).
 *
 * The original §9 gate ("htfTrend exact, 100%") was unachievable, and §10 had already said so:
 * production computed each signal on an unlogged mixture of cache snapshots. Two signals
 * (05-11 / 05-12) carry byte-identical indicator blobs 23h apart, which live data cannot
 * produce. The cache key omitted `outputsize` until 5895423 and falls back to UNBOUNDED stale
 * cache on HTTP 429.
 *
 * So this gate conditions on INPUT recovery and tests OUTPUT agreement — different quantities,
 * therefore not circular:
 *
 *   G1  NAIVE must score materially WORSE than PROPER  -> the slicer really removes look-ahead
 *   G2  where inputs are recovered, `confidence` and `htfTrend` must be EXACT, on 100%
 *   G3  signals whose inputs cannot be recovered are reported UNRESOLVABLE, capped at 20%
 *
 * Signals that fail input recovery are NOT excluded — §9 rule 3 forbids exclusions referencing
 * whether a signal reproduced, and no independent staleness marker was ever logged. They are
 * counted and their distribution published (§A1.5: all three are USD/CHF).
 *
 * `asOf` snapshot recovery (§A1.3) searches a FIXED 0-20 min window — `created_at` is DB insert
 * time, not analysis time — selecting on INPUTS ONLY (ADX/RSI/ATR). It may never look at
 * confidence, direction or outcome.
 *
 * The 30% holdout is reserved and is not run here.
 * USAGE: npx tsx scripts/backtest/gate-reproduction.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { MACrossoverStrategy, Indicators } from '../../server/services/signal-generator';
import { twelveDataAPI } from '../../server/services/twelve-data';
import { sliceAsOf, sliceOneHourAsOf, lastN, PRODUCTION_SIZES, type Bar } from './candle-slicer';
import { loadHistory } from './history-loader';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });

const HOLDOUT_EVERY = 3;       // 30% holdout, fixed before results existed
const OFFSET_MAX_MIN = 20;     // §A1.3 — FIXED. Widening this to improve a result is forbidden.
const TOL = { adx: 0.005, rsi: 0.02, atr: 0.02 };   // input-recovery tolerances, §A1.4 G2 AS COMMITTED
const RSI_EPS = 0.005;
const UNRESOLVABLE_CAP = 0.20;                       // §A1.4 G3

const rel = (stored: number, got: number) =>
  Number.isFinite(stored) && Number.isFinite(got) && stored !== 0
    ? Math.abs(got - stored) / Math.abs(stored) : NaN;

const bar = (n: number) => new Array(n + 1).join('=');

(async () => {
  const all: any[] = await sql`
    SELECT signal_id, symbol, type, confidence, created_at, indicators, outcome
    FROM signal_history_deduped
    WHERE strategy_version = '3.3.0' AND data_quality = 'production'
    ORDER BY created_at ASC`;

  const dev = all.filter((_, i) => (i + 1) % HOLDOUT_EVERY !== 0);
  console.log(`${all.length} v3.3.0 signals -> ${dev.length} development / ${all.length - dev.length} HOLDOUT (reserved)\n`);

  const symbols = [...new Set(dev.map(s => s.symbol))];
  const hist: Record<string, { wk: Bar[]; dy: Bar[]; h4: Bar[]; h1: Bar[]; m5: Bar[] }> = {};
  const from = new Date(Math.min(...all.map(s => +new Date(s.created_at))) - 3 * 3600_000);
  const to = new Date(Math.max(...all.map(s => +new Date(s.created_at))) + 3 * 3600_000);

  for (const sym of symbols) {
    const [wk, dy, h4, h1] = await Promise.all([
      twelveDataAPI.fetchHistoricalCandles(sym, '1week', 300),
      twelveDataAPI.fetchHistoricalCandles(sym, '1day', 800),
      twelveDataAPI.fetchHistoricalCandles(sym, '4h', 2000),
      twelveDataAPI.fetchHistoricalCandles(sym, '1h', 5000),
    ]);
    // 5-min data is mandatory: production analysed a FORMING 1H bar (signal-generator.ts:651).
    hist[sym] = {
      wk: wk as Bar[], dy: dy as Bar[], h4: h4 as Bar[], h1: h1 as Bar[],
      m5: await loadHistory(sym, '5min', from, to),
    };
  }

  const strat = new MACrossoverStrategy();
  let naiveHtf = 0, properHtf = 0;
  const recovered: any[] = [], unresolvable: any[] = [], g2fail: string[] = [];

  for (const s of dev) {
    const asOf = new Date(s.created_at);
    const h = hist[s.symbol];
    const ind = s.indicators || {};
    const storedHtf = ind.htfTrend;
    if (!h || !storedHtf) continue;

    // --- G1 control arm: naive `timestamp <= asOf`, look-ahead intact ---
    const upTo = (b: Bar[]) => b.filter(x => +x.timestamp <= +asOf);
    const nSig: any = await strat.analyze(
      lastN(upTo(h.wk), PRODUCTION_SIZES.weekly), lastN(upTo(h.dy), PRODUCTION_SIZES.daily),
      lastN(upTo(h.h4), PRODUCTION_SIZES.fourHour), lastN(upTo(h.h1), PRODUCTION_SIZES.oneHour),
      s.symbol, { asOf, approvedParams: null });
    if (nSig?.indicators?.htfTrend === storedHtf) naiveHtf++;

    // --- §A1.3 snapshot recovery: INPUTS ONLY, fixed 0-20min window ---
    const sAdx = parseFloat(ind.adx), sRsi = parseFloat(ind.rsi), sAtr = parseFloat(ind.atr);
    // Selector uses only CLOSE-INSENSITIVE inputs (see Amendment 2). ATR's final true range is
    // max(H-L, |H-prevClose|, |L-prevClose|) and ADX works off +/-DM from highs/lows, so neither
    // depends on the forming bar's own close. RSI does, and 5-min data cannot resolve the exact
    // tick production read — so RSI is tested by CONTAINMENT, not by a tolerance, below.
    let best = { off: 0, score: Infinity, adx: NaN, rsi: NaN, atr: NaN };
    const rsiBand: number[] = [];
    for (let off = 0; off <= OFFSET_MAX_MIN; off++) {
      const eff = new Date(+asOf - off * 60_000);
      const oneH = lastN(sliceOneHourAsOf(h.h1, eff, { includeForming: true, fiveMin: h.m5 }), PRODUCTION_SIZES.oneHour);
      if (oneH.length < 100) continue;
      const adx = Indicators.adx(oneH as any, 14)?.adx;
      const rsi = Indicators.rsi(oneH.map(c => c.close), 14);
      const atr = Indicators.atr(oneH as any, 14);
      if (adx == null || rsi == null || atr == null) continue;
      rsiBand.push(rsi);
      const score = (rel(sAdx, adx) || 0) + (rel(sRsi, rsi) || 0) + (rel(sAtr, atr) || 0);
      if (score < best.score) best = { off, score, adx, rsi, atr };
    }

    // RSI containment: the stored value must be REACHABLE by some tick inside the reconstructed
    // hour. RSI_EPS covers the 2-decimal rounding of the stored value only.
    const rsiLo = Math.min(...rsiBand), rsiHi = Math.max(...rsiBand);
    const rsiContained = rsiBand.length > 0 && sRsi >= rsiLo - RSI_EPS && sRsi <= rsiHi + RSI_EPS;

    // Criterion is Amendment 1 AS COMMITTED. `rsiContained` is reported as a DIAGNOSTIC only —
    // it is not part of the pass rule, because redrawing the rule until the gate passes is the
    // loosening §9 forbids.
    const inputsOk =
      rel(sAdx, best.adx) <= TOL.adx && rel(sRsi, best.rsi) <= TOL.rsi && rel(sAtr, best.atr) <= TOL.atr;

    // --- PROPER replay at the recovered snapshot ---
    const eff = new Date(+asOf - best.off * 60_000);
    const pSig: any = await strat.analyze(
      lastN(sliceAsOf(h.wk, h.h1, asOf, '1week'), PRODUCTION_SIZES.weekly),
      lastN(sliceAsOf(h.dy, h.h1, asOf, '1day'), PRODUCTION_SIZES.daily),
      lastN(sliceAsOf(h.h4, h.h1, asOf, '4h'), PRODUCTION_SIZES.fourHour),
      lastN(sliceOneHourAsOf(h.h1, eff, { includeForming: true, fiveMin: h.m5 }), PRODUCTION_SIZES.oneHour),
      s.symbol, { asOf, approvedParams: null });
    if (pSig?.indicators?.htfTrend === storedHtf) properHtf++;

    const row = {
      when: asOf.toISOString().slice(0, 16), sym: s.symbol, off: best.off,
      storedConf: s.confidence, gotConf: pSig?.confidence ?? null,
      storedHtf, gotHtf: pSig?.indicators?.htfTrend ?? null,
      adxErr: rel(sAdx, best.adx), rsiErr: rel(sRsi, best.rsi), atrErr: rel(sAtr, best.atr),
      rsiLo, rsiHi, rsiContained,
      sAtr, gAtr: best.atr, sRsi, gRsi: best.rsi, outcome: s.outcome,
    };

    if (!inputsOk) { unresolvable.push(row); continue; }
    recovered.push(row);
    if (row.gotConf !== row.storedConf || row.gotHtf !== row.storedHtf) {
      g2fail.push(`  ${row.when} ${row.sym}  conf ${row.storedConf}->${row.gotConf ?? 'null'}   htf ${row.storedHtf} -> ${row.gotHtf ?? 'null'}`);
    }
  }

  const n = recovered.length + unresolvable.length;
  const g2pass = recovered.length - g2fail.length;
  const unresFrac = unresolvable.length / n;

  console.log(`\n${bar(64)}\nREPRODUCTION GATE  (Amendment 1, n=${n} development signals)\n${bar(64)}`);

  console.log(`\nG1  look-ahead removal`);
  console.log(`      NAIVE  htfTrend match : ${naiveHtf}/${n}  ${(100 * naiveHtf / n).toFixed(1)}%`);
  console.log(`      PROPER htfTrend match : ${properHtf}/${n}  ${(100 * properHtf / n).toFixed(1)}%`);
  console.log(`      -> ${properHtf > naiveHtf ? 'PASS' : 'FAIL'}  (slicer must beat the look-ahead control)`);

  console.log(`\nG2  exact scoring where inputs recovered  (ADX<=0.5%, RSI<=2%, ATR<=2%)`);
  console.log(`      recovered            : ${recovered.length}/${n}`);
  console.log(`      confidence+htf EXACT : ${g2pass}/${recovered.length}  ${(100 * g2pass / Math.max(1, recovered.length)).toFixed(1)}%`);
  console.log(`      -> ${g2fail.length === 0 ? 'PASS' : 'FAIL'}  (must be 100%)`);
  if (g2fail.length) { console.log(`      failures:`); g2fail.forEach(f => console.log(f)); }

  console.log(`\nG3  unresolvable inputs  (cap ${(UNRESOLVABLE_CAP * 100).toFixed(0)}%)`);
  console.log(`      UNRESOLVABLE         : ${unresolvable.length}/${n}  ${(100 * unresFrac).toFixed(1)}%`);
  console.log(`      -> ${unresFrac <= UNRESOLVABLE_CAP ? 'PASS' : 'FAIL'}`);
  if (unresolvable.length) {
    console.log(`      §A1.5 mandatory disclosure — distribution of the unresolvable set:`);
    const byPair: Record<string, number> = {};
    for (const u of unresolvable) byPair[u.sym] = (byPair[u.sym] || 0) + 1;
    console.log(`        by pair: ${Object.entries(byPair).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    unresolvable.forEach(u => console.log(`        ${u.when} ${u.sym}  off=-${u.off}m  adx ${(100*u.adxErr).toFixed(2)}%  rsi ${(100*u.rsiErr).toFixed(2)}% (${u.sRsi}->${Number(u.gRsi).toFixed(2)})  atr ${(100*u.atrErr).toFixed(2)}%  rsi ${u.sRsi} in [${Number(u.rsiLo).toFixed(2)},${Number(u.rsiHi).toFixed(2)}]? ${u.rsiContained}`));
  }

  const pass = properHtf > naiveHtf && g2fail.length === 0 && unresFrac <= UNRESOLVABLE_CAP;
  console.log(`\n${bar(64)}\nGATE: ${pass ? 'PASS — harness may proceed to the 4-year replay' : 'FAIL — fix the harness (§9)'}\n${bar(64)}`);

  await sql.end({ timeout: 5 });
  process.exit(pass ? 0 : 1);
})();

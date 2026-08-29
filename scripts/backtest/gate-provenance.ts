/**
 * PROVENANCE GATE — the reproduction test that can actually reach 100%.
 *
 * The Amendment 1 gate tops out at 80-85% against historical signals, and it always will:
 * production recorded results but never inputs. `created_at` is the INSERT time, the Twelve
 * Data cache key omitted `outputsize` until 5895423, and the fetcher falls back to UNBOUNDED
 * stale cache on HTTP 429 — two signals 23h apart once carried byte-identical indicators.
 * Those inputs are gone.
 *
 * `signal_provenance` (2026-08-29) records them going forward, so reproduction becomes a
 * yes/no on a sha256 rather than an argument about tolerances. This gate checks three things
 * per recorded analysis:
 *
 *   P1  CLOSED-BAR HISTORY — sha256 of every bar except the forming one must match EXACTLY.
 *       This is the check that was impossible before. No tolerance: bytes or nothing.
 *
 *   P2  FORMING-BAR RECONSTRUCTION — the recorded partial bar's OHLC vs the one rebuilt from
 *       5-minute data. Reported per component, because high/low and close fail differently:
 *       ADX and ATR ignore the forming bar's close (ATR's final true range is
 *       max(H-L,|H-prevC|,|L-prevC|)), while RSI depends on it entirely.
 *
 *   P3  OUTPUT — fired/did-not-fire and exact confidence, replayed at the RECORDED asOf.
 *       Because P1 pins the inputs, any P3 failure is a genuine harness defect.
 *
 * USAGE: npx tsx scripts/backtest/gate-provenance.ts [--limit N]
 */
import 'dotenv/config';
import postgres from 'postgres';
import { MACrossoverStrategy } from '../../server/services/signal-generator';
import { twelveDataAPI } from '../../server/services/twelve-data';
import { describeSeries } from '../../server/services/provenance';
import { sliceAsOf, sliceOneHourAsOf, lastN, PRODUCTION_SIZES, type Bar } from './candle-slicer';
import { loadHistory } from './history-loader';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 });
const LIMIT = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 50);

const pipOf = (sym: string) => (sym.includes('JPY') ? 0.01 : 0.0001);

(async () => {
  // Only rows produced by the CURRENT strategy version are comparable. The harness replays
  // using today's code, and v3.4.0 (2026-08-29) drops Twelve Data's market-closed filler bars
  // before analysis — so a v3.3.0 row's recorded arrays contain bars the current fetcher will
  // never return, and its hashes cannot match. That is a version difference, not a harness
  // fault, and silently mixing the two would make the gate meaningless.
  const strat0 = new MACrossoverStrategy();
  const rows: any[] = await sql`
    SELECT analyzed_at, symbol, strategy_version, produced, confidence, rejection_reason, inputs, cache_meta
    FROM signal_provenance
    WHERE strategy_version = ${strat0.version}
    ORDER BY analyzed_at DESC LIMIT ${LIMIT}`;

  const [older]: any = await sql`
    SELECT count(*)::int AS n FROM signal_provenance WHERE strategy_version <> ${strat0.version}`;
  if (older?.n) console.log(`(${older.n} row(s) from earlier strategy versions excluded — not comparable to current code)`);

  if (rows.length === 0) {
    console.log('No provenance rows yet. Run scripts/backtest/provenance-probe.ts first.');
    process.exit(0);
  }
  console.log(`${rows.length} recorded analysis attempt(s)\n`);

  const symbols = [...new Set(rows.map(r => r.symbol))];
  const hist: Record<string, any> = {};
  const from = new Date(Math.min(...rows.map(r => +new Date(r.analyzed_at))) - 7 * 86400_000);
  const to = new Date(Math.max(...rows.map(r => +new Date(r.analyzed_at))) + 3600_000);

  const skipped: string[] = [];
  for (const sym of symbols) {
    // A symbol whose deep history is unavailable (quota, outage) must be SKIPPED and reported,
    // never allowed to abort the run — and never silently dropped, since unavailability
    // correlates with pair, which would bias the result.
    try {
      const [wk, dy, h4, h1] = await Promise.all([
        twelveDataAPI.fetchHistoricalCandles(sym, '1week', 300),
        twelveDataAPI.fetchHistoricalCandles(sym, '1day', 800),
        twelveDataAPI.fetchHistoricalCandles(sym, '4h', 2000),
        twelveDataAPI.fetchHistoricalCandles(sym, '1h', 5000),
      ]);
      hist[sym] = { wk, dy, h4, h1, m5: await loadHistory(sym, '5min', from, to) };
    } catch (err) {
      skipped.push(`${sym} (${err instanceof Error ? err.message.slice(0, 48) : 'error'})`);
    }
  }
  if (skipped.length) console.log(`SKIPPED — history unavailable: ${skipped.join(', ')}
`);

  const strat = new MACrossoverStrategy();
  const tfs = ['weekly', 'daily', 'fourHour', 'oneHour'] as const;
  const p1: Record<string, { ok: number; n: number }> = {};
  tfs.forEach(t => (p1[t] = { ok: 0, n: 0 }));
  let p3ok = 0, p3n = 0;
  const formingErr: { hl: number[]; close: number[] } = { hl: [], close: [] };
  const pubLagMin: number[] = [];
  const failures: string[] = [];

  for (const r of rows) {
    const asOf = new Date(r.analyzed_at);
    const h = hist[r.symbol];
    if (!h) continue;
    const rec = r.inputs;

    // Twelve Data publishes a bar a minute or two AFTER its period ends, so the newest bar
    // available at `asOf` is not derivable from `asOf` alone: at 22:01 the 22:00 bar may not
    // exist yet, and the 21:00 bar is already complete rather than forming. Provenance records
    // which bar production actually had, so honour it rather than guessing. This uses a
    // recorded INPUT to rebuild recorded INPUTS — the output is still tested independently.
    const truncTo = (arr: Bar[], lastTs: string | null | undefined) =>
      lastTs ? arr.filter(b => +b.timestamp <= +new Date(lastTs)) : arr;

    const mine: Record<string, Bar[]> = {
      weekly: lastN(truncTo(sliceAsOf(h.wk, h.h1, asOf, '1week'), rec.weekly?.lastTs), PRODUCTION_SIZES.weekly),
      daily: lastN(truncTo(sliceAsOf(h.dy, h.h1, asOf, '1day'), rec.daily?.lastTs), PRODUCTION_SIZES.daily),
      fourHour: lastN(truncTo(sliceAsOf(h.h4, h.h1, asOf, '4h'), rec.fourHour?.lastTs), PRODUCTION_SIZES.fourHour),
      oneHour: lastN(truncTo(sliceOneHourAsOf(h.h1, asOf, { includeForming: true, fiveMin: h.m5 }), rec.oneHour?.lastTs), PRODUCTION_SIZES.oneHour),
    };

    // --- P1: closed-bar history, byte-exact ---
    const marks: string[] = [];
    for (const tf of tfs) {
      const got = describeSeries(mine[tf] as any);
      const want = rec[tf];
      p1[tf].n++;
      const ok = !!want?.sha256ExclLast && got.sha256ExclLast === want.sha256ExclLast;
      if (ok) p1[tf].ok++;
      marks.push(`${tf}:${ok ? 'ok' : `MISMATCH(${want?.count ?? '?'} vs ${got.count})`}`);
    }

    // --- P2: forming-bar reconstruction, per component ---
    const wantLast = rec.oneHour?.last, gotLast = describeSeries(mine.oneHour as any).last;
    if (wantLast && gotLast) {
      const pip = pipOf(r.symbol);
      formingErr.hl.push(Math.max(Math.abs(gotLast.h - wantLast.h), Math.abs(gotLast.l - wantLast.l)) / pip);
      formingErr.close.push(Math.abs(gotLast.c - wantLast.c) / pip);
    }

    // Publication lag: how long past a 1H bar's close before the NEXT bar was available.
    if (rec.oneHour?.lastTs) {
      pubLagMin.push((+asOf - (+new Date(rec.oneHour.lastTs) + 3600_000)) / 60_000);
    }

    // --- P3: output, replayed at the RECORDED asOf ---
    const sig: any = await strat.analyze(
      mine.weekly as any, mine.daily as any, mine.fourHour as any, mine.oneHour as any,
      r.symbol, { asOf, approvedParams: null });
    p3n++;
    const outOk = (!!sig === r.produced) && (sig?.confidence ?? null) === (r.confidence ?? null);
    if (outOk) p3ok++;
    else failures.push(`  ${asOf.toISOString().slice(0, 16)} ${r.symbol.padEnd(8)} recorded ${r.produced ? `FIRED conf=${r.confidence}` : 'no signal'} -> replay ${sig ? `FIRED conf=${sig.confidence}` : 'no signal'}   [${marks.join(' ')}]`);
  }

  const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
  const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

  console.log('='.repeat(64));
  console.log(`PROVENANCE GATE   (evaluated ${p3n}/${rows.length} recorded attempts)`);
  console.log('='.repeat(64));
  console.log('\nP1  closed-bar history reproduces byte-exactly');
  for (const tf of tfs) console.log(`      ${tf.padEnd(9)} ${p1[tf].ok}/${p1[tf].n}  ${pct(p1[tf].ok, p1[tf].n)}`);
  const p1all = tfs.every(t => p1[t].ok === p1[t].n);
  console.log(`      -> ${p1all ? 'PASS' : 'FAIL'}  (must be 100% — bytes, not tolerance)`);

  console.log('\nP2  forming-bar reconstruction (1H), error in pips');
  console.log(`      high/low : median ${med(formingErr.hl).toFixed(2)}  max ${Math.max(...formingErr.hl).toFixed(2)}`);
  console.log(`      close    : median ${med(formingErr.close).toFixed(2)}  max ${Math.max(...formingErr.close).toFixed(2)}`);
  console.log(`      (ADX/ATR ignore this close; RSI does not — reported, not gated)`);

  console.log('\nP2b 1H publication lag (asOf minus the close of the newest available bar)');
  console.log(`      median ${med(pubLagMin).toFixed(1)} min  max ${Math.max(...pubLagMin).toFixed(1)} min`);
  console.log('      (the backtest must model this: at 22:01 the 22:00 bar may not exist yet)');

  console.log('\nP3  output reproduces exactly (fired + confidence)');
  console.log(`      ${p3ok}/${p3n}  ${pct(p3ok, p3n)}`);
  console.log(`      -> ${p3ok === p3n ? 'PASS' : 'FAIL'}  (must be 100%)`);
  if (failures.length) { console.log('      failures:'); failures.slice(0, 12).forEach(f => console.log(f)); }

  const pass = p1all && p3ok === p3n;
  console.log(`\n${'='.repeat(64)}`);
  console.log(`GATE: ${pass ? 'PASS — inputs and outputs both reproduce exactly' : 'FAIL — fix the harness (§9)'}`);
  console.log('='.repeat(64));

  await sql.end({ timeout: 5 });
  process.exit(pass ? 0 : 1);
})();

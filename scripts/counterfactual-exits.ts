/**
 * Evaluate alternative EXIT rules against stored resolution paths.
 *
 * This is the point of `backfill-outcome-paths.ts`. Once a signal carries its full 5-minute path
 * to expiry, any exit rule can be scored on it WITHOUT re-running a replay and WITHOUT re-fitting
 * anything — the entry decision is fixed and historical, and only the exit is varied.
 *
 * Why that matters methodologically: on forward data, the hypotheses below were written down
 * BEFORE the data existed, so scoring them later is a pre-registered test rather than a search.
 * It costs no §5 variant slot and adds no Deflated-Sharpe trial, because nothing is being
 * selected — every rule is reported, every time.
 *
 * On the HISTORICAL rows it is descriptive only. Those paths predate the hypotheses, so numbers
 * from them are a feasibility check on the machinery, NOT evidence for any rule.
 *
 * USAGE
 *   npx tsx scripts/counterfactual-exits.ts             # every row that has a usable path
 *   npx tsx scripts/counterfactual-exits.ts --min-bars=100
 */
import 'dotenv/config';
import postgres from 'postgres';

const arg = (k: string, d: string) =>
  process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const MIN_BARS = parseInt(arg('min-bars', '20'), 10);

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 20 });

interface Bar { timestamp: string; open: number; high: number; low: number; close: number; }

/**
 * Score one exit rule over a path. Returns R (in units of the ORIGINAL risk, so rules stay
 * comparable even when they move the stop).
 *
 * Conventions kept identical to the backtest engine so results are commensurable:
 *   - if a bar touches both stop and target, the STOP wins (order is unknowable at 5min)
 *   - a gap fills at the bar open, never at the level
 */
function scoreExit(
  entry: number, stop: number, target: number, isLong: boolean, bars: Bar[],
  opts: { stopMult?: number; targetMult?: number; breakevenAtR?: number }
): number | null {
  const risk0 = Math.abs(entry - stop);
  if (risk0 <= 0 || bars.length === 0) return null;

  const sMult = opts.stopMult ?? 1;
  const tMult = opts.targetMult ?? 1;
  let curStop = entry + (isLong ? -1 : 1) * risk0 * sMult;
  const tgt = entry + (target - entry) * tMult;
  const beAt = opts.breakevenAtR;
  let moved = false;

  for (const b of bars) {
    const hi = +b.high, lo = +b.low, op = +b.open;

    // Breakeven is evaluated BEFORE the exits on the same bar only if the trigger was reached on
    // an EARLIER bar. Doing it within the trigger bar would let one bar both arm and protect,
    // which is not physically available to a resting order.
    const hitStop = isLong ? lo <= curStop : hi >= curStop;
    const hitTgt = isLong ? hi >= tgt : lo <= tgt;

    if (hitStop) {
      const gapped = isLong ? op <= curStop : op >= curStop;
      const px = gapped ? op : curStop;
      return ((isLong ? px - entry : entry - px)) / risk0;
    }
    if (hitTgt) {
      const gapped = isLong ? op >= tgt : op <= tgt;
      const px = gapped ? op : tgt;
      return ((isLong ? px - entry : entry - px)) / risk0;
    }
    if (beAt !== undefined && !moved) {
      const fav = (isLong ? hi - entry : entry - lo) / risk0;
      if (fav >= beAt) { curStop = entry; moved = true; }
    }
  }
  const last = +bars[bars.length - 1].close;
  return ((isLong ? last - entry : entry - last)) / risk0;   // expired at the close
}

(async () => {
  const rows: any[] = await db`
    SELECT signal_id, symbol, type, entry_price, stop_loss, tp1, outcome,
           corrected_outcome, profit_loss_pips, outcome_candles
    FROM signal_history
    WHERE data_quality = 'production' AND outcome_candles IS NOT NULL
    ORDER BY created_at DESC
  `;

  const usable = rows.filter(r => Array.isArray(r.outcome_candles) && r.outcome_candles.length >= MIN_BARS);
  console.log(`rows with a stored path : ${rows.length}`);
  console.log(`usable (>= ${MIN_BARS} bars) : ${usable.length}\n`);
  if (usable.length === 0) { await db.end(); return; }

  const RULES: Array<{ name: string; opts: any }> = [
    { name: 'as deployed (1R stop, TP1)', opts: {} },
    { name: 'breakeven after +1R', opts: { breakevenAtR: 1 } },
    { name: 'breakeven after +1.5R', opts: { breakevenAtR: 1.5 } },
    { name: 'stop 1.5x wider', opts: { stopMult: 1.5 } },
    { name: 'stop 2x wider', opts: { stopMult: 2 } },
    { name: 'target at half distance', opts: { targetMult: 0.5 } },
    { name: 'stop 1.5x + target 0.75x', opts: { stopMult: 1.5, targetMult: 0.75 } },
  ];

  const results = new Map<string, number[]>();
  for (const rule of RULES) results.set(rule.name, []);

  for (const r of usable) {
    const isLong = String(r.type).toUpperCase() === 'LONG';
    const bars: Bar[] = r.outcome_candles;
    for (const rule of RULES) {
      const v = scoreExit(+r.entry_price, +r.stop_loss, +r.tp1, isLong, bars, rule.opts);
      if (v !== null) results.get(rule.name)!.push(v);
    }
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a: number[]) => {
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
  };

  console.log('exit rule                        n     mean R    sd      win%');
  for (const rule of RULES) {
    const v = results.get(rule.name)!;
    const wins = v.filter(x => x > 0).length;
    console.log(
      `  ${rule.name.padEnd(30)} ${String(v.length).padStart(3)}  ` +
      `${(mean(v) >= 0 ? '+' : '') + mean(v).toFixed(4)}  ${sd(v).toFixed(3)}  ` +
      `${(100 * wins / v.length).toFixed(1)}%`
    );
  }

  console.log('\n' + '-'.repeat(72));
  console.log('These are DESCRIPTIVE on historical rows — the paths predate the hypotheses, so');
  console.log('nothing here is evidence for any rule. The machinery exists so that the SAME');
  console.log('table, computed on FORWARD signals, is a pre-registered test. Report every row');
  console.log('every time; selecting the best line is the error this whole project guards against.');
  console.log('-'.repeat(72));

  await db.end();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });

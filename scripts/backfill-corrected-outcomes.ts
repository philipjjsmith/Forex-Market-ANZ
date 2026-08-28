/**
 * Backfill corrected outcomes for historical signals.
 *
 * WHY
 * ---
 * The outcome validator used to fetch "the most recent 200 1H candles" — never anchored to
 * the trade — and, with datetimes parsed as host-local, could scan PRE-signal price action as
 * though it were post-signal. It therefore recorded losses that never happened.
 *
 * Verified example: USD/CHF LONG 2026-06-19T07:20Z, entry 0.80620, SL 0.80473, recorded
 * STOP_HIT at the stop five minutes in. Across the full 48h window the low was 0.80537 —
 * the stop was never touched.
 *
 * Independent proof of direction: a stop-out is only physically possible if price moved
 * >= 1.0R against the position. Of 64 complete-data trades, 10 recorded STOP_HITs had a
 * measured MAE below 1.0R (IMPOSSIBLE), and ZERO recorded wins were impossible. The bias was
 * one-directional: the validator fabricated losses and never fabricated wins.
 *
 * WHAT THIS DOES
 * --------------
 * Replays each production signal against window-anchored 5-minute candles and writes the
 * result to the `corrected_*` columns. **Originals are never modified** — that is the whole
 * point: the size of the error stays provable.
 *
 * The resolution logic here MUST mirror outcome-validator.ts exactly, or the backfill and the
 * live path will disagree. Kept in step deliberately:
 *   - window start floored to the 5-min boundary, so the ENTRY BAR is included
 *   - scanning stops at expires_at (Twelve Data's end_date is inclusive)
 *   - ambiguous bar resolves STOP-FIRST (conservative; never flatters the record)
 *   - gaps through a level record the bar OPEN, not the level
 *   - EXPIRED only when the window elapsed AND no touch occurred, priced at the real close
 *
 * COST
 * ----
 * One API call per (symbol, UTC date) rather than per signal: 71 calls instead of 306.
 * ~10 minutes at the enforced 8s spacing.
 *
 * USAGE
 *   npx tsx scripts/backfill-corrected-outcomes.ts --dry-run
 *   npx tsx scripts/backfill-corrected-outcomes.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!process.env.TWELVE_DATA_KEY) { console.error('TWELVE_DATA_KEY not set'); process.exit(1); }
const KEY = process.env.TWELVE_DATA_KEY;

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

interface Bar { t: Date; o: number; h: number; l: number; c: number; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const floor5 = (d: Date) => new Date(Math.floor(d.getTime() / 300_000) * 300_000);
const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function parseUTC(s: string): Date {
  const t = s.trim().replace(' ', 'T');
  const hasZone = /[Zz]$/.test(t) || /[+-]\d{2}:?\d{2}$/.test(t);
  const iso = hasZone ? t : (t.length <= 10 ? `${t}T00:00:00Z` : `${t}Z`);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable datetime: "${s}"`);
  return d;
}

async function fetchWindow(symbol: string, start: Date, end: Date): Promise<Bar[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}`
    + `&interval=5min&start_date=${encodeURIComponent(fmt(start))}`
    + `&end_date=${encodeURIComponent(fmt(end))}&timezone=UTC&order=asc&outputsize=5000&apikey=${KEY}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.status === 'error') {
    if (/no data/i.test(data.message || '')) return [];
    throw new Error(data.message);
  }
  return (data.values || []).map((v: any) => ({
    t: parseUTC(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close,
  }));
}

/** Mirrors outcome-validator.ts checkOutcomeFromCandles. Keep the two in step. */
function resolve(sig: any, bars: Bar[]) {
  const isLong = sig.type === 'LONG';
  const entry = Number(sig.entry_price);
  const stop = Number(sig.stop_loss);
  const target = Number(sig.tp1);
  const R = Math.abs(entry - stop);
  const createdAt = new Date(sig.created_at);
  const expiresAt = new Date(sig.expires_at);
  const windowStart = floor5(createdAt);

  const scope = bars.filter(b => b.t >= windowStart && b.t < expiresAt);
  if (!scope.length) return null;

  let mfeR = 0, maeR = 0;
  let out: { outcome: string; price: number; time: Date } | null = null;

  for (const b of scope) {
    const fav = isLong ? b.h - entry : entry - b.l;
    const adv = isLong ? entry - b.l : b.h - entry;
    if (R > 0) {
      if (fav / R > mfeR) mfeR = fav / R;
      if (adv / R > maeR) maeR = adv / R;
    }
    if (out) continue;

    const slHit = isLong ? b.l <= stop : b.h >= stop;
    const tpHit = isLong ? b.h >= target : b.l <= target;

    if (slHit) {
      const fill = isLong ? Math.min(stop, b.o) : Math.max(stop, b.o);
      out = { outcome: 'STOP_HIT', price: fill, time: b.t };
    } else if (tpHit) {
      const fill = isLong ? Math.max(target, b.o) : Math.min(target, b.o);
      out = { outcome: 'TP1_HIT', price: fill, time: b.t };
    }
  }

  if (!out) {
    if (Date.now() < expiresAt.getTime()) return null;   // still genuinely open
    out = { outcome: 'EXPIRED', price: scope[scope.length - 1].c, time: expiresAt };
  }

  const pip = String(sig.symbol).includes('JPY') ? 0.01 : 0.0001;
  const pips = isLong ? (out.price - entry) / pip : (entry - out.price) / pip;
  return { ...out, pips, mfeR, maeR, bars: scope.length };
}

(async () => {
  console.log(DRY_RUN ? '🔎 DRY RUN — no writes\n' : '✍️  LIVE — writing corrected_* columns\n');

  const groups: any[] = await sql`
    SELECT symbol, (created_at AT TIME ZONE 'UTC')::date AS d,
           MIN(created_at) AS mn, MAX(expires_at) AS mx
    FROM signal_history WHERE data_quality = 'production'
    GROUP BY 1, 2 ORDER BY 2, 1`;

  console.log(`${groups.length} (symbol, date) groups to fetch\n`);

  const tally: Record<string, number> = {};
  let changed = 0, unchanged = 0, skipped = 0, done = 0;

  for (const g of groups) {
    const sigs: any[] = await sql`
      SELECT signal_id, symbol, type, entry_price, stop_loss, tp1, created_at, expires_at,
             outcome, profit_loss_pips
      FROM signal_history
      WHERE data_quality = 'production' AND symbol = ${g.symbol}
        AND (created_at AT TIME ZONE 'UTC')::date = ${g.d}`;

    let bars: Bar[] = [];
    try {
      bars = await fetchWindow(g.symbol, floor5(new Date(g.mn)), new Date(g.mx));
    } catch (e: any) {
      console.log(`  ⚠️  ${g.symbol} ${String(g.d).slice(0, 10)} fetch failed: ${e.message.slice(0, 60)}`);
    }
    await sleep(8100);
    done++;

    for (const s of sigs) {
      const r = resolve(s, bars);
      if (!r) { skipped++; continue; }
      const key = `${s.outcome} -> ${r.outcome}`;
      tally[key] = (tally[key] || 0) + 1;
      if (r.outcome === s.outcome) unchanged++; else changed++;

      if (!DRY_RUN) {
        await sql`
          UPDATE signal_history SET
            corrected_outcome           = ${r.outcome},
            corrected_outcome_price     = ${r.price},
            corrected_outcome_time      = ${r.time.toISOString()},
            corrected_profit_loss_pips  = ${r.pips},
            corrected_mfe_r             = ${r.mfeR},
            corrected_mae_r             = ${r.maeR},
            validation_method           = 'backfill-window-5min-v1'
          WHERE signal_id = ${s.signal_id}`;
      }
    }
    if (done % 10 === 0) console.log(`  ...${done}/${groups.length} groups`);
  }

  console.log(`\n=== RESULT ===`);
  console.log(`  agreed with recorded : ${unchanged}`);
  console.log(`  CHANGED              : ${changed}`);
  console.log(`  unresolvable/skipped : ${skipped}`);
  console.log(`\n  transitions:`);
  Object.entries(tally).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(26)} ${v}`));

  await sql.end({ timeout: 5 });
})();

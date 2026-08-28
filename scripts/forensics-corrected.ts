/**
 * The honest performance record.
 *
 * Successor to scripts/_forensics.ts, which was the only methodologically sound analysis
 * artifact in the repo but hardcodes the production database password in plaintext. This
 * version reads DATABASE_URL from the environment and adds the two things _forensics.ts
 * could not know about:
 *
 *   1. It reads the `signal_history_deduped` VIEW rather than the raw table. Nothing else in
 *      this codebase deduplicates, which inflates trade counts ~4.3x — and because duplicates
 *      cluster on LOSERS (the old dedup guard released the moment a trade resolved, while the
 *      30-minute candle cache let the identical setup re-fire 15 minutes later), the raw win
 *      rate is biased DOWNWARD, not upward.
 *
 *   2. It reports RECORDED vs CORRECTED side by side. The old validator fabricated losses:
 *      of 306 production rows, 133 recorded outcomes were wrong, and the asymmetry is the
 *      proof — 37 recorded losses were actually wins against only 2 the other way.
 *
 * Read-only. USAGE: npx tsx scripts/forensics-corrected.ts
 */
import 'dotenv/config';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

const WIN = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'];

function line(label: string, w: number, l: number, pips: number, n?: number) {
  const dec = w + l;
  const wr = dec ? (100 * w / dec) : 0;
  const se = dec ? Math.sqrt((wr / 100) * (1 - wr / 100) / dec) * 100 : 0;
  const ci = dec ? ` CI[${(wr - 1.96 * se).toFixed(1)}–${(wr + 1.96 * se).toFixed(1)}]` : '';
  console.log(
    `  ${label.padEnd(30)} n=${String(n ?? dec).padStart(4)}  ${String(w).padStart(3)}W/${String(l).padStart(3)}L` +
    `  WR=${wr.toFixed(1).padStart(5)}%${ci}  pips=${pips.toFixed(1).padStart(9)}`
  );
}

(async () => {
  const rows: any[] = await sql`SELECT * FROM signal_history_deduped`;
  console.log(`=== DEDUPLICATED PRODUCTION TRADES (n=${rows.length}) ===\n`);

  const tally = (outcomeKey: string, pipsKey: string) => {
    let w = 0, l = 0, e = 0, pips = 0;
    for (const r of rows) {
      const o = r[outcomeKey];
      if (!o) continue;
      if (WIN.includes(o)) { w++; pips += Number(r[pipsKey] ?? 0); }
      else if (o === 'STOP_HIT') { l++; pips += Number(r[pipsKey] ?? 0); }
      else if (o === 'EXPIRED') e++;
    }
    return { w, l, e, pips };
  };

  const rec = tally('outcome', 'profit_loss_pips');
  const cor = tally('corrected_outcome', 'corrected_profit_loss_pips');

  console.log('RECORDED vs CORRECTED');
  line('recorded (old validator)', rec.w, rec.l, rec.pips);
  line('CORRECTED (window replay)', cor.w, cor.l, cor.pips);
  console.log(`  expired — recorded ${rec.e}, corrected ${cor.e}\n`);

  // Breakeven is set by the ACTUAL risk:reward achieved, not the intended one.
  const rr = rows
    .filter(r => r.entry_price && r.stop_loss && r.tp1)
    .map(r => {
      const e = Number(r.entry_price), s = Number(r.stop_loss), t = Number(r.tp1);
      return Math.abs(t - e) / Math.abs(e - s);
    });
  const meanRR = rr.reduce((a, b) => a + b, 0) / rr.length;
  const be = 100 / (1 + meanRR);
  const corDec = cor.w + cor.l;
  const corWR = corDec ? 100 * cor.w / corDec : 0;
  console.log(`mean R:R = ${meanRR.toFixed(2)}:1  ->  breakeven WR = ${be.toFixed(1)}%`);
  console.log(`corrected WR = ${corWR.toFixed(1)}%  ->  ${corWR > be ? '✅ above' : '❌ below'} breakeven\n`);

  console.log('BY STRATEGY VERSION (corrected)');
  const versions = [...new Set(rows.map(r => r.strategy_version))].sort();
  for (const v of versions) {
    const sub = rows.filter(r => r.strategy_version === v);
    let w = 0, l = 0, pips = 0;
    for (const r of sub) {
      const o = r.corrected_outcome;
      if (WIN.includes(o)) { w++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
      else if (o === 'STOP_HIT') { l++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
    }
    line(`v${v}`, w, l, pips);
  }

  console.log('\nBY SYMBOL + DIRECTION (corrected)');
  const keys = [...new Set(rows.map(r => `${r.symbol} ${r.type}`))].sort();
  for (const k of keys) {
    const sub = rows.filter(r => `${r.symbol} ${r.type}` === k);
    let w = 0, l = 0, pips = 0;
    for (const r of sub) {
      const o = r.corrected_outcome;
      if (WIN.includes(o)) { w++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
      else if (o === 'STOP_HIT') { l++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
    }
    line(k, w, l, pips);
  }

  console.log('\nCONFIDENCE TIERS (corrected) — does the score rank trades?');
  const bucket = (c: number) => c >= 115 ? 'S-TIER 115+' : c >= 90 ? 'HIGH 90-114' : c >= 70 ? 'MED 70-89' : 'LOW <70';
  for (const b of ['S-TIER 115+', 'HIGH 90-114', 'MED 70-89', 'LOW <70']) {
    const sub = rows.filter(r => bucket(Number(r.confidence)) === b);
    if (!sub.length) continue;
    let w = 0, l = 0, pips = 0;
    for (const r of sub) {
      const o = r.corrected_outcome;
      if (WIN.includes(o)) { w++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
      else if (o === 'STOP_HIT') { l++; pips += Number(r.corrected_profit_loss_pips ?? 0); }
    }
    line(b, w, l, pips);
  }

  console.log('\nEXPECTANCY');
  const expR = rows.reduce((acc, r) => {
    const o = r.corrected_outcome;
    if (!o) return acc;
    const e = Number(r.entry_price), s = Number(r.stop_loss), t = Number(r.tp1);
    const R = Math.abs(e - s);
    if (WIN.includes(o)) return acc + Math.abs(t - e) / R;
    if (o === 'STOP_HIT') return acc - 1;
    return acc;
  }, 0);
  const nWithCorr = rows.filter(r => r.corrected_outcome).length;
  console.log(`  total ${expR.toFixed(2)}R over ${nWithCorr} trades = ${(expR / nWithCorr).toFixed(3)}R per trade (before costs)`);
  console.log(`  a ~1 pip round-trip spread is roughly -0.07R/trade on a 15-pip stop`);

  await sql.end({ timeout: 5 });
})();

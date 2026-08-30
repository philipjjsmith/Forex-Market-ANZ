/* scratch audit — is the arm comparison confounded by (symbol,hour) sample differences? */
import fs from 'fs';
const j = JSON.parse(fs.readFileSync('.backtest-cache/trades-primary.json', 'utf8'));
const A: Record<string, any[]> = { S: j.arms.STRATEGY, R: j.arms.RANDOM, T: j.arms['TREND-ONLY'] };

const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a: number[]) => {
  const mu = m(a);
  return Math.sqrt(a.reduce((s, r) => s + (r - mu) ** 2, 0) / (a.length - 1) / a.length);
};
const fmt = (ts: any[]) => {
  if (ts.length < 2) return `n=${ts.length}`;
  const rs = ts.map(t => t.r ?? 0);
  const w = ts.filter(t => t.outcome === 'TP1_HIT').length;
  return `n=${String(ts.length).padStart(4)} meanR ${m(rs).toFixed(4)} ±${se(rs).toFixed(4)}  wr ${(100 * w / ts.length).toFixed(1)}%`;
};

console.log('--- meanR by entry hour UTC ---');
for (const h of [7, 8, 9, 12, 13, 14]) {
  const row = ['S', 'R', 'T'].map(k => `${k}: ${fmt(A[k].filter(t => new Date(t.openedAt).getUTCHours() === h))}`);
  console.log(`h${String(h).padStart(2)}  ${row.join('   |  ')}`);
}

console.log('\n--- meanR by symbol ---');
for (const s of ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD']) {
  const row = ['S', 'R', 'T'].map(k => `${k}: ${fmt(A[k].filter(t => t.symbol === s))}`);
  console.log(`${s}  ${row.join('   |  ')}`);
}

console.log('\n--- LIKE FOR LIKE: restrict every arm to hour 7 AND the 3 always-available pairs ---');
const top3 = new Set(['EUR/USD', 'USD/CHF', 'USD/JPY']);
for (const k of ['S', 'R', 'T']) {
  const f = A[k].filter(t => new Date(t.openedAt).getUTCHours() === 7 && top3.has(t.symbol));
  console.log(`  ${k}: ${fmt(f)}`);
}

console.log('\n--- MATCHED PAIRS: same (symbol, openedAt) in both arms ---');
const key = (t: any) => `${t.symbol}|${t.openedAt}`;
for (const other of ['R', 'T']) {
  const oMap = new Map(A[other].map(t => [key(t), t]));
  const pairs = A.S.filter(t => oMap.has(key(t))).map(t => [t, oMap.get(key(t))!] as const);
  const d = pairs.map(([a, b]) => (a.r ?? 0) - (b.r ?? 0));
  const sameDir = pairs.filter(([a, b]) => a.type === b.type).length;
  console.log(`  S vs ${other}: n=${pairs.length} sameDirection=${sameDir} (${(100 * sameDir / pairs.length).toFixed(0)}%)`);
  console.log(`     S meanR ${m(pairs.map(p => p[0].r)).toFixed(4)}   ${other} meanR ${m(pairs.map(p => p[1].r)).toFixed(4)}`);
  console.log(`     paired diff ${m(d).toFixed(4)} ± ${se(d).toFixed(4)}   t=${(m(d) / se(d)).toFixed(2)}`);
}

console.log('\n--- fills outside the kill zone (data-gap skip in `fi = idx+1`) ---');
for (const k of ['S', 'R', 'T']) {
  const bad = A[k].filter(t => {
    const d = new Date(t.openedAt);
    const h = d.getUTCHours();
    return !((h >= 7 && h < 10) || (h >= 12 && h < 15));
  });
  const offGrid = A[k].filter(t => new Date(t.openedAt).getUTCMinutes() !== 5);
  console.log(`  ${k}: outsideKZ=${bad.length}  openedAt minute!=:05 = ${offGrid.length}`);
  if (bad.length) console.log(`     ${bad.slice(0, 8).map(t => `${t.symbol}@${t.openedAt} r=${(t.r ?? 0).toFixed(2)}`).join(' ; ')}`);
  if (bad.length) console.log(`     meanR of those: ${m(bad.map(t => t.r ?? 0)).toFixed(3)}`);
}

console.log('\n--- swap exposure ---');
for (const k of ['S', 'R', 'T']) {
  const held = A[k].filter(t => (+new Date(t.closedAt) - +new Date(t.openedAt)) > 12 * 3600e3);
  console.log(`  ${k}: held>12h ${held.length}/${A[k].length}`);
}

console.log('\n--- EXPIRED trades: R distribution ---');
for (const k of ['S', 'R', 'T']) {
  const e = A[k].filter(t => t.outcome === 'EXPIRED');
  console.log(`  ${k}: n=${e.length} meanR ${m(e.map(t => t.r)).toFixed(3)}  maxMfeR ${Math.max(...e.map(t => t.mfeR)).toFixed(2)}  #withMfeR>=2 ${e.filter(t => t.mfeR >= 2).length}  #withMaeR>=1 ${e.filter(t => t.maeR >= 1).length}`);
}

console.log('\n--- STOP_HIT trades whose mfeR >= 2 (target-level excursion recorded on/before stop bar) ---');
for (const k of ['S', 'R', 'T']) {
  const s = A[k].filter(t => t.outcome === 'STOP_HIT');
  const amb = s.filter(t => t.mfeR >= 2);
  console.log(`  ${k}: STOP_HIT ${s.length}, of which mfeR>=2.0 : ${amb.length} (${(100 * amb.length / s.length).toFixed(1)}%)`);
  const flipped = A[k].map(t => (t.outcome === 'STOP_HIT' && t.mfeR >= 2 ? 1.96 : (t.r ?? 0)));
  console.log(`     meanR if every such bar resolved TARGET-first instead: ${m(flipped).toFixed(4)}  (actual ${m(A[k].map(t => t.r ?? 0)).toFixed(4)})`);
}

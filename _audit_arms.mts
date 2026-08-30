/* scratch audit — arm comparability */
import fs from 'fs';
const j = JSON.parse(fs.readFileSync('.backtest-cache/trades-primary.json', 'utf8'));

const pip = (s: string) => (s.includes('JPY') ? 0.01 : 0.0001);

function stats(name: string, ts: any[]) {
  const done = ts.filter(t => t.outcome);
  const rs = done.map(t => t.r ?? 0);
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (rs.length - 1));
  const wins = done.filter(t => t.outcome === 'TP1_HIT').length;
  const exp = done.filter(t => t.outcome === 'EXPIRED').length;
  const stop = done.filter(t => t.outcome === 'STOP_HIT').length;
  // realized R:R from geometry
  const rr = done.map(t => Math.abs(t.target - t.entry) / Math.abs(t.entry - t.stop));
  const rrs = [...rr].sort((a, b) => a - b);
  // win R and loss R
  const winR = done.filter(t => t.outcome === 'TP1_HIT').map(t => t.r);
  const lossR = done.filter(t => t.outcome === 'STOP_HIT').map(t => t.r);
  const expR = done.filter(t => t.outcome === 'EXPIRED').map(t => t.r);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  // hold time hours
  const hold = done.map(t => (+new Date(t.closedAt) - +new Date(t.openedAt)) / 3600000);
  // hour of day (UTC) of entry
  const byHour: Record<number, number> = {};
  const bySym: Record<string, number> = {};
  const byDir: Record<string, number> = {};
  for (const t of ts) {
    const h = new Date(t.openedAt).getUTCHours();
    byHour[h] = (byHour[h] ?? 0) + 1;
    bySym[t.symbol] = (bySym[t.symbol] ?? 0) + 1;
    byDir[t.type] = (byDir[t.type] ?? 0) + 1;
  }
  // stop distance in pips
  const stopPips = ts.map(t => Math.abs(t.entry - t.stop) / pip(t.symbol));
  const sp = [...stopPips].sort((a, b) => a - b);
  console.log(`\n=== ${name} ===  n=${ts.length} resolved=${done.length} unresolved=${ts.length - done.length}`);
  console.log(`  TP1 ${wins}  STOP ${stop}  EXPIRED ${exp}   winRate ${(100 * wins / done.length).toFixed(1)}%`);
  console.log(`  meanR ${mean.toFixed(4)}  sdR ${sd.toFixed(3)}  seR ${(sd / Math.sqrt(rs.length)).toFixed(4)}  t=${(mean / (sd / Math.sqrt(rs.length))).toFixed(2)}`);
  console.log(`  avg R  win ${avg(winR).toFixed(3)}  stop ${avg(lossR).toFixed(3)}  expired ${avg(expR).toFixed(3)}`);
  console.log(`  geometric R:R  min ${rrs[0].toFixed(3)} med ${rrs[rrs.length >> 1].toFixed(3)} max ${rrs[rrs.length - 1].toFixed(3)} mean ${avg(rr).toFixed(3)}`);
  console.log(`  stop dist pips  min ${sp[0].toFixed(1)} med ${sp[sp.length >> 1].toFixed(1)} p95 ${sp[Math.floor(sp.length * .95)].toFixed(1)} max ${sp[sp.length - 1].toFixed(1)}`);
  console.log(`  hold hrs  med ${[...hold].sort((a, b) => a - b)[hold.length >> 1].toFixed(1)}  mean ${avg(hold).toFixed(1)}`);
  console.log(`  entry hour UTC: ${Object.keys(byHour).sort((a, b) => +a - +b).map(h => `${h}:${byHour[+h]}`).join(' ')}`);
  console.log(`  symbols: ${Object.entries(bySym).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  dir: ${JSON.stringify(byDir)}`);
  return { mean, sd, n: rs.length };
}

const S = stats('STRATEGY', j.arms.STRATEGY);
const R = stats('RANDOM', j.arms.RANDOM);
const T = stats('TREND-ONLY', j.arms['TREND-ONLY']);

const welch = (a: any, b: any) => {
  const se = Math.sqrt(a.sd ** 2 / a.n + b.sd ** 2 / b.n);
  return (a.mean - b.mean) / se;
};
console.log(`\nWelch t  STRATEGY vs RANDOM     ${welch(S, R).toFixed(2)}`);
console.log(`Welch t  STRATEGY vs TREND-ONLY  ${welch(S, T).toFixed(2)}`);

// trades per trading-day distribution
function perDay(ts: any[]) {
  const m: Record<string, number> = {};
  for (const t of ts) {
    const d = new Date(t.openedAt).toISOString().slice(0, 10);
    m[d] = (m[d] ?? 0) + 1;
  }
  const days = Object.keys(m).length;
  const capped = Object.values(m).filter(v => v >= 3).length;
  return `days=${days} capped(>=3)=${capped} (${(100 * capped / days).toFixed(0)}%) total=${ts.length}`;
}
console.log(`\nSTRATEGY   ${perDay(j.arms.STRATEGY)}`);
console.log(`RANDOM     ${perDay(j.arms.RANDOM)}`);
console.log(`TREND-ONLY ${perDay(j.arms['TREND-ONLY'])}`);

// Overlap: how often do arms trade the same (symbol, openedAt)?
const key = (t: any) => `${t.symbol}|${t.openedAt}`;
const sSet = new Set(j.arms.STRATEGY.map(key));
const rSet = new Set(j.arms.RANDOM.map(key));
const tSet = new Set(j.arms['TREND-ONLY'].map(key));
const inter = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x)).length;
console.log(`\nshared (symbol,openedAt): S&R ${inter(sSet, rSet)}  S&T ${inter(sSet, tSet)}  R&T ${inter(rSet, tSet)}`);

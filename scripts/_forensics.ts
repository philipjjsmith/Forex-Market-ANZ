import postgres from 'postgres';

const DB = 'postgresql://postgres.bgfucdqnncvanznvcste:11Carlyrosa%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres';
const db = postgres(DB, { ssl: 'require', connect_timeout: 15 });

async function main() {

  // === QUERY A: Every production win ===
  console.log('\n=== A: ALL PRODUCTION WINS ===');
  const wins = await db`
    SELECT created_at, symbol, type, confidence, strategy_version, outcome, profit_loss_pips,
      entry_price, stop_loss, tp1,
      ROUND((ABS(entry_price-stop_loss)*10000)::numeric,1) as sl_pips,
      ROUND((ABS(tp1-entry_price)*10000)::numeric,1) as tp_pips,
      ROUND((ABS(tp1-entry_price)/NULLIF(ABS(entry_price-stop_loss),0))::numeric,2) as rr,
      ROUND((EXTRACT(epoch FROM (outcome_time - created_at))/3600)::numeric,1) as hrs_to_result
    FROM signal_history
    WHERE data_quality='production' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')
    ORDER BY created_at
  `;
  for (const w of wins) {
    console.log(`${String(w.created_at).slice(0,16)} | ${w.symbol} ${w.type} | conf=${w.confidence}% | ${w.strategy_version} | +${w.profit_loss_pips}pip | SL=${w.sl_pips}p TP=${w.tp_pips}p R:R=${w.rr} | ${w.hrs_to_result}hrs`);
  }
  console.log(`TOTAL WINS: ${wins.length}`);

  // === QUERY B: Every production loss ===
  console.log('\n=== B: ALL PRODUCTION LOSSES ===');
  const losses = await db`
    SELECT created_at, symbol, type, confidence, strategy_version, profit_loss_pips,
      entry_price, stop_loss, tp1,
      ROUND((ABS(entry_price-stop_loss)*10000)::numeric,1) as sl_pips,
      ROUND((ABS(tp1-entry_price)*10000)::numeric,1) as tp_pips,
      ROUND((EXTRACT(epoch FROM (outcome_time - created_at))/3600)::numeric,1) as hrs_to_result
    FROM signal_history
    WHERE data_quality='production' AND outcome='STOP_HIT'
    ORDER BY created_at
  `;
  for (const l of losses) {
    console.log(`${String(l.created_at).slice(0,16)} | ${l.symbol} ${l.type} | conf=${l.confidence}% | ${l.strategy_version} | ${l.profit_loss_pips}pip | SL=${l.sl_pips}p TP=${l.tp_pips}p | ${l.hrs_to_result}hrs`);
  }
  console.log(`TOTAL LOSSES: ${losses.length}`);

  // === QUERY C: 85-94 bracket detail (THE PROFITABLE ZONE) ===
  console.log('\n=== C: 85-94 CONFIDENCE BRACKET (the profitable zone) ===');
  const bracket = await db`
    SELECT created_at, symbol, type, confidence, strategy_version, outcome, profit_loss_pips,
      ROUND((ABS(entry_price-stop_loss)*10000)::numeric,1) as sl_pips,
      entry_price, stop_loss, tp1
    FROM signal_history
    WHERE data_quality='production' AND confidence >= 85 AND confidence < 95
    ORDER BY created_at
  `;
  for (const b of bracket) {
    console.log(`${String(b.created_at).slice(0,16)} | ${b.symbol} ${b.type} | ${b.confidence}% | ${b.strategy_version} | ${b.outcome} | ${b.profit_loss_pips}pip | SL=${b.sl_pips}p`);
  }
  const w85 = bracket.filter(b => ['TP1_HIT','TP2_HIT','TP3_HIT'].includes(b.outcome as string)).length;
  const l85 = bracket.filter(b => b.outcome === 'STOP_HIT').length;
  console.log(`85-94 BRACKET: ${w85}W / ${l85}L = ${(100*w85/(w85+l85)).toFixed(1)}% WR`);

  // === QUERY D: Signals per day - dedup analysis ===
  console.log('\n=== D: SIGNALS PER DAY (production) ===');
  const daily = await db`
    SELECT
      DATE(created_at) as d,
      COUNT(*) as n,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome='STOP_HIT') as losses,
      COUNT(*) FILTER (WHERE outcome='EXPIRED') as expired,
      COUNT(DISTINCT ROUND(entry_price::numeric,5)) as distinct_entries,
      STRING_AGG(DISTINCT symbol||' '||type, ', ') as pairs
    FROM signal_history
    WHERE data_quality='production'
    GROUP BY DATE(created_at)
    ORDER BY d
  `;
  for (const d of daily) {
    const dup = Number(d.n) > Number(d.distinct_entries) ? ' ⚠️DUPS' : '';
    console.log(`${d.d} | ${d.n} signals | ${d.wins}W ${d.losses}L ${d.expired}EXP | entries:${d.distinct_entries}${dup} | ${d.pairs}`);
  }

  // === QUERY E: Entry price uniqueness (are duplicates same price?) ===
  console.log('\n=== E: DUPLICATE ENTRY DETECTION ===');
  const dups = await db`
    SELECT DATE(created_at) as d, symbol, type,
      COUNT(*) as total_signals,
      COUNT(DISTINCT ROUND(entry_price::numeric,5)) as distinct_prices,
      MIN(entry_price) as min_ep, MAX(entry_price) as max_ep,
      MIN(stop_loss) as min_sl, MAX(stop_loss) as max_sl,
      STRING_AGG(outcome, ',' ORDER BY created_at) as outcomes,
      STRING_AGG(ROUND(entry_price::numeric,5)::text, ',' ORDER BY created_at) as entries
    FROM signal_history
    WHERE data_quality='production'
    GROUP BY DATE(created_at), symbol, type
    HAVING COUNT(*) > 2
    ORDER BY d DESC
  `;
  for (const d of dups) {
    console.log(`${d.d} ${d.symbol} ${d.type}: ${d.total_signals} signals, ${d.distinct_prices} distinct entries | entries: ${d.entries} | outcomes: ${d.outcomes}`);
  }

  // === QUERY F: Nov 17 week detail ===
  console.log('\n=== F: NOV 17, 2025 WEEK (claimed 100% WR) ===');
  const nov17 = await db`
    SELECT DATE_TRUNC('hour',created_at) as hr, COUNT(*) as n,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
      COUNT(DISTINCT ROUND(entry_price::numeric,5)) as distinct_entries,
      STRING_AGG(DISTINCT symbol||' '||type, ', ') as pair,
      STRING_AGG(outcome, ',' ORDER BY created_at) as outcomes
    FROM signal_history
    WHERE data_quality='production'
      AND created_at >= '2025-11-17' AND created_at < '2025-11-24'
    GROUP BY DATE_TRUNC('hour',created_at)
    ORDER BY hr
  `;
  for (const r of nov17) {
    console.log(`${String(r.hr).slice(0,16)} | ${r.n} sigs | ${r.wins}W | ${r.distinct_entries} distinct prices | ${r.pair} | ${r.outcomes}`);
  }

  // === QUERY G: SL distance by symbol/version ===
  console.log('\n=== G: AVG SL DISTANCE BY SYMBOL + VERSION ===');
  const sl = await db`
    SELECT symbol, type, strategy_version,
      COUNT(*) as n,
      ROUND(AVG(ABS(entry_price-stop_loss)*10000)::numeric,1) as avg_sl_pips,
      ROUND(MIN(ABS(entry_price-stop_loss)*10000)::numeric,1) as min_sl_pips,
      ROUND(MAX(ABS(entry_price-stop_loss)*10000)::numeric,1) as max_sl_pips,
      ROUND(AVG(ABS(tp1-entry_price)*10000)::numeric,1) as avg_tp_pips,
      ROUND(AVG(ABS(tp1-entry_price)/NULLIF(ABS(entry_price-stop_loss),0))::numeric,2) as avg_rr,
      COUNT(*) FILTER (WHERE outcome='STOP_HIT') as l,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as w
    FROM signal_history
    WHERE data_quality='production'
    GROUP BY symbol, type, strategy_version
    ORDER BY symbol, type, strategy_version DESC
  `;
  for (const s of sl) {
    console.log(`${s.symbol} ${s.type} ${s.strategy_version} | n=${s.n} | SL avg=${s.avg_sl_pips}p (${s.min_sl_pips}-${s.max_sl_pips}) | TP=${s.avg_tp_pips}p | R:R=${s.avg_rr} | ${s.w}W/${s.l}L`);
  }

  // === QUERY H: Were the wins clustered (same trade repeated)? ===
  console.log('\n=== H: WIN CLUSTERING ANALYSIS ===');
  const winCluster = await db`
    SELECT DATE(created_at) as d, symbol, type,
      COUNT(*) as wins_that_day,
      COUNT(DISTINCT ROUND(entry_price::numeric,5)) as distinct_entries,
      STRING_AGG(confidence::text, ',' ORDER BY created_at) as confs,
      STRING_AGG(ROUND(entry_price::numeric,5)::text, ',' ORDER BY created_at) as prices,
      ROUND(AVG(profit_loss_pips)::numeric,1) as avg_pips
    FROM signal_history
    WHERE data_quality='production' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')
    GROUP BY DATE(created_at), symbol, type
    ORDER BY wins_that_day DESC
  `;
  for (const c of winCluster) {
    console.log(`${c.d} ${c.symbol} ${c.type}: ${c.wins_that_day} wins | ${c.distinct_entries} distinct entries | prices: ${c.prices} | confs: ${c.confs} | avg +${c.avg_pips}pip`);
  }

  // === QUERY I: True deduplicated performance ===
  console.log('\n=== I: DE-DUPLICATED PERFORMANCE (1 signal per symbol per day) ===');
  const dedup = await db`
    WITH deduped AS (
      SELECT DISTINCT ON (DATE(created_at), symbol, type)
        created_at, symbol, type, confidence, strategy_version, outcome, profit_loss_pips
      FROM signal_history
      WHERE data_quality='production'
      ORDER BY DATE(created_at), symbol, type, created_at ASC
    )
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome='STOP_HIT') as losses,
      COUNT(*) FILTER (WHERE outcome='EXPIRED') as expired,
      ROUND(100.0*COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT'))/
        NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0),2) as wr,
      COALESCE(SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0)::int as net_pips
    FROM deduped
  `;
  console.log('DEDUPED (1st signal per symbol/day only):', JSON.stringify(dedup[0]));

  // === QUERY J: Deduped by version ===
  const dedupVer = await db`
    WITH deduped AS (
      SELECT DISTINCT ON (DATE(created_at), symbol, type)
        created_at, symbol, type, confidence, strategy_version, outcome, profit_loss_pips
      FROM signal_history
      WHERE data_quality='production'
      ORDER BY DATE(created_at), symbol, type, created_at ASC
    )
    SELECT strategy_version,
      COUNT(*) as n,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as w,
      COUNT(*) FILTER (WHERE outcome='STOP_HIT') as l,
      ROUND(100.0*COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT'))/
        NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT')),0),1) as wr,
      SUM(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT','STOP_HIT'))::int as pips
    FROM deduped
    GROUP BY strategy_version ORDER BY strategy_version DESC
  `;
  console.log('DEDUPED BY VERSION:');
  for (const v of dedupVer) console.log(' ', v.strategy_version, 'n='+v.n, 'W:'+v.w+'/L:'+v.l, 'WR:'+v.wr+'%', 'pips:'+v.pips);

  await db.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

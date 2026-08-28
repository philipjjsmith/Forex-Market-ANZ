/**
 * FEASIBILITY PROBE — can we replay history through the REAL analyze()?
 *
 * This answers one question before any backtester is built: if we feed analyze() the exact
 * candle history that existed at a past moment, does it reproduce the signal the live system
 * actually generated at that moment?
 *
 * If YES, a backtest is trustworthy — it runs the deployed strategy, not a lookalike. That is
 * precisely where the existing backtester failed: it simulated a plain MA crossover that was
 * never deployed, so every "approved parameter" it produced described a strategy nobody ran.
 *
 * If NO, we must find out why BEFORE trusting any backtested number.
 *
 * Read-only. USAGE: npx tsx scripts/probe-backtest-feasibility.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { MACrossoverStrategy } from '../server/services/signal-generator';
import { twelveDataAPI } from '../server/services/twelve-data';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

(async () => {
  // Take a real signal the live system produced, and try to reproduce it.
  const target: any = (await sql`
    SELECT signal_id, symbol, type, confidence, entry_price, stop_loss, tp1,
           created_at, strategy_version
    FROM signal_history
    WHERE data_quality='production' AND strategy_version='3.3.0'
    ORDER BY created_at DESC LIMIT 1`)[0];

  if (!target) { console.error('no v3.3.0 signal found'); process.exit(1); }

  const asOf = new Date(target.created_at);
  console.log('TARGET SIGNAL (produced live by v3.3.0)');
  console.log(`  ${target.symbol} ${target.type} conf=${target.confidence} @ ${asOf.toISOString()}`);
  console.log(`  entry=${target.entry_price} sl=${target.stop_loss} tp1=${target.tp1}\n`);

  // Fetch generously, then slice to what existed AT asOf. The slice is the anti-look-ahead
  // guarantee: analyze() can only ever see bars that had already closed.
  console.log('Fetching history and slicing to as-of...');
  const [wk, dy, h4, h1] = await Promise.all([
    twelveDataAPI.fetchHistoricalCandles(target.symbol, '1week', 300),
    twelveDataAPI.fetchHistoricalCandles(target.symbol, '1day', 800),
    twelveDataAPI.fetchHistoricalCandles(target.symbol, '4h', 2000),
    twelveDataAPI.fetchHistoricalCandles(target.symbol, '1h', 5000),
  ]);

  const upTo = (arr: any[]) => arr.filter(c => new Date(c.timestamp).getTime() <= asOf.getTime());
  const wkS = upTo(wk), dyS = upTo(dy), h4S = upTo(h4), h1S = upTo(h1);

  console.log(`  weekly ${wk.length} -> ${wkS.length} as-of   (analyze needs >= 26)`);
  console.log(`  daily  ${dy.length} -> ${dyS.length} as-of   (needs >= 50)`);
  console.log(`  4h     ${h4.length} -> ${h4S.length} as-of   (needs >= 50)`);
  console.log(`  1h     ${h1.length} -> ${h1S.length} as-of   (needs >= 100)`);

  const enough = wkS.length >= 26 && dyS.length >= 50 && h4S.length >= 50 && h1S.length >= 100;
  if (!enough) {
    console.log('\n❌ Not enough as-of history at this date — a backtest would need deeper fetches.');
    await sql.end({ timeout: 5 }); return;
  }

  console.log('\nCalling the REAL analyze() with as-of slices...');
  const strategy = new MACrossoverStrategy();
  // asOf + injected params: the whole point of the refactor. Without asOf, session and news
  // are scored against TODAY's clock rather than the moment being replayed.
  // BUG-COMPATIBLE MODE: feed exactly what the live code fetches — 52 weekly bars.
  // The live generator calls fetchHistoricalCandles(symbol,'1week',52). EMA(50) cannot
  // converge from 52 points (92% seed retention), so `weeklyTrend` is really a ~9-month
  // mean — an EXTENSION gauge, not a trend. Feeding 100+ weekly bars changes confidence by
  // 10 points on this very signal. To reproduce history we must reproduce the inputs.
  const produced = await strategy.analyze(wkS.slice(-52), dyS, h4S, h1S.slice(-1440), target.symbol, {
    asOf,
    approvedParams: null,   // strategy_adaptations is empty in production; defaults 20/50
  });

  if (!produced) {
    console.log('\n⚠️  analyze() returned NULL — no signal reproduced.');
    console.log('   Possible causes, in order of likelihood:');
    console.log('     1. session scoring uses wall-clock (new Date()), so the kill-zone/session');
    console.log('        gate evaluates against TODAY, not the as-of moment — the known live bug');
    console.log('     2. bar alignment: the live run saw a partially-formed candle we exclude');
    console.log('     3. approved-parameter lookup differs');
    console.log('\n   => the asOf refactor is a HARD PREREQUISITE, as expected.');
  } else {
    console.log('\n✅ analyze() produced a signal:');
    console.log(`   ${produced.symbol} ${produced.type} conf=${produced.confidence}`);
    console.log(`   entry=${produced.entry} sl=${produced.stopLoss ?? produced.stop} tp1=${produced.takeProfit1 ?? produced.tp1}`);
    console.log('\n   vs LIVE:');
    console.log(`   ${target.symbol} ${target.type} conf=${target.confidence}`);
    const dirMatch = produced.type === target.type;
    const confDelta = Math.abs(Number(produced.confidence) - Number(target.confidence));
    console.log(`\n   direction match: ${dirMatch ? '✅' : '❌'}   confidence delta: ${confDelta}`);
    console.log(confDelta === 0 && dirMatch
      ? '   🎯 EXACT reproduction — a backtest would faithfully run the deployed strategy.'
      : '   ⚠️  Close but not exact. Investigate before trusting backtested numbers.');
  }

  await sql.end({ timeout: 5 });
  process.exit(0);
})();

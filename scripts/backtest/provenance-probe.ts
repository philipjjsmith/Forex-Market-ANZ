/**
 * Provenance probe — seeds `signal_provenance` from the real analysis path, with NO side effects.
 *
 * Runs the identical fetch + analyze() that `generateSignals()` runs (same intervals, same
 * outputsize, same strategy instance), records the exact inputs, and stops there. It never
 * calls trackSignal, Telegram, or the cTrader executor, so it is safe to run at any time and
 * while UptimeRobot is paused.
 *
 * Why this exists: the reproduction gate cannot be settled against historical signals, whose
 * inputs were never logged. It CAN be settled against signals whose inputs we record from now
 * on. Running this on a schedule accumulates that evidence quickly instead of waiting for live
 * signals to fire — and because it logs did-not-fire bars too, it also builds the confusion
 * matrix arm the gate needs.
 *
 * Quota: 4 calls per symbol, nearly always served from cache. Safe to run frequently.
 *
 * USAGE: npx tsx scripts/backtest/provenance-probe.ts
 */
import 'dotenv/config';
import { MACrossoverStrategy } from '../../server/services/signal-generator';
import { twelveDataAPI, TwelveDataAPI } from '../../server/services/twelve-data';
import { recordAnalysis } from '../../server/services/provenance';
import { db } from '../../server/db';
import { sql } from 'drizzle-orm';

const SYMBOLS = ['EUR/USD', 'USD/CHF', 'USD/JPY', 'GBP/USD', 'AUD/USD'];

/**
 * Kill zones: 07:00-09:59 and 12:00-14:59 UTC — the only hours generateSignals() trades.
 *
 * The probe shares cache keys with production (same symbol/interval/outputsize), so a probe run
 * inside a kill zone could warm the cache and change which snapshot production then analyses.
 * That would make the probe an observer that alters what it observes. With `--avoid-kill-zones`
 * it stands down and lets production own those hours; production records its own provenance.
 *
 * Checked in UTC so it is correct regardless of machine timezone or DST.
 */
function inKillZone(d = new Date()): boolean {
  const h = d.getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

(async () => {
  if (process.argv.includes('--avoid-kill-zones') && inKillZone()) {
    console.log(`${new Date().toISOString()} — inside a kill zone; standing down so production owns the cache.`);
    process.exit(0);
  }

  const strategy = new MACrossoverStrategy();
  let fired = 0, recorded = 0;

  for (const symbol of SYMBOLS) {
    try {
      // EXACTLY the sizes generateSignals() requests — the array length is load-bearing:
      // ema() seeds from the SMA of the first `period` elements, so weekly EMA(50) over 52
      // candles is worth a measured 10 confidence points versus a converged one.
      const [weekly, daily, fourHour, oneHour] = await Promise.all([
        twelveDataAPI.fetchHistoricalCandles(symbol, '1week', 52),
        twelveDataAPI.fetchHistoricalCandles(symbol, '1day', 200),
        twelveDataAPI.fetchHistoricalCandles(symbol, '4h', 360),
        twelveDataAPI.fetchHistoricalCandles(symbol, '1h', 1440),
      ]);

      if (!weekly?.length || !daily?.length || !fourHour?.length || !oneHour?.length) {
        console.log(`  ${symbol.padEnd(8)} skipped — incomplete data`);
        continue;
      }

      const analyzedAt = new Date();
      const trace: string[] = [];
      const signal = await strategy.analyze(
        weekly, daily, fourHour, oneHour, symbol, { asOf: analyzedAt, trace }
      );

      await recordAnalysis({
        analyzedAt, symbol, strategyVersion: strategy.version,
        produced: !!signal,
        confidence: signal?.confidence ?? null,
        rejectionReason: signal ? null : (trace[0] ?? 'UNKNOWN'),
        series: { weekly, daily, fourHour, oneHour },
      });
      recorded++;
      if (signal) fired++;

      const meta = TwelveDataAPI.getFetchMeta(symbol, '1h', 1440);
      console.log(
        `  ${symbol.padEnd(8)} ${signal ? `FIRED conf=${signal.confidence}` : `no signal — ${(trace[0] ?? 'UNKNOWN').slice(0, 52)}`}` +
        `   [1h ${meta ? `${meta.source} ${meta.ageMinutes}min` : 'meta?'}]`
      );
    } catch (err) {
      console.error(`  ${symbol.padEnd(8)} ERROR:`, err instanceof Error ? err.message : err);
    }
  }

  const [{ n }]: any = await db.execute(sql`SELECT count(*)::int AS n FROM signal_provenance`);
  console.log(`\nrecorded ${recorded} attempt(s) this run (${fired} fired). signal_provenance now holds ${n} row(s).`);
  process.exit(0);
})();

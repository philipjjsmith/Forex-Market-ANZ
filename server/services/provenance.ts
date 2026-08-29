/**
 * Signal input provenance.
 *
 * Records exactly what each `analyze()` call consumed, so a replay can be PROVEN identical
 * rather than argued to be close.
 *
 * The problem this closes: the reproduction gate could only reach 80-85% because production
 * logged the result of an analysis but never its inputs. Two signals 23 hours apart once
 * carried byte-identical indicators (a stale 1H cache served twice), the Twelve Data cache key
 * omitted `outputsize` until 5895423, and the fetcher falls back to UNBOUNDED stale cache on
 * HTTP 429. Given only `created_at` — which is the INSERT time, not the analysis time — the
 * inputs were unrecoverable.
 *
 * Every field here exists to answer one question: "can I rebuild the exact array that produced
 * this signal?" The sha256 makes that a yes/no, not a judgement call.
 *
 * Writes must never break signal generation: all failures are swallowed and logged.
 */
import { createHash } from 'crypto';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { TwelveDataAPI } from './twelve-data';

interface Candle {
  timestamp: Date | string;
  open: number; high: number; low: number; close: number; volume?: number;
}

export interface SeriesFingerprint {
  count: number;
  firstTs: string | null;
  lastTs: string | null;
  last: { o: number; h: number; l: number; c: number } | null;
  /** Hash of the FULL array, including the still-forming final bar. */
  sha256: string;
  /**
   * Hash EXCLUDING the final bar.
   *
   * Twelve Data returns the current, still-forming bar. A replay that fetches history
   * later receives that same period COMPLETED, so the full-array hash can never match
   * on the last bar — not because the replay is wrong, but because the bar finished.
   * Hashing the closed bars separately makes "did the replay rebuild the same history?"
   * answerable exactly, and leaves `last` as the independent check on forming-bar
   * reconstruction.
   */
  sha256ExclLast: string;
}

/** Record separator for the hash input. Defined this way to keep the literal escape-free. */
const NL = String.fromCharCode(10);

const iso = (t: Date | string) => (t instanceof Date ? t.toISOString() : new Date(t).toISOString());

/**
 * Fingerprint an ordered candle array.
 *
 * The hash covers timestamp+OHLC of every bar in order. Volume is excluded deliberately: Twelve
 * Data synthesises it for forex (the fetcher defaults it to 1000), so including it would make
 * the hash depend on a value no indicator reads.
 */
export function describeSeries(candles: Candle[] | null | undefined): SeriesFingerprint {
  if (!candles || candles.length === 0) {
    return { count: 0, firstTs: null, lastTs: null, last: null, sha256: '', sha256ExclLast: '' };
  }
  const h = createHash('sha256');
  const hx = createHash('sha256');
  candles.forEach((c, i) => {
    const line = `${iso(c.timestamp)}|${c.open}|${c.high}|${c.low}|${c.close}${NL}`;
    h.update(line);
    if (i < candles.length - 1) hx.update(line);
  });
  const last = candles[candles.length - 1];
  return {
    count: candles.length,
    firstTs: iso(candles[0].timestamp),
    lastTs: iso(last.timestamp),
    last: { o: last.open, h: last.high, l: last.low, c: last.close },
    sha256: h.digest('hex'),
    sha256ExclLast: hx.digest('hex'),
  };
}

/** The exact series sizes generateSignals() requests. Used to look up cache metadata. */
const REQUESTED = { weekly: ['1week', 52], daily: ['1day', 200], fourHour: ['4h', 360], oneHour: ['1h', 1440] } as const;

export interface AnalysisProvenance {
  analyzedAt: Date;
  symbol: string;
  strategyVersion: string;
  produced: boolean;
  signalId?: string | null;
  confidence?: number | null;
  rejectionReason?: string | null;
  series: { weekly: Candle[]; daily: Candle[]; fourHour: Candle[]; oneHour: Candle[] };
}

/**
 * Persist one analysis attempt — fired or not.
 *
 * Recording the did-not-fire bars is the point: `signal_history` holds only the fires, which is
 * half a confusion matrix. The backtest gate needs the false-positive arm.
 */
export async function recordAnalysis(p: AnalysisProvenance): Promise<void> {
  try {
    const inputs = {
      weekly: describeSeries(p.series.weekly),
      daily: describeSeries(p.series.daily),
      fourHour: describeSeries(p.series.fourHour),
      oneHour: describeSeries(p.series.oneHour),
    };

    const cacheMeta: Record<string, unknown> = {};
    for (const [name, [interval, size]] of Object.entries(REQUESTED)) {
      cacheMeta[name] = TwelveDataAPI.getFetchMeta(p.symbol, interval as string, size as number);
    }

    await db.execute(sql`
      INSERT INTO signal_provenance
        (analyzed_at, symbol, strategy_version, produced, signal_id, confidence, rejection_reason, inputs, cache_meta)
      VALUES (
        ${p.analyzedAt.toISOString()}, ${p.symbol}, ${p.strategyVersion}, ${p.produced},
        ${p.signalId ?? null}, ${p.confidence ?? null}, ${p.rejectionReason ?? null},
        ${JSON.stringify(inputs)}::jsonb, ${JSON.stringify(cacheMeta)}::jsonb
      )
    `);
  } catch (err) {
    // Never let provenance failure block a trade signal.
    console.error(`⚠️  provenance write failed for ${p.symbol}:`, err instanceof Error ? err.message : err);
  }
}

/** Attach a signal_id once the signal row has been persisted. */
export async function linkProvenanceToSignal(analyzedAt: Date, symbol: string, signalId: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE signal_provenance SET signal_id = ${signalId}
      WHERE symbol = ${symbol} AND analyzed_at = ${analyzedAt.toISOString()} AND signal_id IS NULL
    `);
  } catch (err) {
    console.error(`⚠️  provenance link failed for ${symbol}:`, err instanceof Error ? err.message : err);
  }
}

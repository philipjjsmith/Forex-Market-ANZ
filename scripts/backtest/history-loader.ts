/**
 * Paginated historical candle loader with on-disk caching.
 *
 * Twelve Data caps a single response at 5000 bars, so any multi-year 5-minute range must be
 * fetched in windows and stitched. 5000 five-minute bars ≈ 17 calendar days; 5000 1H bars
 * ≈ 209 days.
 *
 * WHY 5-MINUTE DATA IS REQUIRED (not optional)
 * --------------------------------------------
 * Production reads `currentPrice` as the last 1H close — and that bar is the FORMING one
 * (signal-generator.ts:651). At asOf 07:10 production saw the 07:00 bar holding ten minutes
 * of data. A backtest handed the COMPLETED 07:00-08:00 bar computes different ADX/RSI/ATR off
 * that tail. Measured on a real signal: ADX 19.52 vs the stored 25.27, which falls below the
 * mandatory ADX>=25 gate and silently deletes the signal entirely.
 *
 * So the forming 1H bar must be rebuilt from 5-minute data, and 5-minute data must therefore
 * span the whole backtest window.
 *
 * Results are cached to disk so a re-run costs no API quota.
 */
import fs from 'fs';
import path from 'path';
import type { Bar } from './candle-slicer';

const CACHE_DIR = path.resolve('.backtest-cache');
const RATE_LIMIT_MS = 8100;          // free tier enforces 8s between calls
const MAX_BARS = 5000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

function parseUTC(s: string): Date {
  const t = s.trim().replace(' ', 'T');
  const hasZone = /[Zz]$/.test(t) || /[+-]\d{2}:?\d{2}$/.test(t);
  const iso = hasZone ? t : (t.length <= 10 ? `${t}T00:00:00Z` : `${t}Z`);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable datetime: "${s}"`);
  return d;
}

/** Approximate bar duration, used only to size pagination windows. */
const STEP_MS: Record<string, number> = {
  '5min': 300_000, '15min': 900_000, '1h': 3_600_000,
  '4h': 14_400_000, '1day': 86_400_000, '1week': 604_800_000,
};

async function fetchWindow(symbol: string, interval: string, from: Date, to: Date): Promise<Bar[]> {
  const key = process.env.TWELVE_DATA_KEY;
  if (!key) throw new Error('TWELVE_DATA_KEY not set');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}`
    + `&interval=${interval}&start_date=${encodeURIComponent(fmt(from))}`
    + `&end_date=${encodeURIComponent(fmt(to))}`
    + `&timezone=UTC&order=asc&outputsize=${MAX_BARS}&apikey=${key}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  if (data.status === 'error') {
    if (/no data/i.test(data.message || '')) return [];
    throw new Error(data.message);
  }
  return (data.values || []).map((v: any) => ({
    timestamp: parseUTC(v.datetime),
    open: +v.open, high: +v.high, low: +v.low, close: +v.close,
    volume: v.volume ? +v.volume : 0,
  }));
}

/**
 * Load a full range, paginating and caching. Cache key includes the range, so widening the
 * window re-fetches rather than silently returning a short series.
 */
export async function loadHistory(
  symbol: string, interval: string, from: Date, to: Date
): Promise<Bar[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const slug = `${symbol.replace('/', '')}-${interval}-${fmt(from).slice(0, 10)}-${fmt(to).slice(0, 10)}.json`;
  const cacheFile = path.join(CACHE_DIR, slug);

  if (fs.existsSync(cacheFile)) {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return raw.map((b: any) => ({ ...b, timestamp: new Date(b.timestamp) }));
  }

  const step = STEP_MS[interval] ?? 3_600_000;
  const windowMs = step * (MAX_BARS - 50);      // margin so a window never truncates
  const out: Bar[] = [];
  let cursor = new Date(from);
  let calls = 0;

  while (cursor < to) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + windowMs, to.getTime()));
    let bars: Bar[] = [];
    try {
      bars = await fetchWindow(symbol, interval, cursor, chunkEnd);
    } catch (e: any) {
      console.warn(`  ⚠️  ${symbol} ${interval} ${fmt(cursor).slice(0, 10)}: ${e.message.slice(0, 60)}`);
    }
    calls++;
    out.push(...bars);
    process.stdout.write(`\r  ${symbol} ${interval}: ${out.length} bars (${calls} calls)   `);
    cursor = chunkEnd;
    if (cursor < to) await sleep(RATE_LIMIT_MS);
  }
  process.stdout.write('\n');

  // De-duplicate on timestamp — pagination boundaries can overlap — and sort ascending.
  const seen = new Map<number, Bar>();
  for (const b of out) seen.set(b.timestamp.getTime(), b);
  const merged = [...seen.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  fs.writeFileSync(cacheFile, JSON.stringify(merged));
  return merged;
}

/** Estimate API calls for a plan, so quota can be checked BEFORE spending it. */
export function estimateCalls(interval: string, from: Date, to: Date): number {
  const step = STEP_MS[interval] ?? 3_600_000;
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (step * (MAX_BARS - 50))));
}

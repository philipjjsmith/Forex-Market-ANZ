/**
 * Build higher-timeframe series from Dukascopy 5-minute bars.
 *
 * The backtest holds only m5 data (Amendment 2), so 1H / 4H / daily / weekly must be
 * constructed. The boundaries follow the FOREX convention, not the calendar:
 *
 *   the trading day and week both roll at 17:00 NEW YORK
 *
 * That is 21:00 UTC under EDT and 22:00 UTC under EST, which is exactly why it is expressed in
 * New York time — a hardcoded UTC hour is wrong for about five months a year, a mistake already
 * made once in this codebase (see server/services/twelve-data.ts isMarketClosed).
 *
 * Aggregating on calendar-midnight UTC instead would split the Sydney/Tokyo session across two
 * "days" and put Sunday's opening hours in the same daily bar as Friday's close — changing
 * `dailyTrend`, which is a HARD GATE in analyze().
 *
 * THE ROLL HOUR IS 17:00 NY AND WAS NOT TUNED. Swept against Twelve Data's daily grid, median
 * absolute error summed over OHLC came out 15:00 NY = 5.10 pips, 17:00 = 5.65, 16:00 = 6.60,
 * 18:00 = 6.45, 19:00 = 8.90 — flat, with no sharp minimum. A genuinely wrong roll hour would
 * show a clear V. High and low sit at 0.50 / 0.80 pips at EVERY candidate, which is what
 * confirms the aggregation itself is sound; only open and close move, and they are the two
 * values a boundary shift touches.
 *
 * The residual gap is Twelve Data's, not ours: TD builds its daily bars from the continuous 24/7
 * series whose market-closed bars are fabricated (§A2.4), so its Monday open partly derives from
 * invented Sunday prices while ours derives from the real Sunday 17:00 open. No roll hour
 * removes that. 15:00 NY "wins" the sweep and is nonetheless wrong — it is not the forex
 * convention, and minimising error against a reference proven to contain fabricated bars is
 * fitting to noise. The convention is kept.
 *
 * BAR LABELLING: every bar is stamped with its TRUE OPEN time.
 *
 * Twelve Data instead labels a daily bar with 00:00 UTC on the date it ends, which is why
 * candle-slicer needs inferOpenSkewMs() to recover the offset before deciding which bar was
 * still forming. Stamping the real open here makes that skew zero by construction, so the
 * slicer has nothing to infer and cannot infer it wrongly. The cost is that these timestamps do
 * not line up with Twelve Data's daily grid — align by tradingDay() when comparing the two.
 */
import type { Bar } from './candle-slicer';

export interface Ohlc {
  timestamp: Date;
  open: number; high: number; low: number; close: number; volume: number;
}

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', weekday: 'short', hour12: false,
});
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function nyParts(d: Date) {
  const p = NY.formatToParts(d);
  const get = (t: string) => p.find(x => x.type === t)!.value;
  return {
    y: +get('year'), m: +get('month'), d: +get('day'),
    hour: +get('hour') % 24,          // Intl renders midnight as "24" under hour12:false
    dow: DOW[get('weekday')],
  };
}

/**
 * The forex trading date a bar belongs to, as YYYYMMDD.
 *
 * A bar at or after 17:00 New York belongs to the NEXT trading day — that is the roll. Returning
 * the day the bar ENDS in matches Twelve Data's daily labelling.
 */
export function tradingDay(d: Date): number {
  const n = nyParts(d);
  let { y, m, d: day } = n;
  if (n.hour >= 17) {
    const t = new Date(Date.UTC(y, m - 1, day));
    t.setUTCDate(t.getUTCDate() + 1);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; day = t.getUTCDate();
  }
  return y * 10000 + m * 100 + day;
}

function fold(bars: Ohlc[], keyOf: (d: Date) => string | number): Ohlc[] {
  const out: Ohlc[] = [];
  let cur: Ohlc | null = null;
  let curKey: string | number | null = null;
  for (const b of bars) {
    const k = keyOf(b.timestamp);
    if (cur === null || k !== curKey) {
      if (cur) out.push(cur);
      curKey = k;
      cur = { timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Clock-hour buckets. 1H needs no forex-day alignment because hours nest inside the roll. */
export const toHourly = (m5: Ohlc[]) =>
  fold(m5, d => Math.floor(d.getTime() / 3_600_000));

/**
 * 4H buckets anchored to the 17:00 NY roll, NOT to UTC midnight.
 *
 * Anchoring to UTC would drift against the session by an hour each DST change and would not line
 * up with Twelve Data's 4H grid, whose bars open at the roll (21:00 UTC in summer).
 */
export const toFourHour = (m5: Ohlc[]) =>
  fold(m5, d => {
    const n = nyParts(d);
    const hoursSinceRoll = (n.hour - 17 + 24) % 24;
    return `${tradingDay(d)}-${Math.floor(hoursSinceRoll / 4)}`;
  });

/** Daily bars on the 17:00 NY roll, labelled by the day they end (Twelve Data's convention). */
export const toDaily = (m5: Ohlc[]) => fold(m5, tradingDay);

/**
 * Weekly bars. The forex week runs Sunday 17:00 NY to Friday 17:00 NY, so bars are grouped by
 * the trading day of the week's Monday — derived from the trading day, never from the raw UTC
 * date, so the Sunday-evening open lands in the correct week.
 */
export const toWeekly = (m5: Ohlc[]) =>
  fold(m5, d => {
    const td = tradingDay(d);
    const y = Math.floor(td / 10000), m = Math.floor(td / 100) % 100, day = td % 100;
    const dt = new Date(Date.UTC(y, m - 1, day));
    const dow = dt.getUTCDay();                       // trading day 0=Sun..6=Sat
    const back = dow === 0 ? 6 : dow - 1;             // rewind to Monday
    dt.setUTCDate(dt.getUTCDate() - back);
    return dt.getTime();
  });

/** Convert to the Bar shape the slicer and strategy expect. */
export const asBars = (o: Ohlc[]): Bar[] => o as unknown as Bar[];

export function buildTimeframes(m5: Ohlc[]) {
  return { m5, h1: toHourly(m5), h4: toFourHour(m5), d1: toDaily(m5), w1: toWeekly(m5) };
}

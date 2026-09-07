/**
 * Render a signal as an annotated PNG.
 *
 * WHY WE DRAW OUR OWN
 *
 * TradingView's terms licence their charts for "exclusive display-only use" and explicitly prohibit
 * machine-driven processes, "creating products or services based on TradingView content", and any
 * distribution of their content "for any form of compensation" — and the same clause names
 * third-party services "designed to facilitate or enable" that, so routing through a snapshot API
 * does not launder it. The cTrader Open API has no rendering message at all; all ~90 of its Protobuf
 * messages are data and trading. So the only defensible pixels are our own.
 *
 * That is also the better engineering answer: the candles are ALREADY in memory at the call site, so
 * a chart costs zero extra Twelve Data calls against an 800/day budget, and the ICT detectors return
 * exact price levels which a generic charting API would force us to re-express as anonymous boxes.
 *
 * SIZED AND COLOURED FOR A PHONE UNDER JPEG
 *
 * Telegram resizes photos so the longest side is 1280 and re-encodes JPEG at ~80-87%. At 1280 wide
 * we are exactly at that cap, so nothing is resampled — but the feed still renders the bubble at
 * roughly 300-330dp, which on a 3x device is ~900-990px, about 0.75x. Measured on the first draft:
 * 11px labels were unreadable. Everything here is >= 15px and the important type is 24-44px.
 *
 * JPEG 4:2:0 stores chroma at half resolution in both axes, and the red-difference channel degrades
 * first — so saturated red text on a dark ground fringes badly. Every label is therefore WHITE TEXT
 * ON A FILLED CHIP: a chip is a large flat area that survives compression, a thin coloured glyph is
 * not. Lines are never 1px; key levels are 3px.
 *
 * 3:2 rather than 16:9, because a phone shows the image at bubble width and a wide aspect renders
 * SHORT — 1280x854 buys ~18% more vertical space than 1280x720 for the same candle count.
 *
 * Telegram overlays a translucent time/checkmark pill on the BOTTOM-RIGHT of photo messages, so
 * nothing load-bearing goes there. The demo label and the thesis live bottom-LEFT for that reason.
 *
 * IT MUST FAIL LOUDLY, NOT QUIETLY
 *
 * An earlier version accepted a NaN entry and rendered a plausible 29KB chart with the entry line
 * simply missing. A chart that silently omits a level is worse than no chart, because the reader
 * takes what is shown for the whole picture. Everything is validated up front and anything unusable
 * throws, so the caller degrades to a text-only signal.
 *
 * NOTHING HERE IS A PERFORMANCE CLAIM. This renders the setup as it stood at signal time, with the
 * levels committed to before the outcome was known. A chart drawn AFTER the move showing where a
 * system "would have" entered is hypothetical performance in a costume. Rendering prospectively is
 * the honest case — and the timestamp is what makes that checkable.
 */
/**
 * TYPE-ONLY at module scope, on purpose — the binding is loaded on first render instead.
 *
 * `npm run build` bundles the server with `--packages=external`, so a static import of this
 * package stays a real top-level import in dist/index.js and its native binary is resolved at
 * BOOT. @napi-rs/canvas ships one prebuilt binary per platform as an optional dependency, so an
 * install that prunes optional deps, or a musl-based image, would take down signal generation,
 * broker execution and every alert — the whole trading server — because a picture could not be
 * drawn. Deferring it means a missing binary costs exactly the charts and nothing else.
 */
import type { SKRSContext2D } from '@napi-rs/canvas';

export interface ChartCandle {
  /** ISO timestamp of the bar open. */
  t: string;
  o: number; h: number; l: number; c: number;
}

export interface ChartZone {
  low: number;
  high: number;
  label: string;
  /** Optional midpoint, drawn dashed (an FVG's consequent encroachment). */
  mid?: number;
}

export interface SignalChartInput {
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  tier: string;
  signalNumber?: number;
  /** Entry-timeframe bars, oldest first. The last bar is the signal bar. */
  candles: ChartCandle[];
  /**
   * Higher-timeframe bars for the CONTEXT panel on the left.
   *
   * 1280px is Telegram's hard cap, so horizontal space is fixed and more entry candles can only
   * be bought by making them thinner — measured, 140 bars puts the pitch at 5.6px against a
   * 12-18px readable floor, which undoes the legibility work. A second panel on a slower
   * timeframe buys calendar history without touching the entry candles at all.
   *
   * Both panels share ONE price scale. Separate scales would put the same price at two different
   * heights, so a level line spanning the divider would be a lie. Measured on real data the 4H
   * range is only 19-39% wider than the 1H range over these windows, so one scale costs little.
   */
  contextCandles?: ChartCandle[];
  contextTimeframe?: string;
  fvg?: ChartZone;
  orderBlock?: ChartZone;
  sweepLevel?: number;
  /** The generator's own higher-timeframe read, e.g. "W:UP D:UP 4H:UP". */
  htfTrend?: string;
  /** One line of thesis for the notes panel. Composed from the zones when absent. */
  thesis?: string;
  asOf?: Date;
  /** Bar interval label for the header, e.g. "1H". */
  timeframe?: string;
}

/**
 * Palette.
 *
 * #089981 / #f23645 are what TradingView and LuxAlgo render TODAY. The older Material pair
 * (#26a69a / #ef5350) is the Lightweight-Charts default and is what a first draft used — but it is
 * a generation behind what readers actually see, and less compression-stable.
 *
 * Zone hues follow Smart Money Concepts [LuxAlgo], the #1 indicator on TradingView, which means a
 * large share of ICT-literate readers have these exact colours burned in: ORDER BLOCKS ARE BLUE,
 * FVGs are green/red by direction. A first draft had that inverted.
 */
const C = {
  bg:         '#131722',
  card:       '#2a2e39',
  panel:      '#1a1e29',
  grid:       '#1e222d',
  axisText:   '#787b86',
  text:       '#d1d4dc',
  head:       '#ffffff',
  bull:       '#089981',
  bear:       '#f23645',
  entry:      '#d1d4dc',
  last:       '#787b86',
  riskFill:   'rgba(242, 54, 69, 0.18)',
  rewardFill: 'rgba(8, 153, 129, 0.18)',
  fvgBull:    'rgba(8, 153, 129, 0.22)',
  fvgBear:    'rgba(242, 54, 69, 0.22)',
  obFill:     'rgba(49, 121, 245, 0.20)',
  obLine:     '#3179f5',
  sweep:      '#b2b5be',
  chipText:   '#ffffff',
};

const W = 1280, H = 854;
const PAD = { top: 84, right: 132, bottom: 96, left: 22 };
/** Empty space right of the last candle, where the position projects. ~68% candles / 32% forward. */
const FORWARD = 0.24;
/**
 * Share of the candle area given to the higher-timeframe context panel.
 *
 * The context panel deliberately runs a thinner pitch than the entry panel. It is read for SHAPE
 * -- where this setup sits in the larger move -- not for individual candles, so it does not need
 * the 12-18px readable pitch the entry panel does.
 */
const CONTEXT = 0.34;
const PLOT = {
  x0: PAD.left, y0: PAD.top,
  x1: W - PAD.right, y1: H - PAD.bottom,
  get w() { return this.x1 - this.x0; },
  get h() { return this.y1 - this.y0; },
};

// Every size survives a ~0.75x feed render. Below ~15px is decorative and will not be read.
const F = {
  symbol: 'bold 42px sans-serif',
  dir:    'bold 30px sans-serif',
  sub:    '22px sans-serif',
  num:    'bold 20px sans-serif',
  tag:    'bold 26px sans-serif',
  chip:   'bold 22px sans-serif',
  rr:     'bold 32px sans-serif',
  axis:   '17px sans-serif',
  note:   '19px sans-serif',
  foot:   '16px sans-serif',
};
const CHIP_H = 34;

const dp   = (s: string) => (s.includes('JPY') ? 3 : 5);
const pipf = (s: string) => (s.includes('JPY') ? 100 : 10000);

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/** White text on a filled chip — the only label form that survives JPEG chroma subsampling. */
function chip(ctx: SKRSContext2D, x: number, y: number, text: string, fill: string, font = F.chip) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y - CHIP_H / 2, w, CHIP_H, 5);
  ctx.fill();
  ctx.fillStyle = C.chipText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 11, y + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

function assertFinite(name: string, v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`renderSignalChart: ${name} is not a finite number (${v})`);
  }
  return v;
}

export async function renderSignalChart(input: SignalChartInput): Promise<Buffer> {
  const { candles } = input;
  if (!Array.isArray(candles) || candles.length < 5) {
    throw new Error(`renderSignalChart needs at least 5 candles, got ${candles?.length ?? 0}`);
  }

  // VALIDATE BEFORE DRAWING — see the header note on failing loudly.
  assertFinite('entry', input.entry);
  assertFinite('stop', input.stop);
  assertFinite('target', input.target);
  if (input.sweepLevel !== undefined) assertFinite('sweepLevel', input.sweepLevel);
  if (Math.abs(input.entry - input.stop) < Number.EPSILON) {
    throw new Error('renderSignalChart: entry and stop are identical — no risk to draw');
  }
  for (const z of [input.fvg, input.orderBlock]) {
    if (!z) continue;
    assertFinite(`zone "${z.label}".low`, z.low);
    assertFinite(`zone "${z.label}".high`, z.high);
    if (z.low > z.high) throw new Error(`renderSignalChart: zone "${z.label}" has low > high`);
  }
  candles.forEach((k, i) => {
    for (const f of ['o', 'h', 'l', 'c'] as const) assertFinite(`candle[${i}].${f}`, k[f]);
  });
  (input.contextCandles ?? []).forEach((k, i) => {
    for (const f of ['o', 'h', 'l', 'c'] as const) assertFinite(`contextCandle[${i}].${f}`, k[f]);
  });

  const digits = dp(input.symbol);
  const pf     = pipf(input.symbol);
  const px     = (v: number) => v.toFixed(digits);
  const long   = input.type === 'LONG';
  const lastClose = candles[candles.length - 1].c;

  // ── Scale ─────────────────────────────────────────────────────────────────
  const ctx4 = input.contextCandles ?? [];
  const marks = [
    ...candles.map(c => c.h), ...candles.map(c => c.l),
    ...ctx4.map(c => c.h), ...ctx4.map(c => c.l),
    input.entry, input.stop, input.target,
    ...(input.fvg ? [input.fvg.low, input.fvg.high] : []),
    ...(input.orderBlock ? [input.orderBlock.low, input.orderBlock.high] : []),
    ...(input.sweepLevel !== undefined ? [input.sweepLevel] : []),
  ];
  let lo = Math.min(...marks), hi = Math.max(...marks);
  const span = (hi - lo) || Math.pow(10, -digits) * 10;
  lo -= span * 0.07; hi += span * 0.07;

  const yOf = (p: number) => PLOT.y1 - ((p - lo) / (hi - lo)) * PLOT.h;
  const candleW = PLOT.w * (1 - FORWARD);
  const xFwd = PLOT.x0 + candleW;
  const hasCtx = ctx4.length >= 5;
  const ctxW   = hasCtx ? candleW * CONTEXT : 0;
  const xSplit = PLOT.x0 + ctxW;                 // divider between context and entry panels
  const entW   = candleW - ctxW;
  const stepC  = hasCtx ? ctxW / ctx4.length : 0;
  const step   = entW / candles.length;
  const xOfC = (i: number) => PLOT.x0 + i * stepC + stepC / 2;
  const xOf  = (i: number) => xSplit + i * step + step / 2;

  // Loaded here, not at module scope. See the note on the import.
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Faint centred symbol — chart provenance in TradingView's own idiom, not self-promotion.
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = C.head;
  ctx.font = 'bold 130px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(input.symbol.replace('/', ''), PLOT.x0 + candleW / 2, PLOT.y0 + PLOT.h / 2 + 40);
  ctx.restore();

  // ── Price axis. Level bands are reserved so a gridline number never collides with a tag. ──
  const reserved = [input.entry, input.stop, input.target,
    ...(input.sweepLevel !== undefined ? [input.sweepLevel] : [])].map(yOf);

  /** Gridline prices, drawn after the level tags so a DISPLACED tag cannot be printed over. */
  const gridLabels: { p: number; y: number }[] = [];
  ctx.font = F.axis;
  ctx.textBaseline = 'middle';
  const rawStep = (hi - lo) / 6;
  const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  for (let p = Math.ceil(lo / niceStep) * niceStep; p <= hi; p += niceStep) {
    const y = yOf(p);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 2;   // never 1px; it becomes mush under JPEG
    ctx.beginPath(); ctx.moveTo(PLOT.x0, y); ctx.lineTo(PLOT.x1, y); ctx.stroke();
    if (reserved.some(r => Math.abs(r - y) < CHIP_H)) continue;
    gridLabels.push({ p, y });
  }

  // ── Time axis ─────────────────────────────────────────────────────────────
  ctx.fillStyle = C.axisText; ctx.font = F.axis; ctx.textAlign = 'center';
  /**
   * Spans already occupied along the time axis, SHARED between the two panels.
   *
   * A tick near a panel edge gets clamped inward to stay on the plot, and clamping is what
   * causes the collision: on a real delivered chart the context panel's first label was pushed
   * right into its second and rendered as "26/08 13:0(/09 09:00". Two dates fused into one
   * unreadable string is worse than one date, so a label that would overlap is DROPPED rather
   * than drawn — the axis is a reference, and a missing tick still leaves the neighbours
   * readable. Shared across both panels because the entry panel's first tick sits just past the
   * divider and can reach back into the context panel's last.
   */
  const timeSpans: { a: number; b: number }[] = [];
  const timeTicks = (set: ChartCandle[], xf: (i: number) => number, want: number) => {
    const every = Math.max(1, Math.floor(set.length / want));
    for (let i = 0; i < set.length; i += every) {
      const d = new Date(set[i].t);
      if (Number.isNaN(d.getTime())) continue;
      const label = `${String(d.getUTCDate()).padStart(2, '0')}/` +
        `${String(d.getUTCMonth() + 1).padStart(2, '0')} ` +
        `${String(d.getUTCHours()).padStart(2, '0')}:00`;
      const half = ctx.measureText(label).width / 2;
      const x = Math.min(Math.max(xf(i), PLOT.x0 + half), PLOT.x1 - half);
      const a = x - half - 10, b = x + half + 10;          // 10px breathing room each side
      if (timeSpans.some(sp => a < sp.b && b > sp.a)) continue;
      timeSpans.push({ a, b });
      ctx.fillText(label, x, PLOT.y1 + 26);
    }
  };
  if (hasCtx) timeTicks(ctx4, xOfC, 2);
  timeTicks(candles, xOf, 3);
  ctx.textBaseline = 'alphabetic';

  // ── Zones, under the candles ──────────────────────────────────────────────
  // Chip rows already claimed, so two zones at similar prices do not overprint each other.
  /** Zone labels, held back and painted after the level lines. See the note in drawZone. */
  const zoneChips: { y: number; label: string; fill: string }[] = [];
  const zoneRows: number[] = [];
  const claimRow = (y: number) => {
    let v = y;
    for (let g = 0; g < 20 && zoneRows.some(u => Math.abs(u - v) < CHIP_H + 3); g++) v -= CHIP_H + 3;
    zoneRows.push(v);
    return v;
  };
  const drawZone = (z: ChartZone, fill: string, border: string | null, midColour?: string) => {
    const yh = yOf(z.high), yl = yOf(z.low);
    ctx.fillStyle = fill;
    ctx.fillRect(PLOT.x0, yh, candleW, Math.max(3, yl - yh));
    if (border) {
      ctx.strokeStyle = border; ctx.lineWidth = 2;
      ctx.strokeRect(PLOT.x0, yh, candleW, Math.max(3, yl - yh));
    }
    if (z.mid !== undefined && Number.isFinite(z.mid)) {
      ctx.strokeStyle = midColour ?? border ?? C.axisText;
      ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(PLOT.x0, yOf(z.mid)); ctx.lineTo(xFwd, yOf(z.mid)); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Chip on the zone's TOP edge. Centring them put the FVG and the order block within a few
    // pixels of each other, and the FVG is drawn second — so it painted over the OB's label
    // entirely and that zone looked unlabelled.
    //
    // DEFERRED, not drawn here. Zone fills belong under the candles, but their LABELS do not:
    // the level lines span the full plot width and are drawn after this block, so an entry sitting
    // a few pixels from a thin FVG's top edge ruled a dashed line straight through the middle of
    // its chip. Struck-through text reads as a rendering fault, and on a tight stop the entry and
    // the FVG are near each other by construction. The row is still claimed now, so the ordering
    // that keeps two zone labels apart is unchanged.
    zoneChips.push({ y: claimRow(yh - 4), label: z.label, fill: border ?? C.panel });
  };
  // Order block first so the FVG (usually the tighter zone) sits on top.
  if (input.orderBlock) drawZone(input.orderBlock, C.obFill, C.obLine);
  if (input.fvg)        drawZone(input.fvg, long ? C.fvgBull : C.fvgBear, null,
                                 long ? C.bull : C.bear);

  // ── Position projection ───────────────────────────────────────────────────
  const yEntry = yOf(input.entry), yStop = yOf(input.stop), yTgt = yOf(input.target);
  const fwdW = PLOT.x1 - xFwd;
  ctx.fillStyle = C.riskFill;
  ctx.fillRect(xFwd, Math.min(yEntry, yStop), fwdW, Math.abs(yStop - yEntry));
  ctx.fillStyle = C.rewardFill;
  ctx.fillRect(xFwd, Math.min(yEntry, yTgt), fwdW, Math.abs(yTgt - yEntry));
  // Borders at full opacity: TradingView's own default is borderless, which is fine on a crisp
  // screen but smears at 18% alpha after JPEG.
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.bear;  ctx.strokeRect(xFwd, Math.min(yEntry, yStop), fwdW, Math.abs(yStop - yEntry));
  ctx.strokeStyle = C.bull;  ctx.strokeRect(xFwd, Math.min(yEntry, yTgt),  fwdW, Math.abs(yTgt  - yEntry));

  const rr = Math.abs(input.target - input.entry) / Math.abs(input.entry - input.stop);
  ctx.font = F.rr; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = C.bull; ctx.fillText(`${rr.toFixed(1)}R`, xFwd + fwdW / 2, (yEntry + yTgt) / 2);
  ctx.fillStyle = C.bear; ctx.fillText('1R',                 xFwd + fwdW / 2, (yEntry + yStop) / 2);
  ctx.textBaseline = 'alphabetic';

  // ── Candles ───────────────────────────────────────────────────────────────
  const paintCandles = (
    set: ChartCandle[], xf: (i: number) => number, pitch: number, alpha = 1,
  ) => {
    const bw = Math.max(3, pitch * 0.66);
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < set.length; i++) {
      const k = set[i];
      const col = k.c >= k.o ? C.bull : C.bear;
      const x = xf(i);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, Math.min(3, pitch * 0.16));   // never 1px
      ctx.beginPath(); ctx.moveTo(x, yOf(k.h)); ctx.lineTo(x, yOf(k.l)); ctx.stroke();
      const yo = yOf(k.o), yc = yOf(k.c);
      ctx.fillStyle = col;
      ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1.5, Math.abs(yc - yo)));
    }
    ctx.restore();
  };

  // Context panel first, slightly muted so the eye lands on the entry panel. It is there to show
  // WHERE this setup sits in the larger move, not to be read candle by candle.
  if (hasCtx) paintCandles(ctx4, xOfC, stepC, 0.62);
  paintCandles(candles, xOf, step, 1);

  // Divider + panel labels, so nobody mistakes one timeframe for the other.
  if (hasCtx) {
    ctx.strokeStyle = C.card; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(xSplit, PLOT.y0); ctx.lineTo(xSplit, PLOT.y1); ctx.stroke();
    ctx.font = F.foot; ctx.fillStyle = C.axisText;
    ctx.textAlign = 'left';
    ctx.fillText(`${input.contextTimeframe ?? '4H'} CONTEXT`, PLOT.x0 + 8, PLOT.y0 + 20);
    ctx.fillText(`${input.timeframe ?? '1H'} ENTRY`, xSplit + 10, PLOT.y0 + 20);
  }

  // ── Levels ────────────────────────────────────────────────────────────────
  /**
   * Keep labels off each other — for the name chips AND the gutter price tags, which had none.
   *
   * Measured on a real USD/CHF signal: a swept level at 0.81180 sat 14px from a take profit at
   * 0.81140, so the tag drawn second covered four of the five digits of the tag drawn first. An
   * unreadable price is bad; a HALF-readable one is worse, because it still looks like a number.
   *
   * It takes the NEAREST free slot, searching both ways. Downward-only was the earlier behaviour
   * and it pushes a displaced label ACROSS the level it belongs to and out the far side — which is
   * how the swept-level chip ended up on top of the "2.0R" in the reward box. Committing to one
   * direction is not enough either: on a real USD/JPY short a swept level 8px from the entry was
   * pushed 111px upward, past the stop loss, leaving the gutter reading 155.800 / 156.330 / 155.737
   * top to bottom. Out of price order, a column of prices invites exactly the misreading it exists
   * to prevent. The nearest slot was 45px the other way and keeps the order intact.
   *
   * Each caller keeps its own claimed-row list, so a gutter tag and a name chip at the same height
   * do not push each other around — they are in different columns and cannot collide.
   */
  const avoid = (claimed: number[]) => (y: number) => {
    const step = CHIP_H + 3;
    const free = (v: number) => !claimed.some(u => Math.abs(u - v) < step);
    let v = y;
    if (!free(y)) {
      let up = y, down = y;
      for (let g = 0; g < 24 && !free(up);   g++) up   -= step;
      for (let g = 0; g < 24 && !free(down); g++) down += step;
      v = (y - up) <= (down - y) ? up : down;
    }
    claimed.push(v);
    return Math.min(Math.max(v, CHIP_H), H - CHIP_H);
  };
  /**
   * Name chips in the forward space — pre-claiming the two R-multiple labels.
   *
   * "1R" and "2.0R" are drawn in that same column, centred in the risk and reward boxes, and
   * nothing knew they were there: a displaced chip landed straight on top of the reward figure.
   * They are already-drawn content in this column, so they claim their rows like anything else.
   */
  const placeY   = avoid([(yEntry + yTgt) / 2, (yEntry + yStop) / 2]);
  /** Price tags in the right-hand gutter. Kept, so the gridline prices can dodge where they LANDED. */
  const tagRows: number[] = [];
  const placeTag = avoid(tagRows);

  const level = (price: number, colour: string, label: string, dashed: boolean, weight: number) => {
    const y = yOf(price);
    ctx.strokeStyle = colour; ctx.lineWidth = weight;
    ctx.setLineDash(dashed ? [10, 7] : []);
    ctx.beginPath(); ctx.moveTo(PLOT.x0, y); ctx.lineTo(PLOT.x1, y); ctx.stroke();
    ctx.setLineDash([]);
    // Price tag in the gutter — the number is what readers actually take away.
    const ty = placeTag(y);
    ctx.font = F.tag;
    ctx.fillStyle = colour;
    roundRect(ctx, PLOT.x1 + 5, ty - CHIP_H / 2, PAD.right - 14, CHIP_H, 5); ctx.fill();
    ctx.fillStyle = C.chipText;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(px(price), PLOT.x1 + 13, ty + 1);
    ctx.textBaseline = 'alphabetic';
    // A displaced tag gets a leader back to its own line, so it can never be read against the
    // neighbouring one. Nothing is drawn when it sits where it belongs.
    if (Math.abs(ty - y) > 1) {
      ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PLOT.x1 + 2, y); ctx.lineTo(PLOT.x1 + 5, ty); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Name chip in the forward space, nudged clear of its neighbours.
    chip(ctx, xFwd + 10, placeY(y), label, colour);
  };

  const stopPips = Math.abs(input.entry - input.stop) * pf;
  const tgtPips  = Math.abs(input.target - input.entry) * pf;

  // ORDER IS PRIORITY, NOT Z-ORDER: whichever is drawn first keeps its true position, and later
  // ones are displaced around it. The three levels that define the trade claim their own places;
  // the swept level is context and is the one that gives way. Drawn the other way round — as it
  // was — a contextual grey tag held the spot and pushed the take profit 37px off its own line.
  level(input.entry,  C.entry, 'ENTRY',                        true,  2);
  level(input.target, C.bull,  `TP · ${tgtPips.toFixed(1)}p`,  false, 3);
  level(input.stop,   C.bear,  `SL · ${stopPips.toFixed(1)}p`, false, 3);
  if (input.sweepLevel !== undefined) level(input.sweepLevel, C.sweep, 'LIQUIDITY SWEPT', true, 2);

  // Zone labels after the level lines, so none can be ruled through one.
  for (const z of zoneChips) chip(ctx, PLOT.x0 + 10, z.y, z.label, z.fill);

  // Gridline prices last of all, skipping any row a level tag actually LANDED on.
  //
  // The `reserved` list built before drawing only knew the levels' TRUE positions. A tag nudged
  // clear of its neighbour can come to rest on a gridline number that was never reserved — which
  // is exactly what happened on the first chart this system ever delivered, where 0.80750 printed
  // through underneath the displaced swept-level tag.
  ctx.font = F.axis; ctx.fillStyle = C.axisText;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const g of gridLabels) {
    if (tagRows.some(t => Math.abs(t - g.y) < CHIP_H)) continue;
    ctx.fillText(px(g.p), PLOT.x1 + 12, g.y);
  }
  ctx.textBaseline = 'alphabetic';

  // Current price, only when meaningfully away from entry — on a limit order that gap IS the story.
  if (Math.abs(lastClose - input.entry) * pf > 0.5) {
    const y = yOf(lastClose);
    ctx.strokeStyle = C.last; ctx.lineWidth = 2; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(PLOT.x0, y); ctx.lineTo(PLOT.x1, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = F.axis; ctx.fillStyle = C.last;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(px(lastClose), PLOT.x1 + 13, y);
    ctx.textBaseline = 'alphabetic';
  }

  // ── Notes panel, bottom-LEFT ──────────────────────────────────────────────
  // Bottom-right is where Telegram paints its translucent time/checkmark pill, so nothing
  // load-bearing goes there — and the demo label is load-bearing.
  const thesis = input.thesis ?? ([
    input.sweepLevel !== undefined ? 'Liquidity swept' : null,
    input.orderBlock ? 'order block' : null,
    input.fvg ? 'FVG entry at CE' : null,
  ].filter(Boolean).join(' > ') || `${input.type} trend continuation`);

  const noteLines = [
    thesis,
    `Risk ${stopPips.toFixed(1)}p · Reward ${tgtPips.toFixed(1)}p · ${rr.toFixed(1)}R`,
    'DEMO — SIMULATED · not investment advice',
  ];
  ctx.font = F.note;
  const noteW = Math.max(...noteLines.map(l => ctx.measureText(l).width)) + 34;
  const noteH = noteLines.length * 27 + 22;
  const nx = (hasCtx ? xSplit : PLOT.x0) + 14, ny = PLOT.y1 - noteH - 14;
  ctx.fillStyle = 'rgba(19, 23, 34, 0.88)';
  roundRect(ctx, nx, ny, noteW, noteH, 6); ctx.fill();
  ctx.strokeStyle = C.card; ctx.lineWidth = 2;
  roundRect(ctx, nx, ny, noteW, noteH, 6); ctx.stroke();
  ctx.textAlign = 'left';
  noteLines.forEach((l, i) => {
    ctx.fillStyle = i === noteLines.length - 1 ? C.axisText : C.text;
    ctx.font = i === noteLines.length - 1 ? F.foot : F.note;
    ctx.fillText(l, nx + 17, ny + 30 + i * 27);
  });

  // ── Header ────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.panel;
  ctx.fillRect(0, 0, W, PAD.top - 12);
  ctx.textAlign = 'left';

  ctx.fillStyle = C.head; ctx.font = F.symbol;
  ctx.fillText(input.symbol, 24, 52);
  let cx = 24 + ctx.measureText(input.symbol).width + 20;

  ctx.fillStyle = long ? C.bull : C.bear; ctx.font = F.dir;
  ctx.fillText(long ? 'LONG' : 'SHORT', cx, 51);
  cx += ctx.measureText(long ? 'LONG' : 'SHORT').width + 22;

  ctx.fillStyle = C.axisText; ctx.font = F.sub;
  const sub = `${input.timeframe ?? '1H'} · ${input.tier} ${input.confidence}/135`;
  ctx.fillText(sub, cx, 50);
  cx += ctx.measureText(sub).width + 24;

  // THE THREE-TIMEFRAME READ — the strategy's core claim, previously absent from the picture.
  if (input.htfTrend) {
    for (const part of input.htfTrend.split('|')[0].trim().split(/\s+/)) {
      const [tf, dirn] = part.split(':');
      if (!tf || !dirn) continue;
      const up = dirn.toUpperCase().startsWith('U');
      ctx.font = F.sub; ctx.fillStyle = C.axisText;
      ctx.fillText(tf, cx, 50); cx += ctx.measureText(tf).width + 4;
      // A drawn triangle, not a glyph: the arrow characters came out as tofu boxes.
      ctx.fillStyle = up ? C.bull : C.bear;
      ctx.beginPath();
      if (up) { ctx.moveTo(cx + 7, 36); ctx.lineTo(cx + 14, 50); ctx.lineTo(cx, 50); }
      else    { ctx.moveTo(cx + 7, 50); ctx.lineTo(cx + 14, 36); ctx.lineTo(cx, 36); }
      ctx.closePath(); ctx.fill();
      cx += 14 + 16;
    }
  }

  const asOf = input.asOf ?? new Date();
  ctx.fillStyle = C.axisText; ctx.font = F.num; ctx.textAlign = 'right';
  ctx.fillText(
    `${input.signalNumber ? `SIGNAL #${input.signalNumber}   ` : ''}` +
    `${asOf.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    W - 24, 50);

  // ── Card border, so the image reads as a card in a light Telegram theme too ──
  ctx.strokeStyle = C.card; ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return canvas.toBuffer('image/png');
}

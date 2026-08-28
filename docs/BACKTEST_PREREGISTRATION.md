# Backtest Pre-Registration — ArgoFX

**Committed 2026-08-28, BEFORE any backtest result exists.**

This document exists so the success and failure criteria cannot be adjusted after the numbers
are known. Its value is entirely in its timestamp. If any rule below is changed, the change
must be a separate commit with a stated reason, leaving the original visible in history.

Decisions confirmed by Philip Smith, 2026-08-28.

---

## 1. Why this exists

The prior record was measured by a validator that fabricated losses: a full replay showed
**131 of 306 recorded outcomes were wrong**, asymmetrically (37 recorded losses were actually
wins, 2 the reverse). After correction the deduplicated record is **24W/43L = 35.8%,
+57.2 pips over 71 trades**, against a breakeven of **37.6%** implied by the measured 1.66:1
R:R. Expectancy is **−0.079R per trade before costs**.

~70 trades cannot support parameter selection. A real 5-percentage-point effect needs roughly
1,300 trades per arm; best-of-9 selection on 49 trades manufactures ~9.7pp of apparent
improvement from pure noise. The backtest exists to obtain a sample large enough to answer one
question — *does this strategy have a positive expectancy net of costs?* — and for no other
purpose.

## 2. The hypothesis under test

**H₀ (null): ArgoFX v3.3.0 has expectancy ≤ 0 net of costs.**
**H₁: expectancy > 0 net of costs.**

We expect to fail to reject H₀. That is stated in advance deliberately.

## 3. KILL CRITERION

> **If the primary window shows expectancy < 0 net of costs, with a 95% confidence interval
> excluding zero, development of this strategy stops.**

"Net of costs" means after spread and swap/rollover, using the fill model in §6. Stopping means
no further parameter work, no execution work, and no funded account. It does not forbid
starting a different strategy.

## 4. Windows — fixed before any result

| Window | Period | Role |
|---|---|---|
| **Primary** | **2024-08 → 2026-08** | **The only window that produces a go/no-go.** Regime-relevant, ~420 trades expected. |
| Secondary | 2022-08 → 2024-08 | **VETO-ONLY.** May kill the system; may never confirm it. A strategy that works only through the 2022 Fed-hiking / EUR-USD-parity leg has found the Fed, not an edge. |
| Pooled | 2022-08 → 2026-08 | Exactly ONE pre-registered test: is expectancy ≥ 0 net of costs? Nothing else. |

5-minute data depth will be verified **per pair** before the window is fixed. Trades that
cannot be resolved are reported as an explicit `UNRESOLVABLE` category and never silently
dropped — they are not missing at random, being the oldest, in one regime, on one pair.

## 5. Variants — at most 3, named now

1. **Baseline** — v3.3.0 exactly as deployed, including the weekly EMA(50)-from-52-candles
   defect. This is the control.
2. **Weekly fix** — 300 weekly candles so EMA(50) converges. Measured worth 10 confidence
   points on a real signal, which crosses the MEDIUM/HIGH tier boundary.
3. **Reserved** — to be named in writing before it is run.

**Control arms** (not variants; they calibrate the result):
- **Random entry** — identical kill zones, cooldown, 1.5×ATR stop, 3.0×ATR TP, 48h expiry, costs.
- **Trend-only** — every signal where Daily+4H align, ignoring FVG/order blocks/sweeps and the score.

If the strategy does not beat both control arms, the ICT machinery is not contributing and the
result is a property of the stop/target structure and kill-zone timing.

## 6. Fill and cost model — fixed before any result

- **Market fill at the next bar's open, plus spread.** Signals are labelled "Buy Limit" but
  both executors send MARKET orders, and the stated entry is measurably 5–8 pips stale. A limit
  at the current price fills only if price ticks against the signal, so booking the immediate
  favourable move as a fill is how limit-entry backtests invent edges.
- **Spread** per symbol, configurable, defaulting to 1.0 pip EUR/USD; 1.5 USD/CHF and GBP/USD;
  1.2 USD/JPY; 1.3 AUD/USD. To be replaced with The5ers' observed spreads when available.
- **Swap/rollover** modelled — a 48h expiry crosses at least one 17:00 NY rollover, triple on
  Wednesdays.
- Costs are computed **first**, not as a refinement. On a 12–15 pip stop a 1.0-pip spread is
  ~0.077R per trade, against a measured −0.079R expectancy: **spread alone roughly doubles the
  deficit.**

## 7. Statistics

- **Block bootstrap over calendar time** (cluster-resample by date), never i.i.d. EUR/USD and
  USD/CHF are ~−0.9 correlated and four pairs share the USD leg; simultaneous signals are one
  bet booked several times. Effective sample on ~840 trades is realistically 400–500.
- **Anchored walk-forward**, not a single split. **Purged and embargoed folds** sized to the
  48h expiry *and* the cooldown horizon, since entries are serially dependent.
- **Deflated Sharpe with an honest trial count of N ≥ 15**, not 3. Every parameter already
  chosen by looking at this data counts: the pair set (chosen 2026-08-28), 20/50 EMA, ADX 25,
  the ATR multiples, the `MIN_SL_PIPS` floors, the RSI range, FVG lookback, kill-zone hours,
  confidence ≥ 70, HIGH ≥ 90, the cooldown, the 48h expiry.
- **R:R is reported as a distribution per pair per year, never a mean.** `MIN_SL_PIPS` has no
  AUD/USD entry and falls through to 8 pips, so the floor binds more often on a low-ATR pair —
  making R:R a function of volatility regime.

## 8. Per-cell reporting is for honesty, not decisions

Per-year, per-regime and per-pair cells will be reported. **No cell may drive a parameter
change, a pair drop, or a regime filter.** ~840 trades across ~20 cells is ~40 per cell,
SE ≈ 7.7pp — the nine-arm selection problem with better manners. Without this rule, per-cell
reporting silently undoes the variant cap in §5.

## 9. Reproduction gate — the harness must earn trust first

The harness is not trusted until it reproduces signals the live system actually produced.

**Population:** 29 deduplicated v3.3.0 production signals (17 USD/CHF, 12 EUR/USD),
2026-04-20 → 2026-08-27. A pre-registered **30% holdout** (9 signals) is set aside; the harness
is developed against the remaining 20 and the holdout is run **once**.

**Pass conditions:**

| Check | Bar |
|---|---|
| `htfTrend` string exact | **100%** — non-negotiable; a mismatch means candle slicing is wrong |
| Direction on matched signals | 100% |
| Fired / did-not-fire per bar | **Confusion matrix.** False-positive rate < 20% within kill zones |
| Structural confidence (rationale minus session/news) | exact on ≥ 90% |
| `atr` | within 2% |
| Entry | within **0.15R** on ≥ 90% — measured in R, not pips |

Total confidence is a **summary**, not a criterion: a sum hides cancellation.

**Entry price is excluded from pass/fail.** The live system entered on a stale cached close
(measured 5–8 pips off), which is a known production defect, not a harness fault.

**Exclusion rules (anti-loophole):**
1. Exclusions must be written down before the reconciliation runs.
2. Total exclusions capped at **10%**. Exceeding it is a **failure**, not a filter.
3. No exclusion may reference outcome, confidence, or whether the signal reproduced.
4. The excluded set's distribution (pair, hour, confidence, outcome) is published alongside
   the included set. If they differ materially, the exclusion is selection.

**If the gate fails**, the decision is made now: **fix the harness.** Not loosen the gate, and
not proceed with a documented error.

## 10. Known irreducible limits

- Per-timeframe cache staleness (1h 30m, 4h 2h, 1day 4h, 1week 6h TTL; unbounded on HTTP 429).
  A live signal was computed on a mixture of snapshots from anywhere in [T−6h, T], and that
  mixture was never logged.
- Twelve Data historical revisions.
- Signals before 2026-04-18 (v3.0–v3.2) are out of scope by construction.

## 11. What this design does NOT claim

It is methodologically above retail and prop-firm standard. It is **not** a guarantee the
strategy works. The most probable outcome is a rigorous negative. A backtester that can only
confirm hope is worthless; this one is built to deliver bad news cleanly.

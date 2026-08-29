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

---

# AMENDMENT 1 — reproduction gate re-specification

**Committed 2026-08-29, BEFORE any backtest result exists.** No expectancy, win-rate, or
per-cell number has been computed at the time of writing. The §3 kill criterion is UNCHANGED.

§7 requires that any rule change be a separate commit with a stated reason, leaving the
original visible. The original §9 stands above, unedited.

## A1.1 What was found

The §9 gate required `htfTrend` to reproduce at **100%**. It reaches **85% (17/20)**. §9 said
the response to failure is "fix the harness." That instruction assumed the harness was the only
thing that could be wrong. The evidence says otherwise.

Three independent findings:

1. **Signals 2026-05-11T08:09 and 2026-05-12T07:02 (USD/CHF) carry byte-identical stored
   indicator blobs**, 23 hours apart (`adx=44.54`, `rsi=59.90`, whole JSON identical). Live
   market data cannot produce this. Production served a **stale cached 1H snapshot across two
   calendar days**.
2. **The Twelve Data cache key was `${symbol}-${interval}`, omitting `outputsize`**, until
   commit `5895423` (2026-08-26). Every signal in this population was generated under the
   colliding key, and `twelve-data.ts` falls back to **unbounded** stale cache on HTTP 429.
3. For the three failing signals, **no snapshot offset from 0 to 168 hours, at any 1H array
   length from 100 to 5000 bars, reproduces the stored ADX jointly with RSI.** The stale
   snapshot's *content* is not recoverable from Twelve Data's present history.

This is the limit §10 already named: *"a live signal was computed on a mixture of snapshots
from anywhere in [T−6h, T], and that mixture was never logged."* §9 set a gate that §10 had
already declared unachievable. That is the defect being corrected.

## A1.2 What is NOT being done, and why

**The three failures are not excluded.** §9's anti-loophole rule 3 forbids any exclusion that
references whether a signal reproduced — and these were identified *precisely* by failing to
reproduce. Production logged no independent marker for cache staleness, so no non-circular
exclusion rule exists. Inventing one would be selection wearing a rule's clothing.

They are therefore **counted as failures** below, not filtered out.

## A1.3 Declared nuisance parameter: snapshot-time recovery

`created_at` is the **DB insert time**, not the analysis time; the two differ by pipeline and
Telegram-send latency. Measured best-fit offsets on reproducing signals: `0,0,0,0,1,1,1,1,2,2,
3,5,5,8,15,15,16` minutes (median 2, mean 4.4).

The harness therefore searches `asOf` over a bounded window and selects the offset minimising
**joint input error across ADX, RSI and ATR**. Declared properties:

- The window is **fixed at 0–20 minutes** and may not be widened to improve a result.
- Selection uses **inputs only**. It may never reference confidence, direction, outcome, or
  `htfTrend`.
- This recovers a **nuisance parameter production failed to log**. It is not a strategy
  parameter, is not carried into the backtest's decision logic, and does not enter the §7
  Deflated-Sharpe trial count.

## A1.4 The re-specified gate

Conditioning on **input** recovery, then testing **output** agreement — non-circular because
the selector and the test are different quantities.

| Gate | Criterion | Status |
|---|---|---|
| **G1 — look-ahead is removed** | NAIVE (`timestamp <= asOf`) must score materially WORSE than PROPER, proving the slicer strips future data rather than being cosmetic | 70% vs 85% ✅ |
| **G2 — scoring is exact** | On signals where inputs are recovered (ADX within 0.5%, RSI within 2%, ATR within 2%), `confidence` must match **EXACTLY** and `htfTrend` must match exactly, on **100%** of them | must hold |
| **G3 — unrecoverable inputs are bounded** | Signals whose inputs cannot be recovered are reported as `UNRESOLVABLE`, never dropped silently, with full distribution published. Cap: **≤20%** | 3/20 = 15% |

G2 is the real gate: it is the strategy's scoring logic under test, and a harness that computed
confidence differently would fail it even with perfect inputs.

## A1.5 Mandatory disclosure — the unresolvable set is biased

**All three unresolvable signals are USD/CHF** (EUR/USD reproduces 8/8). Under §9 rule 4 this
is a material difference, and it is recorded here rather than buried:

> Any per-pair result for USD/CHF carries a known reproduction caveat. USD/CHF conclusions are
> reported with this caveat attached, and per §8 no cell may drive a parameter change anyway.

## A1.6 What this amendment does not touch

The §3 kill criterion, the §4 windows, the §5 variant cap, the §6 cost model, and the §7
statistics are **unchanged**. This amendment narrows only the reproduction gate, and it is
committed before any result exists that it could have been shaped to favour.


---

# AMENDMENT 2 — data source for the backtest, measured before any result

**Committed 2026-08-29, BEFORE any backtest result exists.** No expectancy, win-rate, or
per-cell number has been computed. The §3 kill criterion is UNCHANGED.

## A2.1 Decision

The 4-year backtest will use **Dukascopy** (via `dukascopy-node`: no API key, no rate limit,
m5 back to the 1990s). **Production stays on Twelve Data**, so the `signal_provenance`
reproduction evidence keeps accumulating uncontaminated.

Twelve Data's free tier is 800 calls/day and was fully exhausted on 2026-08-29 by backfilling
5-minute data for two pairs over four months. A 4-year, 5-pair replay is not reachable through
it. This is a capacity decision, not a search for a friendlier dataset.

## A2.2 The validity gap, measured rather than assumed

Backtesting on one feed while trading on another is a transfer risk. Measured over 7 days of
m5 bars, EUR/USD and USD/CHF, against the already-cached Twelve Data series:

| Comparison | EUR/USD median abs err | USD/CHF median abs err | signed bias |
|---|---|---|---|
| TD vs Dukascopy **bid** | 0.60 pips | 0.80 pips | −0.49 / −0.80 pips |
| TD vs Dukascopy **ask** | 0.40 pips | 0.50 pips | −0.05 / +0.38 pips |
| TD vs Dukascopy **mid** | **0.45 pips** | **0.45 pips** | **−0.27 / −0.21 pips** |

**Conclusion: Twelve Data forex is effectively MID.** The backtest must synthesise mid from
Dukascopy bid+ask, never use raw bid. Residual divergence is ~0.45 pips median, p95 1.7–1.9 —
roughly 3% of a 13-pip stop. Reported as a known limit, not corrected for.

## A2.3 Observed spread — recorded, NOT adopted

Dukascopy's own ask−bid: **median 0.30 pips EUR/USD, 0.80 USD/CHF** (p95 0.9 / 1.7; max 11.5 /
30.1 at rollover and news).

> [!danger] These are NOT the costs to model.
> Dukascopy is an ECN feed quoting near-interbank. The5ers is where these trades would actually
> execute. Adopting a 0.30-pip spread because it is the number we happen to have measured would
> flatter the backtest by ~0.05R per trade against a measured −0.079R expectancy — it could
> manufacture the entire result. **§6's conservative assumptions stand** (1.0 EUR/USD, 1.5
> USD/CHF) until The5ers' real spreads are obtained. The measured floor is recorded only to
> bound how optimistic any future revision may be.

The rollover/news maxima (11.5 and 30.1 pips) are retained as evidence that spread must be
modelled as a distribution, since a 48h hold crosses at least one rollover.

## A2.4 Twelve Data emits synthetic bars while the market is closed

Verified on 39,428 cached EUR/USD m5 bars (2026-04-15 → 2026-08-29):

- Twelve Data returns a **continuous 24/7 series with no weekend gaps** — ~288 bars every day
  including Saturdays. Real trading over that span would yield ~27,900 bars; TD returns 39,428.
- **28.5% of bars fall in market-closed hours**, and **none are flat** — Saturday 2026-08-22 has
  288 bars spanning 11.5 pips, opening exactly at Friday's close. These are not traded prices.

**Consequence for the live system**, measured at real kill-zone moments (n=551 per pair), as the
percentage by which ATR(14) changes when the closed-market bars are removed:

| | Mon | Tue | Wed | Thu | Fri |
|---|---|---|---|---|---|
| EUR/USD | +2.8% (max 49.5) | +0.5% | +0.1% | 0.0% | 0.0% |
| USD/CHF | **+16.0%** (max 68.4) | +2.8% | +0.4% | +0.1% | 0.0% |

Since stop distance is 1.5×ATR, **Monday stops are set too tight**, decaying to no effect by
midweek. Dukascopy omits weekends correctly, so the backtest does not inherit this — which is a
further reason the two feeds are not interchangeable, and a reason the backtest may not
reproduce production's Monday behaviour.

## A2.5 What this does NOT license

The obvious next move — check whether Mondays lose more — was run and **does not confirm the
mechanism**. Corrected, deduplicated outcomes by weekday: Mon 26.7% (n=15), Tue 50.0% (n=8),
**Wed 7.1% (n=14)**, Thu 50.0% (n=14), Fri 53.8% (n=13), against 35.8% overall.

Monday is below average, consistent with the ATR defect. But **Wednesday is far worse and has
essentially zero ATR distortion**, so something else dominates. At 8–15 trades per cell
(SE ≈ 13pp) this sample cannot attribute causes at all.

**Per §8, no weekday cell may drive a parameter change, a pair drop, or a filter.** The ATR
finding is recorded as a measured production defect to be fixed on its own merits, not as an
explanation for the loss record, and not as a new variant.

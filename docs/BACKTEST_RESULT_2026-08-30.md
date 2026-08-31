# Backtest Result — Primary Window (definitive, post-audit)

**Supersedes the 2026-08-29 first run.** That version was computed on data with ~126,000
market-open minutes missing (roughly 87 trading days), and with three engine defects since fixed.
Criteria remain those pre-registered in `docs/BACKTEST_PREREGISTRATION.md` (`9b37b64`) and its
three amendments, all committed before any number existed.

Baseline: **v3.4.0 on Dukascopy mid** (Amendment 3). Spreads: §6 configured, NOT the measured
Dukascopy values (§A2.3).

> [!important] Read the RETRACTION below before quoting anything from this document.
> The original write-up led with a paired control comparison that turned out to be an identity of
> the harness. It is withdrawn, and the finding that should have led it — the confluence score does
> not rank trades — is stated in its place.

## What changed since the first run

| | first run | definitive |
|---|---|---|
| data | ~87 trading days missing | merged + sanitised, gate-verified |
| fill | one m5 bar late | at the decision bar |
| daily cap | breachable via data holes | enforced on the fill's trading day |
| stale slices | analysed silently | skipped and counted |
| DSR hurdle | 0.1292 (wrong units) | corrected |
| expectancy | −0.0832 R | **−0.0551 R** |
| P(mean R ≤ 0) | 0.91 | **0.81** |

---

## Verbatim output

```

===== 3. REPORT (gate passed) =====
==========================================================================
PRE-REGISTERED BACKTEST REPORT
window 2024-08-01 -> 2026-08-01   pairs 5   cooldown until-resolved
baseline: v3.4.0 on Dukascopy mid (Amendment 3).  spreads: §6 configured, NOT observed.
==========================================================================

CONTROL ARMS — does the ICT machinery contribute anything?

  arm           n     win%     net pips    expectancy R    95% CI (block bootstrap)
  STRATEGY      687    31.0%      -1218     -0.0551      [-0.181, +0.074]
  RANDOM       1560    29.8%      -3096     -0.0984      [-0.168, -0.028]
  TREND-ONLY   1400    28.3%      -3492     -0.1353      [-0.217, -0.052]

  difference in expectancy (block bootstrap on the DIFFERENCE, paired by day):
    STRATEGY - RANDOM     : +0.0433 R   95% CI [-0.094, +0.183]   includes zero
    STRATEGY - TREND-ONLY : +0.0802 R   95% CI [-0.020, +0.184]   includes zero

  RE-WEIGHTED to the strategy's (symbol, hour) mix:
    STRATEGY   -0.0551 R
    RANDOM     -0.0943 R   diff +0.0392   (cell coverage 56%)
    TREND-ONLY -0.1204 R   diff +0.0653   (cell coverage 99%)
    on 332 shared (symbol, time) points STRATEGY and TREND-ONLY agree on direction 100.0%
    paired R difference on those points: +0.0001 +/- 0.0006 (95%)

  strategy beats RANDOM     : higher, but NOT significant
  strategy beats TREND-ONLY : higher, but NOT significant
  -> Not demonstrably contributing. A higher point estimate whose interval spans
     zero is not evidence: on this sample the ICT machinery cannot be distinguished
     from the stop/target geometry and kill-zone timing alone.

==========================================================================
STRATEGY — §7 statistics

  trades (resolved)      : 687 across 334 distinct days
  expectancy             : -0.0551 R/trade, net of spread and swap
  95% CI (block bootstrap, 10000 iters, resampling DAYS not trades)
                         : [-0.181, +0.074]
  P(mean R <= 0)         : 0.8061

  Sharpe (per trade)     : -0.0398
  hurdle from 15 trials : 0.1721
  Deflated Sharpe        : 0.0000   (skew 0.73, kurtosis 1.57)
  trial-Sharpe variance  : estimated from cross-fold Sharpes

  Deflated Sharpe across trial-variance estimators (Sharpe is -0.0398):
    cross-fold Sharpe variance (default)   hurdle 0.1721   DSR 0.0000
    cross-ARM Sharpe variance (3 configs)  hurdle 0.0530   DSR 0.0083
    H0 sampling variance 1/T               hurdle 0.0676   DSR 0.0028
    no deflation at all                    hurdle 0.0000   DSR 0.1523
    -> the verdict does not depend on the choice: Sharpe is negative, so DSR is ~0
       under every estimator, including none at all.

  walk-forward (purged, 48h embargo):
    fold 1  2024-08-01 -> 2024-11-30  n=130  meanR -0.022  win 32.3%
    fold 2  2024-11-30 -> 2025-03-31  n=102  meanR -0.013  win 33.3%
    fold 3  2025-03-31 -> 2025-07-31  n=111  meanR +0.010  win 30.6%
    fold 4  2025-07-31 -> 2025-11-29  n=125  meanR -0.165  win 28.0%
    fold 5  2025-11-29 -> 2026-03-30  n=102  meanR +0.128  win 36.3%
    fold 6  2026-03-30 -> 2026-07-30  n=107  meanR -0.242  win 26.2%
    unpurged, for comparison: n=686 meanR -0.0537  vs purged n=677 meanR -0.0540
    (purging is pre-registered but unnecessary here — nothing is fitted — so the gap is reported, not argued)
    folds with positive expectancy: 2/6

```

---

## RETRACTED — "the finding that settles it"

An earlier version of this document led with:

> On 332 shared decision points STRATEGY and TREND-ONLY choose the same direction 100% of the
> time, paired R difference +0.0001 +/- 0.0006.

**That is circular and carries no information.** It is withdrawn.

`signal-generator.ts:762` makes `dailyTrend === fourHourTrend` a HARD REQUIREMENT of the
strategy, and `signalType` *is* that trend. `control-arms.ts trendOnlyArm` fires iff daily and 4H
agree and sets `type` the same way, on the same slices, with the same 1.5xATR / 3.0xATR geometry
and the same fill bar. **On a shared bar the two arms construct the same trade.** Verified: entry
price identical on 332/332; the stop differs on 310/332 only because `analyze()` rounds via
`toFixed(5)` and the arm does not. The +/-0.0006 interval is the width of a rounding error.

The inference drawn from it was also backwards. It concluded "the machinery changes which bars
fire, not what happens on them" — but **which bars fire is the only channel through which an entry
strategy can add value.** The test conditioned on the exact variable of interest and reported the
residual as zero. It had no power against the hypothesis it was presented as settling.

## The finding that should have led — the confluence score does not rank trades

This one is real, is independent of every cost assumption, and survives every objection:

| | |
|---|---|
| corr(confidence, R) | **+0.0091** (n=687; \|r\| ~ 0.075 needed for p<.05) |
| Q1 (lowest confidence) | −0.029 |
| Q2 | −0.036 |
| Q3 | −0.027 |
| **Q4 (conf 108–125)** | **−0.128** |

The 130-point confluence score — FVG, order blocks, liquidity sweeps, multi-timeframe alignment,
the entire ICT apparatus — **does not rank its own trades, and its highest-confidence quartile is
the worst performing.** No cost assumption, sample-size caveat or harness choice touches this.

## Supporting evidence

- **Deflated Sharpe 0.0000**, and **0.1523 even with zero deflation** — the verdict does not
  depend on the trial-variance estimator, because the Sharpe is negative.
- **P(mean R ≤ 0) = 0.81**, 2 of 6 walk-forward folds positive, most recent fold worst at −0.242.
- **All three arms lose money.** The strategy is less bad, not profitable.
- Purging is immaterial: purged −0.0540 vs unpurged −0.0537.

## The §3 kill criterion was NOT met

The CI is [−0.181, +0.074] and does not exclude zero. That is **not** a reprieve — it means the
data does not definitively prove failure, not that the strategy works.

## Power — "no demonstrable edge" is mostly a statement about power

| | |
|---|---|
| sd(R) | 1.386 |
| block-bootstrap SE | 0.0640 (design effect 1.465) |
| **effective n** | **469** of 687 |
| **MDE at 80% power** | **0.179 R** |

Power against plausible edges: **+0.02 R → 6%**, **+0.05 R → 12%**, +0.10 R → 35%, +0.20 R → 88%.

**If the true edge were +0.05 R, this test would find it 12% of the time.** §1 of the
pre-registration said a 5pp effect needs ~1,300 trades per arm; the primary window delivered 687
total, 469 effective. **The study was underpowered by its own stated standard before it ran**, so
"no demonstrable edge" was close to a guaranteed output. The point estimate is still negative and
the burden of proof still sits with the strategy — but this is *"the experiment cannot see an edge
of the size you would hope for"*, not *"there is no edge."*

## A disclosure §6 owes the reader

Amendment 2 §A2.3 refused Dukascopy's measured spread, predicting adoption "would flatter the
backtest by ~0.05R ... it could manufacture the entire result." Recomputation confirms that
forecast almost exactly: **0.0503 R**.

The refusal is substantively correct — 1.0 pip EUR/USD is mid-range against The5ers' real 0.6–1.7.
But the symmetric sentence is equally true and appears nowhere in the original write-up:

> **Refusing the measured spread manufactures the entire negative result.**

Both sentences are true. Only one was written down. Recorded here because the measurement code and
the decision to discard the measurement shipped in the SAME commit (`37069a5`), so the magnitude
of the swing was known when the refusal was authored.

Related: `33d8673` re-enabled USD/JPY, GBP/USD and AUD/USD **27 minutes before** the
pre-registration was committed. USD/JPY (−0.233) and AUD/USD (−0.232) supply the entire loss;
EUR/USD (+0.002), USD/CHF (+0.121) and GBP/USD (+0.011) do not. §8 forbids acting on that, and it
is recorded as a disclosure, not a rescue.

## The backtest models neither the historical nor the deployed system

`ForexMarketANZ_EA.mq5:739-770` splits every signal into **two orders — 50% at TP1 (2R) and 50% at
TP3 (6–8R), sharing one stop**, with breakeven and partial-close fields in the schema to match. The
engine books **100% at TP1**, all-or-nothing, no breakeven, no trail. Because `mfeR` is truncated
at the resolving bar, the TP3 leg cannot be reconstructed from this trade set at all.

Combined with Amendment 3's admission that this is not the version that produced the live record,
**the backtest measures a third system** — neither the one that traded nor the one that would.
Direction of the bias is genuinely ambiguous, so this is a limit on transfer, not a correction.

## Honest caveats

1. **Gross expectancy is +0.0253 R, not −0.0399.** The earlier figure was quoted from the
   superseded trade set, and `grossPips` is measured against a fill that ALREADY contains half the
   spread, so it double-counts. True zero-cost expectancy on this trade set is **+0.0253 R** —
   statistically indistinguishable from zero, but positive.

   **The cost assumption carries 91% of the deficit** (0.0503 R of 0.0551 R). Under Dukascopy's
   measured spread the system is a coin flip: expectancy −0.0099 R, P(mean ≤ 0) = 0.56. Swap is a
   red herring at 6% of total cost.

   **Break-even spread is 0.27 pips.** That is below any spread this could actually trade at.
   Researched The5ers all-in cost is 0.6–1.7 pips (raw 0.2–0.9 plus $4–8 commission per round-turn
   lot). A system whose entire edge is consumed by the cheapest spread available anywhere is not a
   system — and that conclusion does NOT depend on §6's assumption being right.
2. **RANDOM's cell coverage is 56%**, so its re-weighted comparison is partial. TREND-ONLY at 99%
   is why the paired result carries the weight.
3. **Data gaps remain**: 7,070–14,080 market-open minutes per pair, worst hole 2,245 min. Dukascopy
   serves different bar sets for bid and ask, and mid needs both. Not invented to fill.
4. ~~This is `until-resolved` cooldown only.~~ **RESOLVED — all three bounds run on merged data:**

   | cooldown | trades | win rate | net pips | expectancy |
   |---|---|---|---|---|
   | instant (optimistic) | 743 | 31.0% | −1676.4 | −0.0626 R |
   | until-resolved | 687 | 31.0% | −1218.0 | −0.0551 R |
   | until-expiry (pessimistic) | 486 | 32.1% | −776.5 | −0.0321 R |

   The sign holds at every bound. Trade count varies 1.5x and net pips 2.2x, but expectancy stays
   inside a 0.031 R band and never crosses zero — the design note's test for whether the record is
   latency-driven rather than edge-driven. It is not.

   Note `until-expiry` is both the least-bad bound AND the most production-faithful one: its trade
   count best matches what production actually generated, consistent with the throttled validator
   holding signals PENDING. Even there it is negative.

   The monotonic gradient (longer cooldown -> better expectancy) has now appeared three times. It
   plausibly reflects avoiding trades opened while a correlated loser is still running. **§8
   forbids acting on it.** Recorded as a hypothesis for a future PRE-REGISTERED test, not a tweak.

## §8 still applies

Fold 6's −0.242, fold 5's +0.128, the cooldown gradient and the per-pair figures are reported for
honesty, not decisions. No cell may drive a parameter change, a pair drop, or a regime filter.

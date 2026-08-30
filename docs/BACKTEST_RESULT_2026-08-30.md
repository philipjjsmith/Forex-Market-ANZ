# Backtest Result — Primary Window (definitive, post-audit)

**Supersedes the 2026-08-29 first run.** That version was computed on data with ~126,000
market-open minutes missing (roughly 87 trading days), and with three engine defects since fixed.
Criteria remain those pre-registered in `docs/BACKTEST_PREREGISTRATION.md` (`9b37b64`) and its
three amendments, all committed before any number existed.

Baseline: **v3.4.0 on Dukascopy mid** (Amendment 3). Spreads: §6 configured, NOT the measured
Dukascopy values (§A2.3).

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

## The finding that settles it

Everything above is sample-size-dependent and cost-assumption-dependent. This is neither:

> On **332 decision points where STRATEGY and TREND-ONLY both fire, they choose the same
> direction 100% of the time**, and the paired R difference is **+0.0001 ± 0.0006**.

TREND-ONLY is Daily+4H EMA agreement and nothing else — no FVG, no order blocks, no liquidity
sweeps, no 130-point confluence score. On shared bars the full machinery and a bare trend filter
are statistically indistinguishable.

The ICT machinery changes **which bars fire**, not **what happens on them**. That is a structural
statement about the strategy, not a claim about this sample.

## Supporting evidence

- **Deflated Sharpe 0.0000**, and **0.1523 even with zero deflation** — the verdict does not
  depend on the trial-variance estimator, because the Sharpe is negative.
- **P(mean R ≤ 0) = 0.81**, 2 of 6 walk-forward folds positive, most recent fold worst at −0.242.
- **All three arms lose money.** The strategy is less bad, not profitable.
- Purging is immaterial: purged −0.0540 vs unpurged −0.0537.

## The §3 kill criterion was NOT met

The CI is [−0.181, +0.074] and does not exclude zero. That is **not** a reprieve — it means the
data does not definitively prove failure, not that the strategy works.

## Honest caveats

1. **Gross expectancy is ≈ 0** (−0.0399 R on the previous run's trade set); the loss is
   transaction cost against a ~17.5-pip median stop. "No edge, loses to costs" — not "negative
   edge". Different diagnosis, different remedies.
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

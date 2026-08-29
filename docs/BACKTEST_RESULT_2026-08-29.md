# Backtest Result — Primary Window, 2026-08-29

**This is the pre-registered result.** Criteria were fixed in
`docs/BACKTEST_PREREGISTRATION.md` (commit `9b37b64`) and its three amendments, all committed
BEFORE any number below existed. Nothing here was tuned after seeing the output.

Baseline: **v3.4.0 on Dukascopy mid** (Amendment 3). Spreads: §6 configured values, deliberately
NOT Dukascopy's observed spreads (Amendment 2 §A2.3).

---

## Verbatim output

```
==========================================================================
PRE-REGISTERED BACKTEST REPORT
window 2024-08-01 -> 2026-08-01   pairs 5   cooldown until-resolved
baseline: v3.4.0 on Dukascopy mid (Amendment 3).  spreads: §6 configured, NOT observed.
==========================================================================

CONTROL ARMS — does the ICT machinery contribute anything?

  arm           n     win%     net pips    expectancy R    95% CI (block bootstrap)
  STRATEGY      693    29.7%      -1499     -0.0832      [-0.204, +0.037]
  RANDOM       1560    29.6%      -3326     -0.1104      [-0.179, -0.041]
  TREND-ONLY   1395    28.8%      -3476     -0.1305      [-0.214, -0.046]

  difference in expectancy (block bootstrap on the DIFFERENCE, paired by day):
    STRATEGY - RANDOM     : +0.0272 R   95% CI [-0.105, +0.160]   includes zero
    STRATEGY - TREND-ONLY : +0.0473 R   95% CI [-0.059, +0.155]   includes zero

  strategy beats RANDOM     : higher, but NOT significant
  strategy beats TREND-ONLY : higher, but NOT significant
  -> Not demonstrably contributing. A higher point estimate whose interval spans
     zero is not evidence: on this sample the ICT machinery cannot be distinguished
     from the stop/target geometry and kill-zone timing alone.

==========================================================================
STRATEGY — §7 statistics

  trades (resolved)      : 693 across 335 distinct days
  expectancy             : -0.0832 R/trade, net of spread and swap
  95% CI (block bootstrap, 10000 iters, resampling DAYS not trades)
                         : [-0.204, +0.037]
  P(mean R <= 0)         : 0.9098

  Sharpe (per trade)     : -0.0603
  hurdle from 15 trials : 0.1292
  Deflated Sharpe        : 0.0000   (skew 0.76, kurtosis 1.70)
  trial-Sharpe variance  : estimated from cross-fold Sharpes

  walk-forward (purged, 48h embargo):
    fold 1  2024-08-01 -> 2024-11-30  n=130  meanR -0.064  win 30.8%
    fold 2  2024-11-30 -> 2025-03-31  n=101  meanR -0.020  win 32.7%
    fold 3  2025-03-31 -> 2025-07-31  n=114  meanR -0.119  win 28.1%
    fold 4  2025-07-31 -> 2025-11-29  n=126  meanR -0.097  win 28.6%
    fold 5  2025-11-29 -> 2026-03-30  n=106  meanR +0.005  win 32.1%
    fold 6  2026-03-30 -> 2026-07-30  n=106  meanR -0.197  win 26.4%
    folds with positive expectancy: 1/6

==========================================================================
§3 KILL CRITERION

  "If the primary window shows expectancy < 0 net of costs, with a 95% confidence
   interval excluding zero, development of this strategy stops."

  expectancy < 0            : YES  (-0.0832 R)
  95% CI excludes zero      : no  ([-0.204, +0.037])

  VERDICT: negative, but the CI does not exclude zero — criterion NOT met.

==========================================================================
runtime 6.0 min
Per-cell figures are for honesty, not decisions (§8): no cell may drive a parameter
change, a pair drop, or a regime filter.
==========================================================================

[exited with code 0]
```

---

## Reading

### The control arms are the headline, not expectancy

The strategy's edge over both controls is **not statistically distinguishable from zero**:

| comparison | difference | 95% CI | verdict |
|---|---|---|---|
| STRATEGY − RANDOM | +0.0272 R | [−0.105, +0.160] | includes zero |
| STRATEGY − TREND-ONLY | +0.0473 R | [−0.059, +0.155] | includes zero |

An earlier version of this report declared "beats RANDOM: yes" from the point estimates alone.
That was wrong and is corrected in `a3a49b7`: both arms carry wide intervals that overlap across
most of their range, so the ordering could be noise. The difference is now bootstrapped directly,
resampling the same days for both arms so shared market-regime variance cancels.

**On this sample the ICT machinery cannot be distinguished from the stop/target geometry and
kill-zone timing alone.**

### Deflated Sharpe is the strongest single statement

Sharpe **−0.0603** against a hurdle of **0.1292** from 15 trials gives **DSR = 0.0000**. Adjusted
for how many parameters were already chosen by looking at this data, there is no evidence of
skill. This does not depend on the confidence interval or on the kill criterion's threshold.

### The kill criterion was NOT met — and that is not a reprieve

It required the 95% CI to exclude zero. The CI is [−0.204, +0.037], so it does not. But:

- **P(mean R ≤ 0) = 0.9098** — nine-to-one that true expectancy is negative
- **1 of 6 walk-forward folds positive**, and that one is +0.005, indistinguishable from zero
- the most recent fold (2026-03 → 2026-07) is the worst at **−0.197 R**
- **all three arms lose money**

Not meeting the criterion means "the data does not definitively prove failure", not "it works".

### Independent corroboration

−0.0832 R here lands almost exactly on the **−0.079 R** measured from the live corrected record —
different data source (Dukascopy vs Twelve Data), different code path, different window. Two
independently derived numbers agreeing is the strongest evidence that the harness measures the
real system rather than an artifact of its own construction.

### Robustness

Sign held across every cooldown assumption on the full window, with trade count varying 1.5×:

| cooldown | trades | win rate | net pips | expectancy |
|---|---|---|---|---|
| instant | 744 | 30.0% | −1884.7 | −0.0952 R |
| until-resolved | 693 | 29.7% | −1499.4 | −0.0832 R |
| until-expiry | 482 | 30.7% | −1078.9 | −0.0521 R |

The design note's test — *a materially different result means the outcome is latency-driven, not
edge-driven* — comes back clean.

---

## What §8 forbids

Fold 6's −0.197, the cooldown gradient, and the per-pair figures are reported **for honesty, not
decisions**. No cell may drive a parameter change, a pair drop, or a regime filter. The obvious
temptations — lengthen the cooldown because expectancy improves, drop the worst pair, filter the
worst regime — are exactly what the pre-registration exists to prevent.

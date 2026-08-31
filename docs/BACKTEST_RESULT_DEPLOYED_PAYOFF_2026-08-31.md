# Backtest Result — the DEPLOYED payoff (50% TP1 / 50% TP3)

**Run 2026-08-31.** Closes the defect disclosed in `BACKTEST_RESULT_2026-08-30.md`: *"the backtest
measures a third system — neither the one that traded nor the one that would."*

`ForexMarketANZ_EA.mq5` splits every signal into **two orders sharing one stop** — 50% at TP1,
50% at TP3 — while `resolveTrade` books **100% at TP1**. Every expectancy figure this project has
ever published describes a payoff the deployed system does not use.

## This is a correction, not a variant

Pre-registration §5 caps strategy variants at three. **This consumes none of them.** No entry
rule, gate, threshold, pair or parameter changed. The 1,095 entries are read verbatim from
`.backtest-cache/trades-pooled.json` and re-resolved, so entries, fills and costs are bit-identical
between the two arms and **the only difference is the exit model**. Re-running the replay would
have been worse: it could differ for unrelated reasons.

**The control arm reproduces the published number exactly (−0.0552 R), which is what licenses the
comparison.**

## Parameters, read from the EA rather than assumed

```
USE_PARTIAL_PROFITS      = true
PARTIAL_CLOSE_PERCENT_1  = 50.0    // at TP1,  commented "3.0x ATR"
PARTIAL_CLOSE_PERCENT_2  = 50.0    // at TP3,  commented "12.0x ATR"
grep -ci "breakeven|trail" ForexMarketANZ_EA.mq5  ->  0
```

**There is no breakeven and no trail.** Both legs share the original stop for the whole life of
the trade, so a runner that has passed TP1 can still come back and lose a full R. That is modelled.

**TP3 is derived as 4 × the TP1 *distance***, not as a multiple of R. TP1 is 3.0×ATR and TP3 is
12.0×ATR, so the ratio is exactly 4 regardless of the stop. Deriving it from R would be wrong:
`MIN_SL_PIPS` widens the stop on some signals without widening the target, so TP1/risk actually
ranges **1.56–2.02** across the trade set rather than being a clean 2.

## Result

1,095 trades, 2022-08 → 2026-08, all resolved (0 unresolvable).

| arm | expectancy | sd(R) | 95% CI (block bootstrap by day) |
|---|---|---|---|
| **100% at TP1** — engine, as previously run | **−0.0552 R** | 1.379 | [−0.148, +0.041] |
| **50/50 TP1+TP3** — EA, as deployed | **−0.0339 R** | 1.640 | [−0.149, +0.086] |
| **paired difference** (same trades) | **+0.0213 R** | | **[−0.036, +0.080]** |

> **The deployed payoff is better, but not significantly — the interval spans zero.**

It closes **39% of the deficit** (−0.0552 → −0.0339) at the cost of **19% more variance**
(sd 1.379 → 1.640). Per-trade Sharpe improves from −0.040 to −0.021, so the gain is real in
risk-adjusted terms and not just leverage.

**It does not reach profitability.** The point estimate is still negative and the CI still
contains zero.

## What the runner leg actually did — all three numbers are new

| | |
|---|---|
| TP3 (the 8R-equivalent) reached | **38 of 1,095 = 3.5%** |
| ran past TP1, then stopped out | **105 = 9.6%** |
| mean TRUE MFE to expiry | **1.822 R** |

The MFE figure could not previously be computed at all: `resolveTrade` returns at the first target
touch, so `mfeR` was truncated at the resolving bar. Measured properly, the average trade reaches
**1.82R** in its favour at some point — just short of the ~2R TP1.

## The obvious next question, and why it is NOT answered here

**9.6% of trades ran past TP1 and then gave the runner back to the shared stop.** Adding a
breakeven move after TP1 would convert each of those from roughly +0.5R to roughly +1.0R:

```
105 / 1095  x  0.5R  =  +0.048 R
```

which would put expectancy at roughly **+0.014 R** — positive.

> [!danger] That arithmetic is NOT a result and must not be reported as one.
> A breakeven move is **a strategy change**, not a payoff correction: the EA does not have one.
> Testing it on this same 2022–2026 window would be a parameter search on data that already
> carries a Deflated-Sharpe trial count of **N ≥ 15**, and §8 forbids letting a measured cell
> drive a parameter change. The number above follows arithmetically from a cell in the table and
> is recorded **only** so that it is not silently rediscovered and acted on later.
>
> **It requires its own pre-registration, and it should be tested on forward data.**

## What this changes

1. **Every published expectancy for this system understated it by ~0.021 R.** The honest figure
   for the system as deployed is **−0.0339 R**, not −0.0551 R.
2. **The §3 kill criterion is still not met**, and is now further from being met.
3. **The "third system" defect is closed.** The backtest now models the payoff the EA actually
   uses. It still does not model the *historical* system (v3.3.0 on Twelve Data) — Amendment 3
   established that is not constructible.

## Verification

- `scripts/backtest/test-split-payoff.ts` — **23 assertions, all passing**, covering the shared
  stop taking back a post-TP1 runner, MFE not being truncated, TP3 derived from distance rather
  than R, long/short symmetry, expiry, and the within-bar tie going to the stop.
- Control arm reproduces the published −0.0552 R exactly.
- `npx tsc --noEmit` clean on both new files.

Reproduce: `npx tsx scripts/backtest/run-split-payoff.ts`

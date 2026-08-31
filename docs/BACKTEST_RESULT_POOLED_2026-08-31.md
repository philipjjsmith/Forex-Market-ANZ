# Backtest Result — Secondary and Pooled Windows

**Run 2026-08-31 against criteria fixed in Amendment 4 (`1e88e70`), committed before either
window was executed.** Baseline v3.4.0 on Dukascopy mid (Amendment 3), §6 configured spreads.
Data gate `verify-data.ts` passed on all 5 pairs (~1.49M m5 bars, no structural defects).

These are the last two of the three windows §4 pre-registered on 2026-08-28. **No window remains
unrun. There is no further pre-registered test of this strategy.**

## The headline: three windows, one number

| window | period | n | win% | expectancy | 95% CI | P(mean <= 0) | folds + |
|---|---|---|---|---|---|---|---|
| Primary | 2024-08 -> 2026-08 | 687 | 31.0% | **-0.0551 R** | [-0.181, +0.074] | 0.81 | 2/6 |
| Secondary *(veto-only)* | 2022-08 -> 2024-08 | 408 | 30.6% | **-0.0554 R** | [-0.198, +0.089] | 0.77 | 4/6 |
| **Pooled** | 2022-08 -> 2026-08 | **1095** | 30.9% | **-0.0552 R** | **[-0.149, +0.040]** | **0.867** | 1/6 |

Primary and Secondary are **disjoint samples from different regimes** — the second spans the Fed
hiking cycle and EUR/USD parity, the first does not. They agree to three decimal places. That
precision is coincidence (SEs are 0.065 and 0.073), but the agreement in sign and magnitude across
four years and two regimes is not: **the -0.055 R estimate is stable, not a draw from a window
that happened to be bad.**

Deflated Sharpe is **0.0000** on both windows under every trial-variance estimator including no
deflation at all, because the Sharpe is negative (-0.0401 pooled).

## Both pre-declared criteria: NOT MET

| A4.4 criterion | bar | actual | result |
|---|---|---|---|
| **§3 KILL** | expectancy < 0 **and** 95% CI excludes zero | -0.0552 R; CI [-0.149, **+0.040**] | **NOT met** — CI still includes zero |
| **A4.4 GREEN** | net >= +0.05 R with CI excluding zero -> point >= +0.0945 R at the realised SE | -0.0552 R | **NOT met** |

Per A4.4 rule 4, a result between kill and green **changes nothing formally**. But three things
did change, and they all point the same way.

## What actually moved

### 1. The upper bound fell below the tradeability threshold — under §6 costs

The most optimistic value still consistent with the evidence dropped from **+0.074 R** to
**+0.040 R**. Amendment 4 fixed the decision-relevant threshold at net **+0.05 R**.

> Under §6's cost model, **95% confidence now excludes the entire band that would be worth
> trading.** Not "we failed to find an edge" — "an edge big enough to matter is outside the
> interval."

**This conclusion is cost-dependent, and the dependency is stated rather than buried.** §6 charges
0.080 R per trade; the implied gross upper bound is +0.120 R. Re-costed at The5ers' researched
all-in range:

| cost assumption | net CI upper bound | vs +0.05 R threshold |
|---|---|---|
| §6 configured (0.080 R) | **+0.040 R** | below |
| The5ers worst 1.7 pips (0.098 R) | +0.023 R | below |
| The5ers mid 1.15 pips (0.066 R) | +0.054 R | marginally above |
| The5ers best 0.6 pips (0.034 R) | +0.086 R | above |

So the honest statement is: **the tradeable band is excluded at mid-to-high realistic costs and
survives only at the venue's best case** — the same cost sensitivity the primary result disclosed,
now with a much narrower interval around it. It has not become cost-independent.

### 2. The strategy's advantage over RANDOM did not replicate

| comparison | primary | pooled | secondary |
|---|---|---|---|
| STRATEGY - RANDOM, unweighted | +0.0433 (ns) | **+0.0320 (ns)** | +0.0044 (ns) |
| STRATEGY - RANDOM, re-weighted to strategy's (symbol, hour) mix | **+0.0392** | **-0.0064** | **-0.0636** |

None is significant, in either direction, on any window. But the re-weighted point estimate that
previously favoured the ICT machinery **went to zero and then negative on 60% more data**, and in
the secondary window RANDOM entry is outright positive (+0.0081 re-weighted). Cell coverage for
RANDOM is 60-63%, so the re-weighted comparison remains partial — which is why this is recorded as
*failure to replicate*, not as "random beats the strategy".

TREND-ONLY remains worse than both on every window (pooled -0.1224), and the STRATEGY/TREND-ONLY
paired comparison stays circular for the reason retracted on 2026-08-30 — both arms build the same
trade on a shared bar (540/540 same direction here).

### 3. The confluence score still does not rank trades — replicated at n=1095

`corr(confidence, R) = -0.0048` (needs +/-0.0593 for p<.05). Now marginally *negative*.

| quartile | confidence | n | mean R |
|---|---|---|---|
| Q1 | 74-93 | 273 | -0.043 |
| Q2 | 93-102 | 273 | +0.011 |
| Q3 | 102-108 | 273 | -0.095 |
| Q4 | 108-127 | 276 | -0.094 |

This is the primary window's central finding, reproduced on a larger, partly disjoint sample. It is
independent of every cost assumption.

> **Correction to a live-record claim.** The ~70-trade live record showed HIGH tier (22.4%) losing
> to MEDIUM (28.6%), which was read as the tiers being inverted. That does **not** replicate: on
> 1095 backtest trades HIGH is -0.041 and MEDIUM -0.162. The *tier inversion* was noise. The
> *correlation* finding — the score carries no ranking information — is what stands.

## Power: Amendment 4's projection was slightly optimistic

A4.2 projected n ~ 1,374 and SE ~ 0.0453. Actual: **n = 1,095**, SE **0.0482**, effective n **818**,
design effect 1.339, MDE **0.135 R**. The secondary window generates trades at a lower rate
(408 in two years vs 687).

| true net edge | primary power | pooled power |
|---|---|---|
| +0.05 R | 12% | **18%** |
| +0.10 R | 34% | **55%** |
| +0.116 R *(tradeable, A4.3)* | 43% | **67%** |
| +0.15 R | 64% | 88% |
| +0.20 R | 87% | 99% |

Power against the tradeable band rose 43% -> 67%, short of the 72% A4.2 projected but the
substantive gain it predicted. Power against +0.05 R is still 18%, and A4.2's ceiling stands:
reaching 80% there needs ~25.7 years of 5-pair history.

## What this does and does not license

**Does not:** a §3 stop. The criterion was written to require the CI to exclude zero and it does
not. Amendment 4 rule 4 governs, and no rule is being reinterpreted after seeing the number.

**Does not:** any parameter change, pair drop, hour filter or regime filter (§8). Fold 3's +0.078,
the secondary window's 4/6 positive folds, the Q2 quartile and the per-pair figures are reported
for honesty, not decisions.

**Does:** exhaust the pre-registered programme. Every window §4 named has been run. The strategy
has produced a stable -0.055 R across 1,095 trades and four years, its upper confidence bound sits
below the tradeable threshold at realistic costs, its scoring apparatus carries no ranking
information, and its measured advantage over random entry has evaporated on the larger sample.

**Any further test of this strategy requires a new pre-registration, and it should state in advance
what result would justify continuing** — because the existing evidence no longer supplies one.

# CHANGES LOG — Forex-Market-ANZ

This document records every change made to the codebase, why it was made, and what the expected impact is.
**Never delete entries. Always append.**

---

## Session: 2026-02-23 — "Make It Profitable" Overhaul

### Context
Forensic analysis (scripts/_forensics.ts) confirmed the system was NEVER profitable:
- 29 real deduplicated trades: 3W / 14L = 17.65% true win rate, -727 pips net
- EUR/USD: 0 wins ever
- Root causes identified: duplicate signals, EMA entry fires after the move, 1:1 R:R, Weekly TF causes 32-day dry spells, in-memory trade counter resets on Render restarts

### Prop Firm Decision
- **FXIFY eliminated**: US traders on DXtrade only (MetaQuotes banned MT4/MT5 for US), DXtrade has no EA support
- **Winner: The5ers Bootcamp ($22)** — EA allowed on MatchTrader for US, 9 years operating, 4.8/5 Trustpilot (21k reviews), balance-based static drawdown, bi-weekly payouts
- **Scale-up: BrightFunded** — Truly static drawdown, ~4hr payouts, MT5/cTrader/DXtrade

---

## BLOCK 1 — Supabase SQL Unique Index

**Date:** 2026-02-23
**File:** Supabase SQL Editor (not a code file)
**Status:** NEEDS TO BE RUN MANUALLY

**Problem:** Signal generator produced 2-17 duplicate PENDING signals per event.
The existing app-level dedup check (SELECT WHERE outcome='PENDING') has a race
condition: if two cron runs overlap, or if Render restarts mid-signal, duplicates
slip through. The Nov 18 "100% WR week" was actually 17 copies of 1 USD/JPY LONG.

**Fix:** Database-level partial unique index — physically impossible to insert a
second PENDING signal for the same symbol.

**SQL to run in Supabase SQL Editor:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS signal_history_one_pending_per_symbol
  ON signal_history (symbol, type)
  WHERE outcome = 'PENDING' AND data_quality = 'production';
```

**Expected impact:** Eliminates duplicate chains entirely. Win rate reporting becomes accurate.

---

## BLOCK 2 — prop-firm-config.ts

**Date:** 2026-02-23
**File:** `server/services/prop-firm-config.ts`
**Commit:** (see git log)

**Problems fixed:**
1. `phase1Target: 5.0` → WRONG. The5ers Bootcamp = 10%, FXIFY was 5% (now eliminated)
2. `phase2Target: 5.0` → WRONG. The5ers Phase 2 = 10% (they scale, not reduce)
3. Firm name still says "FXIFY" everywhere — must say "The5ers"
4. `maxTradesReached()` uses in-memory `tradesCount` which resets on every Render restart
   (free tier restarts on each UptimeRobot ping = 3-trade daily limit was NEVER enforced)
5. `maxDailyLoss: 4.0` → The5ers Bootcamp has no strict daily loss limit (balance-based)

**Fix:** Updated config to The5ers Bootcamp values. `maxTradesReached()` now queries
the database for today's PENDING signals count instead of using in-memory state.

---

## BLOCK 3+4 — Kill Zone Hard Gate

**Date:** 2026-02-23
**Files:** `server/services/session-analyzer.ts`, `server/services/signal-generator.ts`

**Problem:** Kill zones were just confidence POINTS (+4 or +7). Signals outside
ICT kill zones still fired with lower confidence — still got saved and executed.
ICT methodology requires ONLY trading during institutional liquidity windows:
- London Open: 07:00-10:00 UTC
- NY Open: 12:00-15:00 UTC

Current session-analyzer had LONDON = 07:00-16:00 UTC (too broad, catches NY session too)
and NY = 12:00-21:00 UTC (too broad, catches dead afternoon hours).

**Fix:**
- Added `isInKillZone()` method to SessionAnalyzer returning true only during tight windows
- Signal generator now HARD GATES at top of analysis: if not in kill zone, skip entirely
- Reduces noise trades in Asian/dead hours dramatically

---

## BLOCK 5 — R:R Fix (1:1 → 2:1 minimum)

**Date:** 2026-02-23
**File:** `server/services/signal-generator.ts`

**Problem:** SL = 3.0×ATR, TP1 = 3.0×ATR = 1:1 R:R.
At 55% WR with 1:1 R:R: EV = +0.10R per trade (barely positive).
To pass The5ers Bootcamp (10% target): need ~100 trades at 1:1 R:R.
At 2:1 R:R with 55% WR: EV = +0.65R per trade — passes in ~20-25 trades.

**Fix:**
- SL multiplier: 3.0 → 1.5×ATR (tighter stop — FVG entries are more precise)
- TP1 multiplier: 3.0 → 3.0×ATR (unchanged distance, but vs 1.5×ATR SL = 2:1 R:R)
- TP2 multiplier: 6.0 → 6.0×ATR (4:1 R:R vs new SL)
- TP3 multiplier: 12.0 → 9.0×ATR (6:1 R:R vs new SL)

---

## BLOCK 6 — JPY Pip Factor Fix

**Date:** 2026-02-23
**File:** `server/services/signal-generator.ts`

**Problem:** All pairs used ×10000 pip factor. USD/JPY prices are 2 decimal places
(e.g., 149.85), so 1 pip = 0.01. Using ×10000 displayed "2,039 pip" stops when
actual was 20.4 pips — completely wrong for any JPY pair analysis.

**Fix:** `getPipFactor(symbol)` function returns 100 for JPY pairs, 10000 for all others.

---

## BLOCK 7 — FVG Detector + Weekly TF Relaxation

**Date:** 2026-02-23
**File:** `server/services/signal-generator.ts`

**Problem 1 — EMA crossover fires AFTER the move:**
EMA crossover is a lagging indicator. It signals after price has already moved.
Baseline WR for EMA crossover: 38-45%. ICT FVG entries fire at the START of
institutional moves — where the actual money is.

**Fix:** Added `detectFVG()` and `getActiveFVG()` functions. Entry now targets
the Consequent Encroachment (CE = midpoint of the FVG gap) instead of the
current price at crossover time.

**Problem 2 — Weekly TF causes 32-day dry spells:**
When weekly trend flips during transitions (e.g., consolidation), W+D+4H can't
all align for weeks. In Nov 2025 there was a 32-day signal silence while the
cron ran perfectly fine — just no valid signals because Weekly disagreed.

**Fix:** Weekly TF is now a BIAS FILTER (adds 25 pts when confirmed, 10 pts when
counter-trend) rather than a hard requirement. Daily + 4H remain mandatory.
This keeps signal quality high while eliminating multi-week dry spells.

---

## BLOCK 8 — Telegram Notification System

**Date:** 2026-02-23
**File:** `server/services/telegram-notifier.ts` (new), `server/services/signal-generator.ts`

**Problem:** The5ers MatchTrader requires manual trade execution (no direct API/EA
bridge built yet). Without instant notification, signals fire and expire before
the trader can act on them.

**Fix:** Telegram bot sends formatted message the instant a signal is saved to DB.
Message includes: symbol, direction, entry price, SL, TP1/TP2/TP3, confidence,
rationale. Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID env vars on Render.

---

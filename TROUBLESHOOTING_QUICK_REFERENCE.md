# EA Troubleshooting - Quick Reference Card

**Print this page and keep it handy during EA deployment.**

---

## 🔴 EA WON'T START

| Symptom | Fix |
|---------|-----|
| **EA not in Navigator** | Files in wrong folder. Check:<br>• `ForexMarketANZ_EA.mq5` in `MQL5\Experts\`<br>• `JAson.mqh` in `MQL5\Include\`<br>• Restart MT5 |
| **Compilation error** | Missing JAson.mqh. Put in `MQL5\Include\` → Restart MT5 |
| **Sad face ☹️ on chart** | AutoTrading disabled. Click AutoTrading button (toolbar) → Should turn green |

---

## 🔴 AUTHENTICATION ERRORS

| Error Message | Fix |
|---------------|-----|
| **"WebRequest failed: 4014"** | WebRequest not enabled.<br>• Tools → Options → Expert Advisors<br>• Check "Allow WebRequest for listed URL"<br>• Add: `https://forex-market-anz.onrender.com`<br>• Click OK → Restart EA |
| **"Authentication failed"** | Wrong username/password.<br>• Test login at: https://forex-market-anz.pages.dev/login<br>• Update EA settings with correct credentials<br>• Restart EA |
| **"401 Unauthorized"** | JWT token expired (auto-renews every 24h).<br>• Wait 60 seconds for auto-renewal<br>• If persists: Restart EA |

---

## 🔴 NO SIGNALS DETECTED

| Symptom | Cause | Fix |
|---------|-------|-----|
| **No "📡 Polling API" messages** | Timer not running | Restart EA |
| **"📡 Polling API" but "Received 0 signals"** | No active signals on website | Normal - wait for signals (3-7/week) |
| **Only MEDIUM signals, but not executing** | `HIGH_TIER_ONLY = true` | Either wait for HIGH signals OR set `HIGH_TIER_ONLY = false` |
| **API errors in logs** | Website might be down | Check: https://forex-market-anz.onrender.com/api/health<br>If down, EA will retry automatically |

---

## 🔴 SIGNALS DETECTED BUT NOT TRADING

| Check | Fix |
|-------|-----|
| **Is TRADE_ENABLED = true?** | EA Properties → Set to `true` |
| **Are you on DEMO account?** | Demo = safe for testing<br>Live = real money |
| **Is signal HIGH tier?** | If `HIGH_TIER_ONLY = true`, MEDIUM signals skipped.<br>Check logs for tier. |
| **Is it weekend?** | EA blocks Saturday/Sunday trading (forex markets closed).<br>Wait for Monday. |
| **Symbol available?** | EA auto-converts (EUR/USD → EURUSD).<br>If symbol not on broker, skipped. |

---

## 🔴 ORDER PLACEMENT FAILURES

| Error Message | Cause | Fix |
|---------------|-------|-----|
| **"Insufficient funds"** | Not enough margin | Check Account tab: Free Margin.<br>Reduce position size or deposit more. |
| **"Invalid stops"** | SL/TP too close to price | EA auto-calculates valid levels.<br>If persists: Check broker's minimum stop distance. |
| **"Trade disabled"** | AutoTrading off | Click AutoTrading button in MT5 toolbar → Green |
| **"Market closed"** | Weekend or outside trading hours | Wait for markets to open (Sunday 5pm ET) |
| **Retry attempts failing** | Network/broker issue | Check MT5 connection (green bars).<br>If red: Check internet/VPS connection. |

---

## 🔴 CIRCUIT BREAKER TRIPPED

| Reason | What It Means | Fix |
|--------|---------------|-----|
| **"Daily loss limit reached"** | Lost ≥3.5% today | **AUTO-RESETS at midnight UTC**<br>Review trades to understand losses. |
| **"Max drawdown limit reached"** | Down ≥7.5% from peak balance | **MANUAL INTERVENTION REQUIRED**<br>• Pause trading<br>• Analyze last 10-20 trades<br>• Check if strategy still working<br>• Review website performance<br>• Restart EA when confident |
| **"5 consecutive order failures"** | Broker/connection issue | • Check MT5 connection (green bars)<br>• Check FXIFY account status<br>• Restart EA after fixing issue |
| **"10 consecutive API errors"** | Website/network issue | • Check: https://forex-market-anz.onrender.com/api/health<br>• Check VPS internet connection<br>• Restart EA after API is back online |

---

## 🔴 VPS / MT5 CONNECTION ISSUES

| Problem | Fix |
|---------|-----|
| **Can't connect to VPS via RDP** | • Check VPS is running (contact VPS provider)<br>• Verify IP address, username, password<br>• Check local internet connection |
| **MT5 shows red bars (no connection)** | • File → Login to Trade Account<br>• Re-enter account credentials<br>• Select correct server (FXPIG-Demo or FXPIG-Live) |
| **VPS disconnects frequently** | • Free VPS: Contact FXPIG support<br>• Paid VPS: Contact VPS provider<br>• Request server migration if unstable |
| **EA stopped running after VPS reboot** | • RDP into VPS<br>• Open MT5 (might need to login again)<br>• EA should auto-start if still attached to chart<br>• If not: Drag EA onto chart again |

---

## 🔴 PERFORMANCE ISSUES

| Symptom | Diagnosis | Fix |
|---------|-----------|-----|
| **Win rate <50%** (over 20+ signals) | Strategy not working OR slippage too high | • Check website FXIFY stats (should match EA)<br>• Measure slippage (should be <2 pips on VPS)<br>• If website also underperforming: Pause and investigate |
| **Monthly profit <$5K** (50% degradation) | Missing signals OR poor execution | • Check signal catch rate (should be 100%)<br>• Check EA uptime (should be 99%+)<br>• Compare executed signals to website's signal count |
| **Excessive slippage (>5 pips)** | VPS far from broker OR network issues | • VPS should be in London LD4 (FXPIG location)<br>• Check MT5 ping (should be <5ms)<br>• Consider better VPS if consistently high |

---

## 🔴 LOGGING / MONITORING ISSUES

| Problem | Fix |
|---------|-----|
| **No logs in Experts tab** | • Check Toolbox at bottom of MT5 → "Experts" tab<br>• If empty: EA might not be running |
| **Too many logs (spam)** | • Reduce logging: `VERBOSE_LOGGING = false`, `LOG_LEVEL = 1` |
| **Log files not created** | • Check `LOG_TO_FILE = true`<br>• Check folder: File → Open Data Folder → MQL5\Files\ForexMarketANZ_Logs |
| **Can't find log files** | • In MT5: File → Open Data Folder<br>• Navigate: MQL5\Files\ForexMarketANZ_Logs\EA_Log_YYYYMMDD.log |

---

## 🚨 EMERGENCY: STOP EA IMMEDIATELY IF...

| Situation | Action |
|-----------|--------|
| **Win rate drops to 30-40%** (over 20+ trades) | 1. Right-click chart → Expert Advisors → Remove<br>2. Close all open positions manually<br>3. Investigate root cause before restarting |
| **Circuit breaker trips 3+ times in one week** | 1. Stop EA<br>2. Review all trades and logs<br>3. Compare to website performance<br>4. Don't restart until issue identified |
| **Monthly loss >10%** | 1. Stop EA immediately<br>2. Check if website signals also losing<br>3. Possible strategy failure - needs investigation |
| **Unauthorized trades appear** | 1. Stop EA<br>2. Change FXIFY password<br>3. Check for other EAs on account<br>4. Contact FXIFY support |

---

## ✅ NORMAL BEHAVIOR (Not Errors)

| You Might See | Why It's Normal |
|---------------|-----------------|
| **"Skipping MEDIUM tier signal"** | `HIGH_TIER_ONLY = true` - EA only trades 85%+ signals ✅ |
| **"Weekend detected - markets closed"** | Forex closed Saturday/Sunday - EA pauses trading ✅ |
| **"Signal already processed"** | Duplicate prevention - EA won't trade same signal twice ✅ |
| **"Symbol not available"** | Signal for pair not on your broker (e.g., exotic pairs) ✅ |
| **"Token expired - re-authenticating"** | JWT renews every 24h automatically ✅ |
| **2 orders per signal** | Partial profits: 50% @ TP1, 50% @ TP3 ✅ |
| **1-3 pips slippage** | Normal on VPS (<2ms latency) ✅ |
| **No signals for 1-2 days** | Strategy generates 3-7 signals/week (not daily) ✅ |

---

## 📞 WHERE TO GET HELP

### Self-Help (Check First)
1. **This troubleshooting card** (you're here)
2. **VPS_DEPLOYMENT_GUIDE.md** → Troubleshooting section (detailed)
3. **EA_CONFIGURATION_REFERENCE.md** → Common misconfigurations
4. **EA logs** → MT5 Toolbox → Experts tab

### External Support
| Issue Type | Contact |
|------------|---------|
| **EA technical issues** | Review EA source code (`ForexMarketANZ_EA.mq5`) - well-commented |
| **API/Website down** | Check: https://forex-market-anz.onrender.com/api/health |
| **FXIFY account issues** | support@fxify.com |
| **VPS issues** | Your VPS provider support (FXPIG or paid VPS) |
| **MT5 platform issues** | FXPIG support OR MQL5 forums |

---

## 🔧 DIAGNOSTIC COMMANDS

**Check API health:**
- Browser → https://forex-market-anz.onrender.com/api/health
- Should return: `{"status":"ok"}` or similar

**Check MT5 data folder:**
- MT5 → File → Open Data Folder
- Should open Windows Explorer to EA files location

**Check WebRequest permissions:**
- MT5 → Tools → Options → Expert Advisors tab
- Should see `https://forex-market-anz.onrender.com` in allowed URLs list

**Check EA is attached to chart:**
- Chart top-right corner should show: "ForexMarketANZ_EA v1.0.0" + smiley 😊

**Check account type:**
- MT5 → Navigator → Trade tab
- Should show account number + (Demo) or (Live)

**Force EA restart:**
- Right-click chart → Expert Advisors → Remove
- Drag EA from Navigator onto chart again → Enter settings → OK

---

## 📊 QUICK HEALTH CHECK

Run this checklist daily (1 minute):

- [ ] RDP connected to VPS ✅
- [ ] MT5 open and logged in ✅
- [ ] MT5 shows **green bars** (bottom-right) ✅
- [ ] Chart shows EA name + smiley face 😊 ✅
- [ ] Experts tab shows recent "📡 Polling API" messages ✅
- [ ] No red error messages in Experts tab ✅
- [ ] Account balance reasonable (no huge unexpected loss) ✅

**If all ✅:** EA is healthy!
**If any ❌:** Check relevant section above.

---

## 🎯 PERFORMANCE BENCHMARKS

| Metric | Target | Red Flag |
|--------|--------|----------|
| **Win Rate** | 65-75% | <55% |
| **Monthly Profit** | $10K-$15K | <$5K |
| **Signals/Month** | 12-30 | <10 |
| **Avg Slippage** | <2 pips | >5 pips |
| **Circuit Breaker Trips** | 0 | >1/month |
| **API Error Rate** | <1% | >5% |
| **Order Error Rate** | <1% | >5% |
| **EA Uptime** | 99%+ | <95% |

---

**Print this page and keep it near your computer for quick reference during EA deployment and monitoring.**

**Version:** 1.0.0 | **Last Updated:** 2025-12-11

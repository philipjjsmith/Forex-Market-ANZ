# ForexMarketANZ EA - Quick Deployment Checklist

**Print this page and check off each step as you complete it.**

---

## ☑️ PRE-DEPLOYMENT (Before VPS Setup)

- [ ] **Files ready on local PC:**
  - [ ] `ForexMarketANZ_EA.mq5`
  - [ ] `JAson.mqh`

- [ ] **Credentials ready:**
  - [ ] ForexMarketANZ username: ________________
  - [ ] ForexMarketANZ password: ________________
  - [ ] FXIFY account number: ________________
  - [ ] FXIFY password: ________________

- [ ] **VPS access confirmed:**
  - [ ] VPS IP address: ________________
  - [ ] VPS username: ________________
  - [ ] VPS password: ________________

---

## ☑️ VPS CONNECTION (5 minutes)

- [ ] **Windows:** Press `Win+R` → type `mstsc` → Enter
- [ ] **Mac:** Open "Microsoft Remote Desktop" app
- [ ] Enter VPS IP address
- [ ] Enter VPS credentials
- [ ] Connected successfully ✅

---

## ☑️ MT5 INSTALLATION ON VPS (10 minutes)

- [ ] **Download MT5** (on VPS, not local PC!):
  - [ ] Go to: https://www.fxpig.com/platforms/metatrader-5
  - [ ] Download `fxpig5setup.exe`

- [ ] **Install MT5:**
  - [ ] Run installer → Next → Next → Finish

- [ ] **Login to MT5:**
  - [ ] Server: `FXPIG-Demo` ✅ (for testing first!)
  - [ ] Account: [FXIFY demo account number]
  - [ ] Password: [FXIFY demo password]

- [ ] **Verify connection:**
  - [ ] Bottom-right shows **green bars** + ping (e.g., "2ms") ✅

---

## ☑️ EA FILE UPLOAD (5 minutes)

### Option A: Copy-Paste via RDP (Easiest)

- [ ] **On local PC:** Copy `ForexMarketANZ_EA.mq5` (Ctrl+C)
- [ ] **On VPS in MT5:** File → Open Data Folder
- [ ] Navigate to: `MQL5\Experts\`
- [ ] Paste file (Ctrl+V) ✅
- [ ] **On local PC:** Copy `JAson.mqh` (Ctrl+C)
- [ ] **On VPS in MT5:** Navigate to: `MQL5\Include\`
- [ ] Paste file (Ctrl+V) ✅
- [ ] **Restart MT5** (File → Exit, then reopen)

### Option B: RDP Shared Folder (If copy-paste doesn't work)

- [ ] Disconnect from VPS
- [ ] In RDP window: Click "Show Options" → "Local Resources" tab
- [ ] Click "More..." → Check "Drives" → OK
- [ ] Reconnect to VPS
- [ ] On VPS: Open "This PC" → See local drive (e.g., "C on DESKTOP-PC")
- [ ] Copy EA files from local drive to MT5 folders
- [ ] Restart MT5

---

## ☑️ ENABLE WEBREQUEST (CRITICAL - 2 minutes)

**⚠️ EA WILL NOT WORK WITHOUT THIS STEP!**

- [ ] In MT5: Tools → Options
- [ ] Click "Expert Advisors" tab
- [ ] Check: ✅ "Allow WebRequest for listed URL:"
- [ ] Click "Add" button
- [ ] Enter exactly: `https://forex-market-anz.onrender.com`
- [ ] Click "OK"
- [ ] Check: ✅ "Allow Automated Trading"
- [ ] Click "OK"

---

## ☑️ EA CONFIGURATION - WEEK 1 DRY RUN (5 minutes)

- [ ] **Open chart:** File → New Chart → EURUSD (any timeframe)
- [ ] **Drag EA:** Navigator → Expert Advisors → Drag `ForexMarketANZ_EA` onto chart
- [ ] **Settings window appears** → Configure:

### API Configuration
- [ ] `API_BASE_URL` = `https://forex-market-anz.onrender.com`
- [ ] `API_USERNAME` = [your username] ✅
- [ ] `API_PASSWORD` = [your password] ✅
- [ ] `POLL_INTERVAL_SECONDS` = `60`

### Trading Configuration (DRY RUN MODE)
- [ ] `ACCOUNT_BALANCE_OVERRIDE` = `0.0`
- [ ] `TRADE_ENABLED` = **`false`** ✅ (DRY RUN - NO TRADES!)
- [ ] `HIGH_TIER_ONLY` = `true`
- [ ] `MIN_CONFIDENCE` = `85.0`

### Logging (MAX LOGGING FOR TESTING)
- [ ] `VERBOSE_LOGGING` = `true`
- [ ] `LOG_TO_FILE` = `true`
- [ ] `LOG_LEVEL` = `3` (DEBUG)

- [ ] Click "OK" to start EA

---

## ☑️ VERIFY EA IS RUNNING (2 minutes)

- [ ] **Check chart top-right:**
  - [ ] See "ForexMarketANZ_EA v1.0.0" ✅
  - [ ] See smiley face 😊 (not sad face ☹️)

- [ ] **Check Experts tab** (Toolbox at bottom → "Experts"):
  - [ ] See: `╔══════════════════════════════════════════════════════════════╗`
  - [ ] See: `║     ForexMarketANZ EA v1.0.0 - Initializing           ║`
  - [ ] See: `✅ Authentication successful`
  - [ ] See: `⏱️  Timer set: checking for signals every 60 seconds`
  - [ ] See: `✅ ForexMarketANZ EA initialized successfully`

- [ ] **Wait 60-120 seconds, then check for:**
  - [ ] See: `📡 Polling API for new signals...`
  - [ ] See: `📊 Received X active signal(s) from API`

**If you see all ✅ above:** EA is working perfectly!

**If you see ❌ errors:** Go to "TROUBLESHOOTING" section below.

---

## ☑️ WEEK 1 MONITORING (7 days)

**Check daily (1 minute):**
- [ ] Day 1: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 2: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 3: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 4: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 5: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 6: EA still running? Experts tab shows "📡 Polling API"?
- [ ] Day 7: EA still running? Experts tab shows "📡 Polling API"?

**Expected results after 7 days:**
- [ ] 3-7 HIGH tier signals detected (check logs for "📊 Received X active signal(s)")
- [ ] All signals logged with: "⏭️ Skipping signal (TRADE_ENABLED = false)"
- [ ] No trades executed (Trade tab should be empty)
- [ ] Zero errors (or <1% error rate on API polls)

**✅ If all checks passed:** Ready for Week 2 (demo trading)!

---

## ☑️ WEEK 2 CONFIGURATION - DEMO TRADING (2 minutes)

- [ ] **Right-click chart** → Expert Advisors → Properties
- [ ] **Change ONLY this setting:**
  - [ ] `TRADE_ENABLED` = **`true`** ✅ (ENABLE TRADING!)
- [ ] **Verify still on DEMO account:**
  - [ ] MT5 → File → Login to Trade Account → Check server is `FXPIG-Demo` ✅
- [ ] Click "OK"

**⚠️ DOUBLE-CHECK:** You are on **DEMO account**, NOT live!

---

## ☑️ WEEK 2 MONITORING (7 days)

**Check daily (5 minutes):**
- [ ] Day 1: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 2: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 3: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 4: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 5: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 6: Trades executed? Check Trade tab for open/closed positions
- [ ] Day 7: Trades executed? Check Trade tab for open/closed positions

**Expected results after 7 days:**
- [ ] 3-7 trades executed (check History tab)
- [ ] Each signal = 2 orders (partial profits: TP1 and TP3)
- [ ] Win rate: 60-75%
- [ ] Slippage: <2 pips average
- [ ] No order failures or circuit breaker trips

**Calculate performance:**
- [ ] Total signals: ______
- [ ] Total trades: ______ (should be 2× signals)
- [ ] Wins: ______
- [ ] Losses: ______
- [ ] Win rate: ______% (should be 60-75%)

**✅ If win rate 60-75% and no errors:** Ready for FXIFY approval!

---

## ☑️ FXIFY EA APPROVAL (3-5 days)

- [ ] **Record 3-minute video:**
  - [ ] Screen recording of VPS with MT5 open
  - [ ] Show: Signal received → EA executes 2 orders → Orders in Trade tab
  - [ ] Narrate: "This EA executes signals from my ICT 3-TF strategy website"

- [ ] **Compile performance report:**
  - [ ] Total signals: ______
  - [ ] Win rate: ______%
  - [ ] Profit: $______
  - [ ] Screenshot of demo account history

- [ ] **Email FXIFY:**
  - [ ] To: support@fxify.com
  - [ ] Subject: "EA Approval Request - Account #[your account]"
  - [ ] Body: "I request approval to use my automated EA. It executes signals from my proprietary ICT 3-Timeframe strategy. Attached: demo video + 2-week performance report."
  - [ ] Attach: Video + report

- [ ] **Wait for response** (24-48 hours)
- [ ] **Approval received?** ✅

---

## ☑️ GO LIVE (Day 1 of Month 1)

**⚠️ ONLY AFTER FXIFY APPROVAL RECEIVED!**

- [ ] **Switch to LIVE account:**
  - [ ] In MT5: File → Login to Trade Account
  - [ ] Server: `FXPIG-Live` ✅
  - [ ] Account: [FXIFY LIVE account number]
  - [ ] Password: [FXIFY LIVE password]
  - [ ] Click "Login"

- [ ] **Verify live connection:**
  - [ ] Bottom-right shows **green bars**
  - [ ] Navigator → Trade → Shows LIVE account number

- [ ] **Remove EA from demo chart:**
  - [ ] Right-click chart → Expert Advisors → Remove

- [ ] **Open new chart:**
  - [ ] File → New Chart → EURUSD

- [ ] **Attach EA to new chart:**
  - [ ] Drag `ForexMarketANZ_EA` onto chart
  - [ ] **Configure with PRODUCTION settings:**

### Production Settings (LIVE TRADING)
- [ ] `API_USERNAME` = [your username]
- [ ] `API_PASSWORD` = [your password]
- [ ] `TRADE_ENABLED` = **`true`** ✅ (LIVE!)
- [ ] `HIGH_TIER_ONLY` = `true`
- [ ] `VERBOSE_LOGGING` = **`false`** (reduce logging)
- [ ] `LOG_LEVEL` = **`1`** (warnings + errors only)
- [ ] All other settings: **KEEP DEFAULTS**

- [ ] Click "OK"

- [ ] **Verify EA running on LIVE:**
  - [ ] Chart shows "ForexMarketANZ_EA v1.0.0" ✅
  - [ ] Experts tab shows "✅ Authentication successful"
  - [ ] Wait 60 seconds → See "📡 Polling API for new signals..."

**🎉 CONGRATULATIONS! EA is now trading live on FXIFY!**

---

## ☑️ ONGOING MONITORING

### Daily (5 minutes)
- [ ] RDP into VPS
- [ ] Check MT5 is running (green bars)
- [ ] Check Experts tab for errors (should be minimal)
- [ ] Check Account tab: Current balance vs. starting balance

### Weekly (15 minutes)
- [ ] Review all trades executed
- [ ] Calculate win rate
- [ ] Compare to website FXIFY stats (https://forex-market-anz.pages.dev/admin)
- [ ] Check for any warnings in logs

### Monthly (30 minutes)
- [ ] Full performance analysis
- [ ] Total profit: Should be $10,000+ (matching manual)
- [ ] Win rate: Should be 65-75%
- [ ] Max drawdown: Should be <5%
- [ ] Circuit breaker trips: Should be 0
- [ ] API/order errors: Should be <1%

---

## 🚨 TROUBLESHOOTING QUICK FIXES

### ❌ "WebRequest failed: 4014"
**Fix:** Tools → Options → Expert Advisors → Add URL: `https://forex-market-anz.onrender.com`

### ❌ "Authentication failed"
**Fix:** Double-check username/password at https://forex-market-anz.pages.dev/login

### ❌ EA not in Navigator
**Fix:** Ensure files in correct folders (EA in Experts, JAson.mqh in Include) → Restart MT5

### ❌ Signals detected but no trades
**Fix:** Check `TRADE_ENABLED = true` OR signals might be MEDIUM tier (if `HIGH_TIER_ONLY = true`)

### ❌ "Circuit breaker tripped"
**Fix:** Check Experts tab for reason (daily loss/drawdown) → Wait for reset (daily) or investigate

### ❌ VPS disconnected
**Fix:** Reconnect via RDP → Check MT5 is still running → Restart if needed

### ❌ MT5 shows red bars (no connection)
**Fix:** File → Login to Trade Account → Re-enter credentials

**For detailed troubleshooting:** See `EA_CONFIGURATION_REFERENCE.md`

---

## 📊 SUCCESS METRICS

**Week 1 (Dry Run):**
- ✅ 3-7 signals detected
- ✅ Zero trades executed
- ✅ Zero errors

**Week 2 (Demo):**
- ✅ 3-7 signals executed (6-14 orders total)
- ✅ Win rate 60-75%
- ✅ Slippage <2 pips

**Month 1+ (Live):**
- ✅ Monthly profit: $10,000-$15,000
- ✅ Win rate: 65-75%
- ✅ Max drawdown: <5%
- ✅ Uptime: 99%+

---

## ✅ FINAL CHECKLIST

Before closing this guide, confirm:
- [ ] EA running 24/7 on VPS ✅
- [ ] Demo testing completed (2 weeks, 60%+ win rate) ✅
- [ ] FXIFY approval received ✅
- [ ] Live account trading successfully ✅
- [ ] Daily monitoring routine established ✅

**🎉 You are now fully automated! Expected profit: $10K-$15K/month with 90% less time.**

---

**Need help?** → Check `VPS_DEPLOYMENT_GUIDE.md` for detailed instructions
**Settings reference?** → Check `EA_CONFIGURATION_REFERENCE.md`
**How it works?** → Check `EA_README.md`

**Print Date:** ____________
**VPS IP:** ____________
**FXIFY Account:** ____________

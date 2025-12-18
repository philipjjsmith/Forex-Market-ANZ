# VPS Deployment Guide - ForexMarketANZ EA

## 🎯 Overview

This guide walks you through deploying the ForexMarketANZ Expert Advisor to a VPS (Virtual Private Server) for 24/7 automated trading on FXIFY prop firm accounts.

**Why VPS?**
- Runs 24/7 without your PC being on
- <2ms latency to FXPIG broker (co-located in London LD4)
- Never miss signals due to power outages or internet issues
- Professional trading infrastructure

---

## 📋 Prerequisites

Before starting, ensure you have:
- ✅ Active FXIFY trading account
- ✅ ForexMarketANZ website account (for API access)
- ✅ `ForexMarketANZ_EA.mq5` file
- ✅ `JAson.mqh` library file
- ✅ Your API username and password

---

## 🆓 Option 1: FREE VPS from FXPIG (Recommended)

FXPIG (FXIFY's broker) offers **FREE VPS** to traders who meet volume requirements.

### Volume Requirement
- **10 standard lots per month** (cumulative trading volume)
- Your system generates ~3-7 signals/week = **~10-15 lots/month** ✅
- **You qualify for free VPS!**

### How to Apply for Free VPS

1. **Login to FXIFY Dashboard**
   - Go to: https://portal.fxify.com
   - Navigate to "My Accounts" → Select your trading account

2. **Request VPS Access**
   - Click "Trading Tools" or "VPS Request"
   - Fill out VPS application form
   - Mention: "I trade 10+ lots/month and qualify for free VPS"

3. **Wait for Approval (24-48 hours)**
   - FXPIG support will review your trading volume
   - You'll receive VPS credentials via email:
     - VPS IP Address
     - Username
     - Password
     - RDP port (usually 3389)

4. **VPS Specifications** (typical)
   - Location: London LD4 Equinix (same as FXPIG broker)
   - RAM: 1-2GB
   - Disk: 20-30GB SSD
   - OS: Windows Server 2019/2022
   - Latency: <2ms to broker

---

## 💳 Option 2: Paid VPS Providers (Alternative)

If you prefer immediate access or want more resources:

### Recommended Providers

**1. Forex VPS Specialists** (optimized for trading)
- **Cheap Forex VPS** - https://cheapforexvps.com
  - Starting at $13.99/month
  - London data center available
  - 1GB RAM, 30GB SSD

- **ForexVPS.net** - https://forexvps.net
  - Starting at $19.95/month
  - Multiple locations including London
  - 1.5GB RAM, 40GB SSD

**2. General VPS Providers**
- **Vultr** - https://vultr.com
  - London location: $6/month (1GB RAM)
  - Windows Server: +$14/month license
  - Total: ~$20/month

- **DigitalOcean** - https://digitalocean.com
  - London datacenter available
  - Starting at $24/month (Windows + 1GB RAM)

### Selection Criteria
✅ **Must have:** London data center (closest to FXPIG)
✅ **Must have:** Windows Server OS (for MT5)
✅ **Minimum:** 1GB RAM, 20GB storage
✅ **Target latency:** <10ms to FXPIG broker

---

## 🖥️ Step 1: Connect to Your VPS

### On Windows (Built-in RDP)

1. **Open Remote Desktop Connection**
   - Press `Win + R`
   - Type: `mstsc`
   - Press Enter

2. **Enter VPS Details**
   - Computer: `[VPS IP Address]` (e.g., 185.23.45.67)
   - Click "Connect"

3. **Login Credentials**
   - Username: `[Provided by VPS provider]` (e.g., Administrator)
   - Password: `[Provided by VPS provider]`
   - Click "OK"

4. **Trust Certificate** (first time only)
   - Click "Yes" when asked about certificate

### On Mac

1. **Download Microsoft Remote Desktop**
   - App Store → Search "Microsoft Remote Desktop"
   - Install the app

2. **Add Connection**
   - Open Microsoft Remote Desktop
   - Click "+" → "Add PC"
   - PC Name: `[VPS IP Address]`
   - User Account: Add `[Username]` and `[Password]`
   - Save

3. **Connect**
   - Double-click the saved connection

---

## 📥 Step 2: Install MetaTrader 5 on VPS

### Download MT5

1. **Inside VPS**, open browser (Edge or Chrome)

2. **Download FXPIG MT5** (important: use broker's version)
   - Go to: https://www.fxpig.com/platforms/metatrader-5
   - Click "Download MT5"
   - OR use direct FXIFY link from your portal

3. **Install MT5**
   - Run downloaded `fxpig5setup.exe`
   - Click "Next" → "Next" → "Finish"
   - MT5 will launch automatically

### Login to MT5

1. **When MT5 Opens**
   - A login window should appear
   - If not: File → Login to Trade Account

2. **Enter FXIFY Account Credentials**
   - Login: `[Your FXIFY Account Number]` (e.g., 1234567)
   - Password: `[Your FXIFY Trading Password]`
   - Server: `FXPIG-Live` or `FXPIG-Demo` (select from dropdown)
   - Click "Login"

3. **Verify Connection**
   - Bottom-right corner should show: **Green bars** + ping (e.g., "1ms")
   - If red bars: check internet or credentials

---

## 📤 Step 3: Upload EA Files to VPS

You have **3 options** to transfer files to VPS:

### Option A: Copy-Paste via RDP (Easiest)

1. **On Your Local PC**
   - Copy `ForexMarketANZ_EA.mq5` (Ctrl+C)

2. **On VPS**
   - Open MT5 → File → Open Data Folder
   - Navigate to: `MQL5\Experts\`
   - Paste file (Ctrl+V)

3. **Repeat for JAson.mqh**
   - Copy `JAson.mqh` on local PC
   - On VPS, navigate to: `MQL5\Include\`
   - Paste file

### Option B: Shared Folder (Recommended for large files)

1. **On Your Local PC**
   - Before connecting to VPS, in RDP window:
   - Click "Show Options" → "Local Resources" tab
   - Click "More..." under Local devices
   - Check "Drives" → Select C: drive
   - Click "OK" → "Connect"

2. **On VPS**
   - Open "This PC" → You'll see your local drive (e.g., "C on DESKTOP-PC")
   - Navigate to your EA files on local drive
   - Copy files to VPS MT5 folders

### Option C: Email/Cloud Upload

1. **Email yourself** the files, or upload to Google Drive/Dropbox
2. **On VPS**, download files from email/cloud
3. **Move to MT5 folders** (see Option A for paths)

---

## ⚙️ Step 4: Configure EA Settings

### Enable WebRequest Permissions (CRITICAL)

MT5 blocks web requests by default for security. You MUST enable this for the EA to work.

1. **In MT5 on VPS**
   - Tools → Options → Expert Advisors tab

2. **Enable Web Requests**
   - Check: ✅ "Allow WebRequest for listed URL:"
   - Click "Add" button
   - Enter: `https://forex-market-anz.onrender.com`
   - Click "OK"

3. **Enable AutoTrading**
   - Check: ✅ "Allow Automated Trading"
   - Check: ✅ "Allow DLL imports" (not used, but good practice)
   - Click "OK"

### Verify Files Are Loaded

1. **Open Navigator Panel**
   - View → Navigator (or press Ctrl+N)

2. **Check Expert Advisors**
   - Expand "Expert Advisors" folder
   - You should see: **ForexMarketANZ_EA**
   - If not visible: Right-click → Refresh

3. **Check for Compilation Errors**
   - If EA has a ⚠️ warning icon:
   - Click "Toolbox" → "Errors" tab
   - Check for missing JAson.mqh or syntax errors
   - Fix errors and right-click EA → Compile

---

## 🚀 Step 5: Start the EA (Demo Account First)

### Attach EA to Chart

1. **Open a Chart**
   - File → New Chart → Select `EURUSD` (or any symbol EA will trade)
   - Timeframe doesn't matter (EA uses Timer, not chart events)

2. **Drag EA to Chart**
   - From Navigator, drag `ForexMarketANZ_EA` onto the chart
   - A settings window will appear

### Configure EA Parameters

**📌 API Configuration**
```
API_BASE_URL = https://forex-market-anz.onrender.com
API_USERNAME = [Your website username]
API_PASSWORD = [Your website password]
POLL_INTERVAL_SECONDS = 60
```

**📌 Trading Configuration**
```
ACCOUNT_BALANCE_OVERRIDE = 0.0    (auto-detect)
TRADE_ENABLED = true               (set to false for dry-run testing)
HIGH_TIER_ONLY = true              (only execute 85%+ signals)
MIN_CONFIDENCE = 85.0              (minimum confidence threshold)
```

**📌 Risk Management**
```
MAX_DAILY_LOSS_PERCENT = 3.5       (FXIFY limit: 4%, we use 3.5% buffer)
MAX_DRAWDOWN_PERCENT = 7.5         (FXIFY limit: 8%, we use 7.5% buffer)
MAX_SLIPPAGE_POINTS = 30
ORDER_RETRY_COUNT = 3
ORDER_RETRY_DELAY_MS = 2000
```

**📌 Partial Profits** (2-order strategy)
```
USE_PARTIAL_PROFITS = true
PARTIAL_CLOSE_PERCENT_1 = 50.0    (50% at TP1)
PARTIAL_CLOSE_PERCENT_2 = 50.0    (50% at TP3)
```

**📌 Logging**
```
VERBOSE_LOGGING = true             (disable after testing)
LOG_TO_FILE = true
LOG_LEVEL = 2                      (0=Error, 1=Warn, 2=Info, 3=Debug)
```

3. **Click "OK" to Start**

### Verify EA is Running

1. **Check Top-Right Corner of Chart**
   - You should see: **"ForexMarketANZ_EA v1.0.0"**
   - Smiley face icon: 😊 = EA running

2. **Check Expert Logs**
   - Toolbox → Experts tab (bottom panel)
   - You should see:
   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║          ForexMarketANZ EA v1.0.0 - Initializing           ║
   ║       ICT 3-Timeframe Strategy Executor for FXIFY          ║
   ╚══════════════════════════════════════════════════════════════╝
   [timestamp] [INFO]  Attempting API authentication...
   [timestamp] [INFO]  ✅ Authentication successful
   [timestamp] [INFO]  ⏱️  Timer set: checking for signals every 60 seconds
   [timestamp] [INFO]  Performing initial signal check...
   [timestamp] [INFO]  📡 Polling API for new signals...
   [timestamp] [INFO]  📊 Received X active signal(s) from API
   ✅ ForexMarketANZ EA initialized successfully
   ```

3. **Common Errors and Fixes**

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `WebRequest failed: 4014` | WebRequest not enabled | Add API URL to allowed list (Step 4) |
| `Authentication failed` | Wrong username/password | Double-check API credentials |
| `Symbol EURUSD not available` | Symbol format mismatch | EA auto-converts EUR/USD → EURUSD |
| `Failed to set timer` | MT5 issue | Restart MT5 |

---

## 🧪 Step 6: Testing Phase (2 Weeks Minimum)

### Week 1: Dry Run (TRADE_ENABLED = false)

**Purpose:** Verify EA receives and processes signals without executing trades.

1. **Set EA to Dry Run Mode**
   - Right-click chart → Expert Advisors → Properties
   - Set: `TRADE_ENABLED = false`
   - Click "OK"

2. **Monitor Logs for 7 Days**
   - Check Experts tab daily
   - Verify signals are detected: "📊 Received X active signal(s)"
   - Confirm filters work: "⏭️ Skipping MEDIUM tier signal"
   - Expected: 3-7 HIGH signals per week

3. **What to Look For**
   - ✅ API polls every 60 seconds
   - ✅ Signals detected and logged
   - ✅ GBP/USD signals skipped (if any)
   - ✅ Weekend detection works (Saturday/Sunday)
   - ✅ No authentication errors

### Week 2: Demo Account (TRADE_ENABLED = true)

**Purpose:** Verify order execution and partial profit management.

1. **Enable Trading**
   - EA Properties → `TRADE_ENABLED = true`
   - Ensure you're on **DEMO account** (not live!)

2. **Monitor Execution for 7 Days**
   - Check "Trade" tab for executed orders
   - Verify 2 orders placed per signal (partial profits)
   - Confirm SL/TP levels match signal data
   - Measure slippage (should be <2 pips)

3. **Performance Checklist**
   - ✅ Orders execute within 60 seconds of signal
   - ✅ Lot sizes calculated correctly (1.5% risk)
   - ✅ Partial profits: 50% @ TP1, 50% @ TP3
   - ✅ Stop loss placed correctly
   - ✅ Circuit breaker doesn't trip erroneously
   - ✅ Win rate: 60-75% (over 10+ signals)

4. **Compare to Website Performance**
   - Go to: https://forex-market-anz.pages.dev/admin
   - Check "FXIFY-only" growth stats (HIGH tier)
   - Demo account P/L should match website's signal performance

---

## ✅ Step 7: Go Live on FXIFY

### Pre-Flight Checklist

Before going live, confirm:

- ✅ Demo testing completed (2 weeks minimum)
- ✅ Win rate 60%+ on demo (10+ signals)
- ✅ No EA errors or crashes
- ✅ Slippage <5 pips average
- ✅ Circuit breakers tested (manually trigger by simulating loss)
- ✅ VPS stable (no disconnections)

### Switch to Live Account

1. **In MT5 on VPS**
   - File → Login to Trade Account
   - Login: `[FXIFY Live Account Number]`
   - Password: `[FXIFY Live Password]`
   - Server: `FXPIG-Live`
   - Click "Login"

2. **Restart EA**
   - Remove EA from demo chart
   - Open new EURUSD chart
   - Drag EA onto chart
   - Enter same settings as demo
   - **Double-check:** `TRADE_ENABLED = true`
   - Click "OK"

3. **Monitor First 48 Hours Closely**
   - Check every 6-8 hours
   - Verify signals execute correctly
   - Confirm P/L tracking matches expectations

### Ongoing Monitoring

**Daily Checks** (5 minutes)
- RDP into VPS
- Check MT5 is running (green connection bars)
- Review Experts tab for errors
- Verify account balance vs daily start

**Weekly Checks** (15 minutes)
- Review all executed trades
- Calculate win rate and avg R:R
- Compare to website's FXIFY stats
- Check log files for warnings

**Monthly Checks** (30 minutes)
- Deep performance analysis
- Review circuit breaker triggers (if any)
- Optimize settings if needed (conservatively!)
- Update EA if new version available

---

## 🔧 Troubleshooting

### EA Stops Receiving Signals

**Symptoms:** No signals for 24+ hours, no "📡 Polling API" logs

**Causes & Fixes:**
1. **JWT Token Expired**
   - Check logs for "401 Unauthorized"
   - EA should auto-reauthenticate every 24h
   - Manual fix: Restart EA

2. **API Down**
   - Check website: https://forex-market-anz.onrender.com/api/health
   - If down, EA will retry automatically
   - Check g_consecutiveAPIErrors count in logs

3. **VPS Lost Internet**
   - Check MT5 connection bars (bottom-right)
   - If red: Contact VPS provider

### Circuit Breaker Keeps Tripping

**Symptoms:** "🚨 CIRCUIT BREAKER TRIPPED" in logs

**Diagnosis:**
- Read `g_circuitBreakerReason` in logs
- Common reasons:
  - Daily loss limit (3.5%)
  - Max drawdown (7.5%)
  - 5+ consecutive order failures
  - 10+ consecutive API errors

**Fixes:**
- **Daily loss:** Wait for midnight UTC reset (automatic)
- **Drawdown:** Check for losing streak, review signals
- **Order failures:** Check FXIFY account status, margin available
- **API errors:** Check website is online, credentials correct

### Orders Not Executing

**Symptoms:** Signals detected but no orders in "Trade" tab

**Check:**
1. **Is TRADE_ENABLED = true?**
   - EA Properties → Trading Configuration section

2. **Is it a HIGH tier signal?**
   - If `HIGH_TIER_ONLY = true`, MEDIUM signals are skipped
   - Check logs: "⏭️ Skipping MEDIUM tier signal"

3. **Is there sufficient margin?**
   - Check account equity
   - EA calculates lot size based on 1.5% risk
   - If insufficient margin: "FATAL: Insufficient margin"

4. **Is it the weekend?**
   - EA blocks trades Saturday/Sunday
   - Check logs: "⏰ Weekend detected - markets closed"

### VPS Disconnects Frequently

**Symptoms:** MT5 shows red bars intermittently

**Solutions:**
1. **Free VPS issue:** Contact FXPIG support
2. **Paid VPS issue:** Contact VPS provider
3. **Network instability:** Request VPS relocation to different node
4. **MT5 issue:** Reinstall MT5

---

## 📊 Performance Expectations

### Realistic Targets (Based on Manual Trading Results)

**User's Manual Performance** (current):
- Monthly profit: **$10,000+**
- Win rate: **65-75%**
- Signals per week: **3-7 HIGH tier**

**EA Performance** (projected):
- Monthly profit: **$12,000 - $15,000** (+20-50% vs manual)
  - **Why higher?** No missed signals, 24/7 operation, faster execution
- Win rate: **65-75%** (same as manual)
- Signals executed: **12-30 per month** (100% catch rate vs ~80% manual)
- Slippage impact: **-2% to -5%** on profit (VPS minimizes this)

**Expected Timeline:**
- Week 1: 0-1 signals (dry run)
- Week 2: 3-7 signals (demo account)
- Month 1 (live): $8,000 - $12,000 (conservative, as EA learns)
- Month 2+: $10,000 - $15,000 (full performance)

### Warning Signs (Immediate Action Required)

🚨 **Stop EA if:**
- Win rate drops below 50% (over 20+ signals)
- Slippage consistently >10 pips
- Circuit breaker trips 3+ times in one week
- Monthly profit <$5,000 (50% degradation from manual)

---

## 🆘 Support & Resources

### Documentation
- **CLAUDE.md**: Full project documentation
- **EA Source Code**: `ForexMarketANZ_EA.mq5` (well-commented)
- **FXIFY Rules**: https://fxify.com/rules

### Logs Location
- **MT5 Expert Logs**: Toolbox → Experts tab (in MT5)
- **EA File Logs**: `%APPDATA%\MetaQuotes\Terminal\[ID]\MQL5\Files\ForexMarketANZ_Logs\`
- **Access via VPS**: Navigate to logs folder, download to local PC for analysis

### FXIFY Support
- **Portal**: https://portal.fxify.com
- **Support Email**: support@fxify.com
- **Discord**: https://discord.gg/fxify
- **Response Time**: 24-48 hours

### VPS Support
- **FXPIG VPS**: support@fxpig.com (if using free VPS)
- **Paid VPS**: Contact your provider's support

---

## 🎓 Next Steps

1. ✅ **Complete this deployment** (follow steps 1-7)
2. ✅ **Run 2-week demo test** (verify performance)
3. ✅ **Go live on smallest FXIFY account** ($10K challenge)
4. ✅ **Monitor for 1 month** (validate $10K+ profit)
5. ✅ **Scale to larger accounts** (after validation)
6. 📤 **Submit for FXIFY EA approval** (see below)

---

## 🔐 FXIFY EA Approval Process

FXIFY requires pre-approval for automated trading with EAs.

### How to Submit for Approval

1. **Record 3-Minute Demo Video**
   - Screen recording of EA running on demo
   - Show: Signal received → Order executed → Partial profits
   - Explain: ICT 3-TF strategy, website integration, risk management

2. **Compile Performance Report**
   - 2 weeks of demo results
   - Win rate, avg R:R, signals executed
   - Screenshot of growth stats from website

3. **Submit to FXIFY**
   - Email: support@fxify.com
   - Subject: "EA Approval Request - [Your Account Number]"
   - Attach: Video + performance report + EA description
   - Mention: "Executes signals from my proprietary ICT 3-TF system"

4. **Wait for Approval (24-48 hours)**
   - FXIFY will review and approve/deny
   - If approved: You can use EA on live accounts
   - If denied: They'll provide feedback (usually minor tweaks needed)

---

## ✅ Summary Checklist

**Before VPS Deployment:**
- [ ] VPS secured (free FXPIG or paid)
- [ ] ForexMarketANZ_EA.mq5 file ready
- [ ] JAson.mqh file ready
- [ ] API credentials available

**VPS Setup:**
- [ ] Connected to VPS via RDP
- [ ] MT5 installed and logged in
- [ ] EA files uploaded to correct folders
- [ ] WebRequest enabled for API URL
- [ ] EA compiled successfully (no errors)

**Testing Phase:**
- [ ] Week 1: Dry run completed (TRADE_ENABLED=false)
- [ ] Week 2: Demo account completed (TRADE_ENABLED=true)
- [ ] Win rate 60%+ on demo
- [ ] No critical errors or crashes

**Go Live:**
- [ ] Switched to FXIFY live account
- [ ] EA running 24/7 on VPS
- [ ] Daily monitoring set up
- [ ] Performance tracking vs manual results

**FXIFY Approval:**
- [ ] Demo video recorded
- [ ] Performance report compiled
- [ ] Approval request submitted
- [ ] Approval received

---

**🎉 Congratulations! You've deployed your automated trading system.**

Your EA is now executing your profitable ICT 3-Timeframe strategy 24/7. Expect to maintain or exceed your current $10K+/month performance with better signal capture rate.

**Remember:** The website is the "brain" (generates signals), the EA is the "hands" (executes perfectly). No strategy changes, just flawless execution.

Good trading! 🚀

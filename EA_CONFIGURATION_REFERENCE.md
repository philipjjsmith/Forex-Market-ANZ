# EA Configuration Reference - ForexMarketANZ

## Quick Reference Guide for EA Parameters

---

## 🔧 Essential Settings (Must Configure)

### API Configuration

| Parameter | Type | **Required Value** | Description |
|-----------|------|-------------------|-------------|
| `API_BASE_URL` | string | `https://forex-market-anz.onrender.com` | API endpoint (do not change) |
| `API_USERNAME` | string | **[YOUR USERNAME]** | Website login username |
| `API_PASSWORD` | string | **[YOUR PASSWORD]** | Website login password |
| `POLL_INTERVAL_SECONDS` | int | `60` | How often to check for signals (seconds) |

**⚠️ CRITICAL:** You MUST enter your API_USERNAME and API_PASSWORD or EA will not work.

---

## ⚙️ Standard Settings (Recommended Defaults)

### Trading Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ACCOUNT_BALANCE_OVERRIDE` | double | `0.0` | Manual balance (0 = auto-detect from account) |
| `TRADE_ENABLED` | bool | `true` | Execute trades (false = dry run mode) |
| `HIGH_TIER_ONLY` | bool | `true` | Only execute HIGH tier signals (85%+) |
| `MIN_CONFIDENCE` | double | `85.0` | Minimum confidence threshold (%) |

**Testing Mode:** Set `TRADE_ENABLED = false` for dry-run testing (logs signals without executing).

### Risk Management (FXIFY Compliant)

| Parameter | Type | Default | Why This Value? |
|-----------|------|---------|-----------------|
| `MAX_DAILY_LOSS_PERCENT` | double | `3.5` | FXIFY limit is 4%, we use 3.5% buffer |
| `MAX_DRAWDOWN_PERCENT` | double | `7.5` | FXIFY limit is 8%, we use 7.5% buffer |
| `MAX_SLIPPAGE_POINTS` | int | `30` | Max acceptable slippage (3 pips) |
| `ORDER_RETRY_COUNT` | int | `3` | Order placement retry attempts |
| `ORDER_RETRY_DELAY_MS` | int | `2000` | Delay between retries (milliseconds) |

**⚠️ DO NOT CHANGE** risk limits unless you understand FXIFY rules. These values include safety buffers.

### Partial Profit Management

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `USE_PARTIAL_PROFITS` | bool | `true` | Enable 2-order partial profit strategy |
| `PARTIAL_CLOSE_PERCENT_1` | double | `50.0` | % closed at TP1 (3.0x ATR) |
| `PARTIAL_CLOSE_PERCENT_2` | double | `50.0` | % closed at TP3 (12.0x ATR) |

**How it works:**
- EA places **2 orders** per signal
- Order 1: 50% of total position → exits at TP1 (closer target)
- Order 2: 50% of total position → exits at TP3 (farther target)
- Both orders share the same stop loss

**Must sum to 100%:** `PARTIAL_CLOSE_PERCENT_1 + PARTIAL_CLOSE_PERCENT_2 = 100.0`

### Logging & Diagnostics

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `VERBOSE_LOGGING` | bool | `true` | Enable detailed logging (disable after testing) |
| `LOG_TO_FILE` | bool | `true` | Write logs to file in addition to MT5 |
| `LOG_LEVEL` | int | `2` | 0=Error, 1=Warning, 2=Info, 3=Debug |

**Performance tip:** Set `VERBOSE_LOGGING = false` and `LOG_LEVEL = 1` after 1 month of stable operation to reduce CPU usage.

---

## 📋 Configuration Scenarios

### Scenario 1: Initial Testing (Dry Run)

Use these settings for your first week to verify EA receives signals without executing trades.

```
API_USERNAME = [your_username]
API_PASSWORD = [your_password]
TRADE_ENABLED = false           ← DRY RUN MODE
VERBOSE_LOGGING = true
LOG_LEVEL = 3                   ← MAXIMUM LOGGING
```

**What happens:** EA logs all signals but does NOT place orders.

### Scenario 2: Demo Account Testing

Use these settings for week 2 to test order execution on demo account.

```
API_USERNAME = [your_username]
API_PASSWORD = [your_password]
TRADE_ENABLED = true            ← EXECUTE TRADES
HIGH_TIER_ONLY = true
VERBOSE_LOGGING = true
LOG_LEVEL = 2
```

**What happens:** EA executes HIGH tier signals on demo account. Monitor for 2 weeks.

### Scenario 3: Live FXIFY Trading

Use these settings after demo testing passes (60%+ win rate, no errors).

```
API_USERNAME = [your_username]
API_PASSWORD = [your_password]
TRADE_ENABLED = true
HIGH_TIER_ONLY = true
VERBOSE_LOGGING = false         ← REDUCED LOGGING
LOG_LEVEL = 1                   ← WARNINGS + ERRORS ONLY
```

**What happens:** Production mode. EA executes signals, logs only important events.

### Scenario 4: Conservative Mode (Lower Risk)

If you want to trade more conservatively than the website's 1.5% risk:

**Option A:** Use `ACCOUNT_BALANCE_OVERRIDE` to "lie" about balance
```
ACCOUNT_BALANCE_OVERRIDE = 50000   ← Tell EA account has $50K
(Actual account: $100K)
Result: EA risks 1.5% of $50K = $750 per trade (0.75% of real balance)
```

**Option B:** Manually adjust position sizing in code (advanced)
- Edit line ~903 in EA: `double positionSizePercent = signal["positionSizePercent"].ToDbl();`
- Change to: `double positionSizePercent = signal["positionSizePercent"].ToDbl() * 0.5;`
- Result: Halves all position sizes (1.5% → 0.75%)

**⚠️ WARNING:** Reducing risk also reduces profit. $10K/month becomes $5K/month.

### Scenario 5: Include MEDIUM Tier Signals (More Trades)

If you want to execute MEDIUM tier signals (70-84% confidence) in addition to HIGH tier:

```
HIGH_TIER_ONLY = false          ← EXECUTE MEDIUM + HIGH
MIN_CONFIDENCE = 70.0           ← MINIMUM 70%
```

**Trade-off:**
- ✅ More signals (~10-20/month vs 12-30/month)
- ❌ Lower win rate (~55-65% vs 65-75%)
- ❌ Higher drawdown risk

**Recommendation:** Stick with `HIGH_TIER_ONLY = true` (proven $10K+/month).

---

## 🛠️ Advanced Settings

### Custom Polling Interval

Default: Check for signals every 60 seconds.

**Faster polling (30 seconds):**
```
POLL_INTERVAL_SECONDS = 30
```
- ✅ Slightly faster execution (catch signals 30s earlier)
- ❌ More API calls (720/day vs 1,440/day)

**Slower polling (120 seconds):**
```
POLL_INTERVAL_SECONDS = 120
```
- ✅ Fewer API calls (reduces server load)
- ❌ Slower execution (up to 2min delay)

**Recommendation:** Keep at 60 seconds (optimal balance).

### Custom Slippage Tolerance

Default: 30 points (3 pips for 5-decimal brokers like FXPIG).

**Tighter slippage (20 points = 2 pips):**
```
MAX_SLIPPAGE_POINTS = 20
```
- ✅ Better fills (closer to expected price)
- ❌ More order rejections during volatility

**Looser slippage (50 points = 5 pips):**
```
MAX_SLIPPAGE_POINTS = 50
```
- ✅ Fewer order rejections
- ❌ Worse fills (can erode profit)

**Recommendation:** Keep at 30 points (industry standard for VPS trading).

---

## 🚨 Troubleshooting Common Misconfigurations

### Issue: EA says "Not authenticated"

**Cause:** Wrong `API_USERNAME` or `API_PASSWORD`

**Fix:**
1. Verify credentials at: https://forex-market-anz.pages.dev/login
2. Update EA parameters
3. Restart EA

### Issue: EA says "WebRequest failed: 4014"

**Cause:** `API_BASE_URL` not added to MT5 allowed list

**Fix:**
1. Tools → Options → Expert Advisors
2. Check "Allow WebRequest for listed URL"
3. Add: `https://forex-market-anz.onrender.com`
4. Restart MT5

### Issue: EA detects signals but doesn't trade

**Possible causes:**

**1. TRADE_ENABLED = false**
- Check EA parameters → Set to `true`

**2. Signals are MEDIUM tier but HIGH_TIER_ONLY = true**
- Check logs: "⏭️ Skipping MEDIUM tier signal"
- Either: Wait for HIGH signals, or set `HIGH_TIER_ONLY = false`

**3. Confidence below MIN_CONFIDENCE**
- Check logs: "⏭️ Skipping signal (confidence XX% < threshold YY%)"
- Lower `MIN_CONFIDENCE` (not recommended)

**4. Weekend markets closed**
- Check logs: "⏰ Weekend detected - markets closed"
- Wait for Monday 00:00 UTC

### Issue: Circuit breaker keeps tripping

**Cause:** Daily loss or max drawdown exceeded

**Check logs for reason:**
```
🚨 CIRCUIT BREAKER TRIPPED
Reason: Daily loss limit reached: 3.7% (limit: 3.5%)
```

**Fixes:**
- **Daily loss:** Wait for midnight UTC reset (automatic)
- **Max drawdown:** Review trading performance, may need to pause and analyze
- **Consecutive errors:** Check MT5 connection, FXIFY account status

### Issue: Partial profits not working (only 1 order placed)

**Cause:** `USE_PARTIAL_PROFITS = false` or percentages don't sum to 100%

**Fix:**
```
USE_PARTIAL_PROFITS = true
PARTIAL_CLOSE_PERCENT_1 = 50.0
PARTIAL_CLOSE_PERCENT_2 = 50.0
(Must sum to 100%)
```

---

## 📊 Monitoring EA Performance

### Key Metrics to Track

**Daily:**
- Number of signals detected
- Number of orders executed
- Win rate (running total)
- Daily P/L vs daily start balance

**Weekly:**
- Total signals: Should be 3-7 HIGH tier
- Execution rate: Should be 100% (all signals executed)
- Average slippage: Should be <2 pips
- Win rate: Should be 60-75%

**Monthly:**
- Total profit: Should be $10K+ (matching manual performance)
- Circuit breaker trips: Should be 0
- API errors: Should be <1%
- Drawdown: Should be <5%

### Where to Find Metrics

**In MT5:**
- Account tab: Current balance, equity, P/L
- History tab: All closed trades
- Experts tab: EA logs with signal details

**In Website:**
- https://forex-market-anz.pages.dev/admin
- "FXIFY-only" growth stats (HIGH tier signals)
- Compare EA results to website's signal performance

**Log Files:**
- VPS location: `%APPDATA%\MetaQuotes\Terminal\[ID]\MQL5\Files\ForexMarketANZ_Logs\`
- Contains detailed logs with timestamps

---

## ✅ Best Practices

### DO:
✅ Test on demo for 2 weeks minimum
✅ Monitor daily for first month
✅ Keep `VERBOSE_LOGGING = true` for first 2 weeks
✅ Use VPS (don't run on local PC)
✅ Stick with default risk settings
✅ Compare EA performance to website's FXIFY stats

### DON'T:
❌ Change risk limits without understanding FXIFY rules
❌ Disable circuit breakers
❌ Run on live account without demo testing
❌ Trade MEDIUM tier signals unless you accept lower win rate
❌ Modify EA code unless you're experienced with MQL5
❌ Use on multiple accounts with same API credentials (rate limiting)

---

## 🔗 Related Documentation

- **Full Deployment Guide:** `VPS_DEPLOYMENT_GUIDE.md` (step-by-step VPS setup)
- **Project Overview:** `CLAUDE.md` (complete system documentation)
- **EA Source Code:** `ForexMarketANZ_EA.mq5` (well-commented, review for advanced customization)

---

## 📞 Support

**EA Issues:**
- Check `VPS_DEPLOYMENT_GUIDE.md` → Troubleshooting section
- Review EA logs in MT5 Experts tab
- Review file logs in `ForexMarketANZ_Logs` folder

**API/Website Issues:**
- Check API health: https://forex-market-anz.onrender.com/api/health
- Verify credentials at website login

**FXIFY Account Issues:**
- Contact FXIFY support: support@fxify.com
- Check account status in portal: https://portal.fxify.com

---

**Last Updated:** 2025-12-11
**EA Version:** v1.0.0
**Compatible with:** MetaTrader 5, FXIFY/FXPIG broker

# MILESTONE 3B & 3C - DEFERRED UNTIL SUFFICIENT DATA

**Status:** Waiting for 30+ completed signals per symbol (currently 4 for USD/JPY)

**Estimated Timeline:** 1-2 weeks from Oct 19, 2025

**Check Progress:** Run `curl https://forex-market-anz.onrender.com/api/ai/insights` to see signal counts

---

## 📊 CURRENT DATA STATUS (as of Oct 19, 2025)

**Completed Signals:**
- USD/JPY: 4 signals (13% of minimum 30)
- EUR/USD: 0 signals
- GBP/USD: 0 signals
- AUD/USD: 0 signals
- USD/CHF: 0 signals

**Overall Performance:**
- Total: 23 signals tracked
- Completed: 4 (17.4%)
- Win Rate: 25% (1 TP1_HIT, 2 STOP_HIT, 1 MANUALLY_CLOSED)

**What We Need:**
- Minimum: 30 completed signals per symbol
- Ideal: 50+ completed signals per symbol
- Why: Statistical significance for backtesting

---

## ⏳ MILESTONE 3B: BACKTESTING ENGINE (75% CONFIDENT - NEEDS DATA)

### **Goal:** Test different strategy parameters on historical data to find optimal settings

### **Prerequisites:**
- ✅ 30+ completed signals per symbol (USD/JPY closest at 4/30)
- ✅ `signal_history.candles` JSONB has 200 candles per signal
- ✅ Outcome data (TP1_HIT/STOP_HIT) available

### **What It Does:**

**1. Parameter Testing**

Test different combinations:
- **EMA Periods:** 15/45, 20/50, 25/55, 30/60
- **ATR Multipliers:** 1.5x, 2.0x, 2.5x, 3.0x
- **Confidence Thresholds:** 50%, 60%, 70%

**2. Simulation Algorithm**

For each symbol with 30+ signals:
```typescript
async function backtestParameters(symbol: string): Promise<void> {
  // 1. Fetch all completed signals for this symbol
  const completedSignals = await db.execute(sql`
    SELECT
      candles,
      outcome,
      profit_loss_pips,
      type,
      entry_price,
      stop_loss,
      tp1
    FROM signal_history
    WHERE symbol = ${symbol}
      AND outcome != 'PENDING'
  `);

  if (completedSignals.length < 30) {
    console.log(`⚠️  ${symbol}: Not enough data (${completedSignals.length}/30)`);
    return;
  }

  console.log(`🔬 Backtesting ${symbol} with ${completedSignals.length} signals`);

  // 2. Test different parameter combinations
  const emaTests = [
    { fast: 15, slow: 45, name: '15/45 EMA' },
    { fast: 20, slow: 50, name: '20/50 EMA' },  // Current default
    { fast: 25, slow: 55, name: '25/55 EMA' },
  ];

  const atrTests = [
    { multiplier: 1.5, name: '1.5x ATR' },
    { multiplier: 2.0, name: '2.0x ATR' },  // Current default
    { multiplier: 2.5, name: '2.5x ATR' },
  ];

  let bestConfig = null;
  let bestWinRate = 0;
  const currentWinRate = await getCurrentWinRate(symbol);

  // 3. Test all combinations
  for (const ema of emaTests) {
    for (const atr of atrTests) {
      let wins = 0;
      let total = 0;

      // Re-analyze each signal with new parameters
      for (const signal of completedSignals) {
        const candles = JSON.parse(signal.candles);

        // Simulate strategy with different parameters
        const hypotheticalSignal = simulateStrategy(
          candles,
          ema.fast,
          ema.slow,
          atr.multiplier
        );

        // Skip if this combo wouldn't generate signal
        if (!hypotheticalSignal) continue;

        total++;

        // Check if this signal actually won
        const actuallyWon = ['TP1_HIT', 'TP2_HIT', 'TP3_HIT'].includes(signal.outcome);

        if (actuallyWon) wins++;
      }

      const winRate = total > 0 ? (wins / total) * 100 : 0;
      const improvement = winRate - currentWinRate;

      console.log(`  ${ema.name} + ${atr.name}: ${winRate.toFixed(1)}% (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%)`);

      // Track best configuration
      if (winRate > bestWinRate && total >= 20) {  // Require 20+ signals for this combo
        bestWinRate = winRate;
        bestConfig = { ema, atr, winRate, total, improvement };
      }
    }
  }

  // 4. Generate recommendation if improvement > 5%
  if (bestConfig && bestConfig.improvement > 5) {
    await createRecommendation(symbol, bestConfig);
  } else {
    console.log(`  ✅ ${symbol}: Current parameters are optimal`);
  }
}
```

**3. Strategy Simulation**

Re-run strategy with different parameters:
```typescript
function simulateStrategy(
  candles: Candle[],
  fastPeriod: number,
  slowPeriod: number,
  atrMultiplier: number
): Signal | null {
  // Calculate indicators with new periods
  const closes = candles.map(c => c.close);
  const fastMA = Indicators.ema(closes, fastPeriod);
  const slowMA = Indicators.ema(closes, slowPeriod);
  const atr = Indicators.atr(candles, 14);

  if (!fastMA || !slowMA || !atr) return null;

  // Check for crossover with new parameters
  const prevFastMA = Indicators.ema(closes.slice(0, -1), fastPeriod);
  const prevSlowMA = Indicators.ema(closes.slice(0, -1), slowPeriod);

  if (!prevFastMA || !prevSlowMA) return null;

  const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
  const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

  if (!bullishCross && !bearishCross) return null;

  // Calculate stop with new ATR multiplier
  const currentPrice = closes[closes.length - 1];
  const signalType = bullishCross ? 'LONG' : 'SHORT';

  const stop = signalType === 'LONG'
    ? currentPrice - (atr * atrMultiplier)
    : currentPrice + (atr * atrMultiplier);

  // Return hypothetical signal
  return {
    type: signalType,
    entry: currentPrice,
    stop,
    // ... rest of signal
  };
}
```

**4. Recommendation Creation**

Insert into `strategy_adaptations` table:
```typescript
async function createRecommendation(
  symbol: string,
  bestConfig: BacktestResult
): Promise<void> {
  const { ema, atr, improvement, total } = bestConfig;

  await db.execute(sql`
    INSERT INTO strategy_adaptations (
      user_id,
      pattern_detected,
      confidence_bracket,
      symbol,
      recommendation_title,
      recommendation_details,
      reasoning,
      suggested_changes,
      expected_win_rate_improvement,
      based_on_signals,
      old_strategy_version,
      status
    ) VALUES (
      'ai-system',
      ${`${symbol} shows better performance with ${ema.fast}/${ema.slow} EMA and ${atr.multiplier}x ATR`},
      'ALL',
      ${symbol},
      ${`Optimize ${symbol} Strategy Parameters`},
      ${`Switch from 20/50 EMA to ${ema.fast}/${ema.slow} EMA and ${atr.multiplier}x ATR stop loss`},
      ${`Backtesting on ${total} historical signals shows ${improvement.toFixed(1)}% win rate improvement. ` +
        `${ema.fast}/${ema.slow} EMA catches trends earlier, and ${atr.multiplier}x ATR provides ` +
        `${atr.multiplier > 2 ? 'more room for volatility' : 'tighter risk management'}.`},
      ${JSON.stringify({
        fastMA_period: { from: 20, to: ema.fast },
        slowMA_period: { from: 50, to: ema.slow },
        atr_multiplier: { from: 2.0, to: atr.multiplier }
      })},
      ${improvement.toFixed(2)},
      ${total},
      '1.0.0',
      'pending'
    )
  `);

  console.log(`✅ Created recommendation for ${symbol}: +${improvement.toFixed(1)}% improvement`);
}
```

---

## 🎯 MILESTONE 3C: RECOMMENDATION APPROVAL SYSTEM (85% CONFIDENT)

### **Goal:** Allow user to approve/reject AI recommendations and apply parameter changes

### **What It Does:**

**1. Display Recommendations in Dashboard**

Already built in Milestone 3A! Just need to wire up approve/reject handlers.

**2. Approve Recommendation**

```typescript
// server/routes/ai-insights.ts (UPDATE EXISTING)
app.post("/api/ai/recommendations/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;

    // Get recommendation details
    const rec = await db.execute(sql`
      SELECT * FROM strategy_adaptations
      WHERE id = ${id}
    `);

    if (!rec || rec.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    const recommendation = rec[0];
    const suggestedChanges = recommendation.suggested_changes;

    // Create new strategy version
    const oldVersion = recommendation.old_strategy_version; // '1.0.0'
    const newVersion = incrementVersion(oldVersion); // '1.1.0'

    // Store new parameters (for now, just in strategy_adaptations)
    // TODO: In future, store in separate strategy_parameters table
    await db.execute(sql`
      UPDATE strategy_adaptations
      SET
        status = 'approved',
        user_decision_at = NOW(),
        new_strategy_version = ${newVersion},
        applied_at = NOW()
      WHERE id = ${id}
    `);

    // Log the approval
    console.log(`✅ Recommendation ${id} approved: ${recommendation.recommendation_title}`);
    console.log(`   Old version: ${oldVersion}, New version: ${newVersion}`);
    console.log(`   Changes: ${JSON.stringify(suggestedChanges)}`);

    res.json({
      success: true,
      message: `Recommendation approved. Strategy version updated to ${newVersion}.`,
      note: 'Parameter changes will take effect in next signal generation cycle.',
      newVersion,
    });
  } catch (error: any) {
    console.error('❌ Error approving recommendation:', error);
    res.status(500).json({ error: error.message });
  }
});

function incrementVersion(version: string): string {
  const parts = version.split('.');
  const minor = parseInt(parts[1]) + 1;
  return `${parts[0]}.${minor}.${parts[2]}`;
}
```

**3. Apply Approved Parameters**

Modify signal generator to check for approved recommendations:
```typescript
// server/services/signal-generator.ts (ADD THIS)

class MACrossoverStrategy {
  name = 'MA Crossover Multi-Timeframe';
  version = '1.0.0';

  async analyze(
    primaryCandles: Candle[],
    higherCandles: Candle[],
    symbol: string
  ): Promise<Signal | null> {
    // ... existing code ...

    // 🧠 CHECK FOR APPROVED PARAMETER OVERRIDES
    const params = await this.getApprovedParameters(symbol);

    // Use approved parameters if they exist, otherwise use defaults
    const fastPeriod = params?.fastMA || 20;
    const slowPeriod = params?.slowMA || 50;
    const stopMultiplier = params?.atrMultiplier || 2.0;

    // Calculate indicators with approved parameters
    const fastMA = Indicators.ema(closes, fastPeriod);
    const slowMA = Indicators.ema(closes, slowPeriod);
    // ... rest of strategy
  }

  private async getApprovedParameters(symbol: string): Promise<any> {
    const result = await db.execute(sql`
      SELECT suggested_changes, new_strategy_version
      FROM strategy_adaptations
      WHERE symbol = ${symbol}
        AND status = 'approved'
      ORDER BY applied_at DESC
      LIMIT 1
    `);

    if (!result || result.length === 0) return null;

    const changes = result[0].suggested_changes;

    return {
      fastMA: changes.fastMA_period?.to,
      slowMA: changes.slowMA_period?.to,
      atrMultiplier: changes.atr_multiplier?.to,
      version: result[0].new_strategy_version,
    };
  }
}
```

**4. Version Tracking**

Update strategy version in signal tracking:
```typescript
// When tracking signal, use approved version if exists
const strategyVersion = params?.version || '1.0.0';

await db.execute(sql`
  INSERT INTO signal_history (
    ...
    strategy_version,
    ...
  ) VALUES (
    ...
    ${strategyVersion},
    ...
  )
`);
```

---

## 🔄 ROLLBACK MECHANISM (SAFETY)

If approved parameters perform poorly:

```typescript
// POST /api/ai/recommendations/:id/rollback
app.post("/api/ai/recommendations/:id/rollback", async (req, res) => {
  const { id } = req.params;

  await db.execute(sql`
    UPDATE strategy_adaptations
    SET
      status = 'rolled_back',
      applied_at = NULL
    WHERE id = ${id}
  `);

  console.log(`🔄 Rolled back recommendation ${id} - reverting to defaults`);

  res.json({
    success: true,
    message: 'Parameters rolled back to defaults',
  });
});
```

---

## 📋 IMPLEMENTATION CHECKLIST (WHEN DATA IS READY)

### **Week 1-2: Data Collection**
- [ ] Monitor signal count: `curl https://forex-market-anz.onrender.com/api/ai/insights`
- [ ] Wait for 30+ completed signals per symbol
- [ ] Verify AI insights are meaningful (win rates stabilize)
- [ ] Check dashboard shows AI-Enhanced signals

### **Week 3: Milestone 3B Implementation**
- [ ] Create `server/services/backtester.ts`
- [ ] Implement `backtestParameters(symbol)` function
- [ ] Implement `simulateStrategy()` function
- [ ] Test on USD/JPY (should have 30+ signals by then)
- [ ] Generate first recommendation
- [ ] Verify recommendation appears in `strategy_adaptations` table

### **Week 4: Milestone 3C Implementation**
- [ ] Update `/api/ai/recommendations/:id/approve` endpoint
- [ ] Implement `getApprovedParameters()` in strategy
- [ ] Modify signal generator to use approved parameters
- [ ] Test parameter application on one symbol
- [ ] Implement rollback mechanism
- [ ] Monitor performance of approved parameters

### **Week 5: Full Rollout**
- [ ] Apply recommendations to all symbols
- [ ] Track performance per strategy version
- [ ] Build analytics dashboard for A/B testing
- [ ] Document which parameters work best for which symbols

---

## 🎯 SUCCESS METRICS

**After Milestone 3B:**
- ✅ Backtesting engine generates recommendations
- ✅ Recommendations based on 30+ signals
- ✅ Expected win rate improvement calculated
- ✅ At least 1 recommendation pending approval

**After Milestone 3C:**
- ✅ User can approve/reject recommendations
- ✅ Approved parameters applied to signal generation
- ✅ Strategy versions tracked (1.0.0, 1.1.0, etc.)
- ✅ Rollback mechanism works
- ✅ Win rate improves by 5-10% on optimized symbols

---

## 📝 NOTES FOR FUTURE SESSION

**How to Know When Ready:**
1. Run: `curl https://forex-market-anz.onrender.com/api/ai/insights`
2. Check `symbolInsights` array for any symbol with `totalSignals >= 30`
3. When at least one symbol has 30+, start Milestone 3B

**Example Response When Ready:**
```json
{
  "symbolInsights": [
    {
      "symbol": "USD/JPY",
      "totalSignals": 47,  // ✅ READY!
      "winRate": 68.1,
      "hasEnoughData": true  // ✅ AI ACTIVE
    },
    {
      "symbol": "EUR/USD",
      "totalSignals": 32,  // ✅ READY!
      "winRate": 71.9,
      "hasEnoughData": true  // ✅ AI ACTIVE
    }
  ]
}
```

**When you see this, come back to this document and implement Milestone 3B!**

---

## 🚀 CURRENT STATUS

**Milestones Complete:**
- ✅ Milestone 1: AI Analyzer Service
- ✅ Milestone 2: Dynamic Confidence Scoring
- ✅ Milestone 3A: AI Insights Dashboard (building now)

**Milestones Deferred:**
- ⏳ Milestone 3B: Backtesting Engine (waiting for 30+ signals)
- ⏳ Milestone 3C: Recommendation Approval (waiting for 3B)

**Estimated Timeline:**
- Now: Oct 19, 2025
- Target: Nov 2-9, 2025 (2-3 weeks)
- Signals per day: ~6-8 (15-min intervals = 96 per day / 5 symbols)
- Days to 30 signals: ~10-14 days per symbol

**Stay tuned! The AI is learning... 🧠**

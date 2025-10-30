#!/bin/bash

echo "=== BACKTESTING TROUBLESHOOTING SCRIPT ==="
echo ""
echo "Checking backtesting implementation..."
echo ""

# Check if backtester service exists
if [ -f "server/services/backtester.ts" ]; then
    echo "✅ Backtester service exists"
    
    # Count lines to verify it's not empty
    lines=$(wc -l < "server/services/backtester.ts")
    echo "   File size: $lines lines"
    
    # Check for key functions
    echo ""
    echo "Key function checks:"
    grep -q "backtestAllSymbols" server/services/backtester.ts && echo "   ✅ backtestAllSymbols() found" || echo "   ❌ backtestAllSymbols() NOT FOUND"
    grep -q "backtestSymbol" server/services/backtester.ts && echo "   ✅ backtestSymbol() found" || echo "   ❌ backtestSymbol() NOT FOUND"
    grep -q "simulateStrategy" server/services/backtester.ts && echo "   ✅ simulateStrategy() found" || echo "   ❌ simulateStrategy() NOT FOUND"
    grep -q "createRecommendation" server/services/backtester.ts && echo "   ✅ createRecommendation() found" || echo "   ❌ createRecommendation() NOT FOUND"
    grep -q "getSymbolsWithData" server/services/backtester.ts && echo "   ✅ getSymbolsWithData() found" || echo "   ❌ getSymbolsWithData() NOT FOUND"
else
    echo "❌ Backtester service NOT FOUND"
fi

echo ""
echo "Checking API routes..."

# Check if backtesting routes are registered
if grep -q "backtester" server/routes/ai-insights.ts; then
    echo "✅ Backtester imported in ai-insights.ts"
else
    echo "❌ Backtester NOT imported in ai-insights.ts"
fi

if grep -q "/api/ai/backtest" server/routes/ai-insights.ts; then
    echo "✅ Backtesting endpoint registered"
else
    echo "❌ Backtesting endpoint NOT registered"
fi

echo ""
echo "Checking for potential issues..."

# Check if strategy_adaptations table is referenced
if grep -q "strategy_adaptations" server/services/backtester.ts; then
    echo "✅ Database table 'strategy_adaptations' referenced"
else
    echo "❌ Database table NOT referenced"
fi

# Check if improvement threshold exists
if grep -q "improvement > 5" server/services/backtester.ts; then
    echo "✅ 5% improvement threshold found"
    grep "improvement.*5" server/services/backtester.ts | head -3
else
    echo "❌ Improvement threshold NOT found"
fi

echo ""
echo "=== END OF CHECK ==="

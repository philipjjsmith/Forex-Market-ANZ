import MarketHeader from "@/components/MarketHeader";
import PortfolioSummary from "@/components/PortfolioSummary";
import MarketChart from "@/components/MarketChart";
import WatchlistPanel from "@/components/WatchlistPanel";
import TechnicalIndicators from "@/components/TechnicalIndicators";
import SignalCard from "@/components/SignalCard";
import PortfolioHoldings from "@/components/PortfolioHoldings";
import PriceCard from "@/components/PriceCard";
import SavedSignalsPanel from "@/components/SavedSignalsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";

export default function Dashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");

  // Mock data for chart
  const generateChartData = () => {
    const data = [];
    let price = 480;
    const now = Date.now();
    
    for (let i = 30; i >= 0; i--) {
      const change = (Math.random() - 0.5) * 10;
      price += change;
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      
      data.push({
        time: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        price: parseFloat(price.toFixed(2)),
        ma20: parseFloat((price + (Math.random() - 0.5) * 5).toFixed(2)),
        ma50: parseFloat((price + (Math.random() - 0.5) * 8).toFixed(2)),
        volume: Math.floor(Math.random() * 1000000)
      });
    }
    
    return data;
  };

  // Mock data - Forex pairs
  const watchlistItems = [
    { symbol: "EUR/USD", name: "Euro / US Dollar", price: 1.08945, change: 0.00245, changePercent: 0.23 },
    { symbol: "GBP/USD", name: "British Pound / US Dollar", price: 1.27532, change: -0.00123, changePercent: -0.10 },
    { symbol: "USD/JPY", name: "US Dollar / Japanese Yen", price: 149.875, change: 0.425, changePercent: 0.28 },
    { symbol: "AUD/USD", name: "Australian Dollar / US Dollar", price: 0.66234, change: -0.00156, changePercent: -0.24 },
  ];

  const indicators = [
    { name: "RSI (14)", value: "68.5", signal: "bullish" as const, description: "Momentum indicator showing strength" },
    { name: "MACD", value: "2.34", signal: "bullish" as const, description: "Trend-following momentum" },
    { name: "ADX (14)", value: "42.1", signal: "neutral" as const, description: "Trend strength indicator" },
    { name: "Stochastic", value: "72.8", signal: "bearish" as const, description: "Overbought/oversold" },
  ];

  const signals = [
    {
      id: "SIG_001",
      type: "LONG" as const,
      symbol: "EUR/USD",
      entry: 1.08945,
      stop: 1.08645,
      stopLimitPrice: 1.08695,
      targets: [1.09395, 1.09945, 1.10645],
      confidence: 85,
      rationale: "Bullish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bullish.",
      timestamp: new Date().toISOString(),
      orderType: "BUY_STOP_LIMIT"
    },
    {
      id: "SIG_002",
      type: "SHORT" as const,
      symbol: "GBP/USD",
      entry: 1.27532,
      stop: 1.27832,
      targets: [1.27082, 1.26632, 1.26132],
      confidence: 72,
      rationale: "Bearish MA crossover detected. RSI showing weakness. Price in upper BB region. Higher timeframe shows bearish momentum.",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      orderType: "SELL_LIMIT"
    },
    {
      id: "SIG_003",
      type: "LONG" as const,
      symbol: "USD/JPY",
      entry: 149.875,
      stop: 149.375,
      targets: [150.625, 151.375, 152.375],
      confidence: 78,
      rationale: "Strong bullish momentum. Support level holding. ADX showing trend strength above 25.",
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      orderType: "MARKET"
    },
  ];

  const holdings = [
    {
      symbol: "EUR/USD",
      name: "Euro / US Dollar",
      shares: 100000,
      avgCost: 1.08500,
      currentPrice: 1.08945,
      totalValue: 108945.00,
      gainLoss: 445.00,
      gainLossPercent: 0.41
    },
    {
      symbol: "GBP/USD",
      name: "British Pound / US Dollar",
      shares: 75000,
      avgCost: 1.27800,
      currentPrice: 1.27532,
      totalValue: 95649.00,
      gainLoss: -201.00,
      gainLossPercent: -0.21
    },
    {
      symbol: "USD/JPY",
      name: "US Dollar / Japanese Yen",
      shares: 50000,
      avgCost: 149.250,
      currentPrice: 149.875,
      totalValue: 7493750.00,
      gainLoss: 31250.00,
      gainLossPercent: 0.42
    },
  ];

  const topMovers = [
    { symbol: "NZD/USD", name: "New Zealand Dollar / USD", price: 0.61245, change: 0.00456, changePercent: 0.75 },
    { symbol: "EUR/JPY", name: "Euro / Japanese Yen", price: 163.245, change: -0.545, changePercent: -0.33 },
    { symbol: "AUD/JPY", name: "Australian Dollar / Yen", price: 99.325, change: 0.625, changePercent: 0.63 },
  ];

  return (
    <div className="min-h-screen bg-background">
      <MarketHeader />
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="portfolio" data-testid="tab-portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">Signals</TabsTrigger>
            <TabsTrigger value="saved" data-testid="tab-saved">Saved</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <PortfolioSummary />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <MarketChart symbol="EUR/USD" data={generateChartData()} />
                
                <div>
                  <h2 className="text-lg font-semibold mb-4">Top Movers</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {topMovers.map(mover => (
                      <PriceCard key={mover.symbol} {...mover} />
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="space-y-6">
                <WatchlistPanel items={watchlistItems} />
                <TechnicalIndicators indicators={indicators} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="portfolio" className="space-y-6">
            <PortfolioSummary />
            <PortfolioHoldings holdings={holdings} />
          </TabsContent>

          <TabsContent value="signals" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {signals.map((signal) => (
                <SignalCard key={signal.id} {...signal} />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="saved" className="space-y-6">
            <SavedSignalsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

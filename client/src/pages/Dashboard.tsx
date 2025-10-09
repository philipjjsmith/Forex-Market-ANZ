import MarketHeader from "@/components/MarketHeader";
import PortfolioSummary from "@/components/PortfolioSummary";
import MarketChart from "@/components/MarketChart";
import WatchlistPanel from "@/components/WatchlistPanel";
import TechnicalIndicators from "@/components/TechnicalIndicators";
import SignalCard from "@/components/SignalCard";
import PortfolioHoldings from "@/components/PortfolioHoldings";
import PriceCard from "@/components/PriceCard";
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

  // Mock data
  const watchlistItems = [
    { symbol: "AAPL", name: "Apple Inc.", price: 185.92, change: 3.45, changePercent: 1.89 },
    { symbol: "GOOGL", name: "Alphabet Inc.", price: 142.53, change: -1.23, changePercent: -0.85 },
    { symbol: "MSFT", name: "Microsoft Corp.", price: 378.91, change: 5.67, changePercent: 1.52 },
    { symbol: "TSLA", name: "Tesla Inc.", price: 242.18, change: -5.32, changePercent: -2.15 },
  ];

  const indicators = [
    { name: "RSI (14)", value: "68.5", signal: "bullish" as const, description: "Momentum indicator showing strength" },
    { name: "MACD", value: "2.34", signal: "bullish" as const, description: "Trend-following momentum" },
    { name: "ADX (14)", value: "42.1", signal: "neutral" as const, description: "Trend strength indicator" },
    { name: "Stochastic", value: "72.8", signal: "bearish" as const, description: "Overbought/oversold" },
  ];

  const signals = [
    {
      type: "LONG" as const,
      symbol: "AAPL",
      entry: 185.50,
      stop: 182.30,
      targets: [188.25, 191.50, 195.00],
      confidence: 85,
      rationale: "Bullish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bullish.",
      timestamp: new Date().toISOString()
    },
    {
      type: "SHORT" as const,
      symbol: "TSLA",
      entry: 245.80,
      stop: 249.20,
      targets: [242.50, 239.00, 235.00],
      confidence: 72,
      rationale: "Bearish MA crossover detected. RSI showing weakness. Price in upper BB region.",
      timestamp: new Date(Date.now() - 3600000).toISOString()
    },
  ];

  const holdings = [
    {
      symbol: "AAPL",
      name: "Apple Inc.",
      shares: 150,
      avgCost: 172.50,
      currentPrice: 185.92,
      totalValue: 27888.00,
      gainLoss: 2013.00,
      gainLossPercent: 7.78
    },
    {
      symbol: "GOOGL",
      name: "Alphabet Inc.",
      shares: 200,
      avgCost: 145.80,
      currentPrice: 142.53,
      totalValue: 28506.00,
      gainLoss: -654.00,
      gainLossPercent: -2.24
    },
    {
      symbol: "MSFT",
      name: "Microsoft Corp.",
      shares: 100,
      avgCost: 365.20,
      currentPrice: 378.91,
      totalValue: 37891.00,
      gainLoss: 1371.00,
      gainLossPercent: 3.75
    },
  ];

  const topMovers = [
    { symbol: "NVDA", name: "NVIDIA Corp.", price: 495.22, change: 15.43, changePercent: 3.22 },
    { symbol: "META", name: "Meta Platforms", price: 358.67, change: -8.92, changePercent: -2.43 },
    { symbol: "AMZN", name: "Amazon.com", price: 152.38, change: 4.21, changePercent: 2.84 },
  ];

  return (
    <div className="min-h-screen bg-background">
      <MarketHeader />
      
      <main className="container mx-auto px-4 py-6 max-w-7xl">
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="portfolio" data-testid="tab-portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">Signals</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <PortfolioSummary />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <MarketChart symbol="SPY" data={generateChartData()} />
                
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
              {signals.map((signal, idx) => (
                <SignalCard key={idx} {...signal} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

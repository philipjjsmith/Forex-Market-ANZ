import PortfolioHoldings from '../PortfolioHoldings';

export default function PortfolioHoldingsExample() {
  const mockHoldings = [
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
    {
      symbol: "TSLA",
      name: "Tesla Inc.",
      shares: 80,
      avgCost: 255.40,
      currentPrice: 242.18,
      totalValue: 19374.40,
      gainLoss: -1057.60,
      gainLossPercent: -5.18
    },
  ];

  return <PortfolioHoldings holdings={mockHoldings} />;
}

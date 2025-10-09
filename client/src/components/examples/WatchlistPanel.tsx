import WatchlistPanel from '../WatchlistPanel';

export default function WatchlistPanelExample() {
  const mockItems = [
    { symbol: "AAPL", name: "Apple Inc.", price: 185.92, change: 3.45, changePercent: 1.89 },
    { symbol: "GOOGL", name: "Alphabet Inc.", price: 142.53, change: -1.23, changePercent: -0.85 },
    { symbol: "MSFT", name: "Microsoft Corp.", price: 378.91, change: 5.67, changePercent: 1.52 },
    { symbol: "TSLA", name: "Tesla Inc.", price: 242.18, change: -5.32, changePercent: -2.15 },
  ];

  return <WatchlistPanel items={mockItems} />;
}

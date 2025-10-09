import MarketChart from '../MarketChart';

export default function MarketChartExample() {
  // Generate sample data
  const generateData = () => {
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

  return <MarketChart symbol="SPY" data={generateData()} />;
}

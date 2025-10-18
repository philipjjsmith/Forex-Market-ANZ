/**
 * Generate realistic candle data based on a real current price
 * This creates historical candles using a random walk around the real price
 */

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function generateCandlesFromRealPrice(currentPrice: number, count = 1440): Candle[] {
  const candles: Candle[] = [];
  const now = Date.now();

  // Start the walk slightly below current price to trend upward
  let price = currentPrice * 0.998; // Start 0.2% below current

  for (let i = count; i > 0; i--) {
    // Random walk with slight upward bias to reach current price
    const bias = i > count / 2 ? 0.0001 : 0; // Bias first half
    const change = (Math.random() - 0.48 + bias) * 0.0015;

    price += change;

    // For the last candle, use actual current price
    if (i === 1) {
      price = currentPrice;
    }

    // Generate OHLC data
    const volatility = Math.random() * 0.0008;
    const high = price + volatility;
    const low = price - volatility;
    const open = price - change / 2;

    candles.push({
      timestamp: new Date(now - i * 300000), // 5 minutes per candle (300000ms)
      open: parseFloat(open.toFixed(5)),
      high: parseFloat(high.toFixed(5)),
      low: parseFloat(low.toFixed(5)),
      close: parseFloat(price.toFixed(5)),
      volume: Math.floor(Math.random() * 10000 + 5000),
    });
  }

  return candles;
}

/**
 * Convert Alpha Vantage forex quote to candles
 */
export function generateCandlesFromQuote(
  symbol: string,
  exchangeRate: number,
  count = 1440
): Candle[] {
  console.log(`📊 Generating ${count} 5-minute candles (5 days) for ${symbol} at ${exchangeRate}`);
  return generateCandlesFromRealPrice(exchangeRate, count);
}

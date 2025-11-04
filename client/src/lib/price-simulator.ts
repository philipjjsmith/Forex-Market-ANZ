/**
 * Price Simulator for Auto-Trader
 * Simulates realistic forex price movements for testing and demo purposes
 */

export interface PriceSimulatorConfig {
  volatility: number;      // Price volatility (default: 0.0001)
  trendBias: number;       // Trend bias -1 to 1 (default: 0)
  updateInterval: number;  // Update interval in ms (default: 1000)
}

export interface SimulatedPrice {
  symbol: string;
  currentPrice: number;
  previousPrice: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

export class PriceSimulator {
  private prices: Map<string, SimulatedPrice> = new Map();
  private config: PriceSimulatorConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private callbacks: Set<(prices: Map<string, SimulatedPrice>) => void> = new Set();

  constructor(config?: Partial<PriceSimulatorConfig>) {
    this.config = {
      volatility: 0.0001,
      trendBias: 0,
      updateInterval: 1000,
      ...config,
    };
  }

  // Initialize prices for symbols
  initializePrices(initialPrices: Record<string, number>): void {
    Object.entries(initialPrices).forEach(([symbol, price]) => {
      this.prices.set(symbol, {
        symbol,
        currentPrice: price,
        previousPrice: price,
        change: 0,
        changePercent: 0,
        timestamp: Date.now(),
      });
    });
  }

  // Start price simulation
  start(): void {
    if (this.intervalId) {
      console.warn('Price simulator already running');
      return;
    }

    console.log('📊 Starting price simulator with interval:', this.config.updateInterval, 'ms');

    this.intervalId = setInterval(() => {
      this.updatePrices();
      this.notifySubscribers();
    }, this.config.updateInterval);
  }

  // Stop price simulation
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('📊 Price simulator stopped');
    }
  }

  // Subscribe to price updates
  subscribe(callback: (prices: Map<string, SimulatedPrice>) => void): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  // Notify subscribers of price changes
  private notifySubscribers(): void {
    this.callbacks.forEach(callback => callback(new Map(this.prices)));
  }

  // Update all prices with realistic movement
  private updatePrices(): void {
    this.prices.forEach((priceData, symbol) => {
      const previousPrice = priceData.currentPrice;

      // Generate realistic price movement using random walk with trend bias
      const randomComponent = (Math.random() - 0.5) * 2; // -1 to 1
      const trendComponent = this.config.trendBias;
      const movement = (randomComponent + trendComponent) * this.config.volatility;

      // Calculate new price
      const newPrice = previousPrice + movement;
      const change = newPrice - previousPrice;
      const changePercent = (change / previousPrice) * 100;

      this.prices.set(symbol, {
        symbol,
        currentPrice: parseFloat(newPrice.toFixed(5)),
        previousPrice,
        change: parseFloat(change.toFixed(5)),
        changePercent: parseFloat(changePercent.toFixed(4)),
        timestamp: Date.now(),
      });
    });
  }

  // Get current prices
  getPrices(): Map<string, SimulatedPrice> {
    return new Map(this.prices);
  }

  // Get price for a specific symbol
  getPrice(symbol: string): SimulatedPrice | undefined {
    return this.prices.get(symbol);
  }

  // Update volatility
  setVolatility(volatility: number): void {
    this.config.volatility = volatility;
  }

  // Update trend bias
  setTrendBias(bias: number): void {
    this.config.trendBias = Math.max(-1, Math.min(1, bias));
  }

  // Update interval
  setUpdateInterval(interval: number): void {
    this.config.updateInterval = interval;

    // Restart if running
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }
}

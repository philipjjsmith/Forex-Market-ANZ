import { Signal } from './strategy';

export interface AutoTradePosition {
  id: string;
  signalId: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  unrealizedPL: number;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitTime?: number;
  exitReason?: 'HIT_TP' | 'HIT_SL' | 'MANUAL' | 'TIME_LIMIT';
  profitLoss?: number;
  confidence: number;
  positionSize: number;
}

export interface AutoTraderStats {
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  winningTrades: number;
  losingTrades: number;
  totalProfit: number;
  totalLoss: number;
  netPL: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  isRunning: boolean;
  startTime?: number;
  virtualBalance: number;
}

export interface AutoTraderConfig {
  enabled: boolean;
  minConfidence: number;      // Minimum confidence to take signal (default: 70)
  maxPositions: number;        // Max simultaneous positions (default: 3)
  positionSize: number;        // Virtual capital per trade (default: 1000)
  maxDailyTrades: number;      // Max trades per day (default: 10)
  timeLimit: number;           // Auto-close after X minutes (default: 240 = 4 hours)
  startingBalance: number;     // Starting virtual balance (default: 10000)
}

export type PositionUpdateCallback = (positions: AutoTradePosition[], stats: AutoTraderStats) => void;
export type PositionSaveCallback = (position: AutoTradePosition) => Promise<void>;
export type PositionCloseCallback = (position: AutoTradePosition) => Promise<void>;
export type SessionCallback = (sessionId: string, stats: AutoTraderStats) => Promise<void>;

export class AutoTrader {
  private config: AutoTraderConfig;
  private openPositions: AutoTradePosition[] = [];
  private closedPositions: AutoTradePosition[] = [];
  private dailyTradeCount: number = 0;
  private lastTradeDate: string = '';
  private updateCallbacks: PositionUpdateCallback[] = [];
  private onPositionOpen?: PositionSaveCallback;
  private onPositionClose?: PositionCloseCallback;
  private onSessionUpdate?: SessionCallback;
  private virtualBalance: number;
  private currentSessionId?: string;

  constructor(config?: Partial<AutoTraderConfig>) {
    this.config = {
      enabled: false,
      minConfidence: 70,
      maxPositions: 3,
      positionSize: 1000,
      maxDailyTrades: 10,
      timeLimit: 240, // 4 hours
      startingBalance: 10000,
      ...config,
    };
    this.virtualBalance = this.config.startingBalance;
  }

  // Set database callbacks
  setDatabaseCallbacks(callbacks: {
    onPositionOpen?: PositionSaveCallback;
    onPositionClose?: PositionCloseCallback;
    onSessionUpdate?: SessionCallback;
  }): void {
    this.onPositionOpen = callbacks.onPositionOpen;
    this.onPositionClose = callbacks.onPositionClose;
    this.onSessionUpdate = callbacks.onSessionUpdate;
  }

  // Set current session ID
  setSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  // Subscribe to position updates
  subscribe(callback: PositionUpdateCallback): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifySubscribers(): void {
    const stats = this.getStats();
    this.updateCallbacks.forEach(cb => cb([...this.openPositions], stats));
  }

  // Start the auto-trader
  start(): void {
    this.config.enabled = true;
    console.log('🤖 Auto-Trader started');
    this.notifySubscribers();
  }

  // Stop the auto-trader
  stop(): void {
    this.config.enabled = false;
    console.log('🤖 Auto-Trader stopped');
    this.notifySubscribers();
  }

  // Update configuration
  updateConfig(newConfig: Partial<AutoTraderConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.notifySubscribers();
  }

  // Get current configuration
  getConfig(): AutoTraderConfig {
    return { ...this.config };
  }

  // Reset daily trade count if new day
  private checkAndResetDailyCount(): void {
    const today = new Date().toDateString();
    if (this.lastTradeDate !== today) {
      this.dailyTradeCount = 0;
      this.lastTradeDate = today;
    }
  }

  // Check if we can take a new position
  canTakePosition(symbol: string): boolean {
    if (!this.config.enabled) return false;

    this.checkAndResetDailyCount();

    // Check position limits
    if (this.openPositions.length >= this.config.maxPositions) return false;

    // Check daily trade limit
    if (this.dailyTradeCount >= this.config.maxDailyTrades) return false;

    // Check if we already have a position for this symbol
    if (this.openPositions.some(p => p.symbol === symbol)) return false;

    // Check if we have enough virtual balance
    if (this.virtualBalance < this.config.positionSize) return false;

    return true;
  }

  // Process new signals and potentially open positions
  processSignals(signals: Signal[]): void {
    if (!this.config.enabled) return;

    // Filter eligible signals
    const eligibleSignals = signals.filter(s =>
      s.confidence >= this.config.minConfidence &&
      this.canTakePosition(s.symbol)
    );

    if (eligibleSignals.length === 0) return;

    // Sort by confidence (highest first) and take the best one
    const bestSignal = eligibleSignals.sort((a, b) => b.confidence - a.confidence)[0];

    this.openPosition(bestSignal);
  }

  // Open a new position from a signal
  private async openPosition(signal: Signal): Promise<void> {
    const position: AutoTradePosition = {
      id: `POS_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      signalId: signal.id,
      symbol: signal.symbol,
      type: signal.type,
      entryPrice: signal.entry,
      entryTime: Date.now(),
      stopLoss: signal.stop,
      takeProfit: signal.targets[0], // Use first target as TP
      currentPrice: signal.entry,
      unrealizedPL: 0,
      status: 'OPEN',
      confidence: signal.confidence,
      positionSize: this.config.positionSize,
    };

    this.openPositions.push(position);
    this.dailyTradeCount++;

    console.log(`📈 Opened ${position.type} position on ${position.symbol} at ${position.entryPrice}`, position);

    // Save to database if callback is set
    if (this.onPositionOpen) {
      try {
        await this.onPositionOpen(position);
        console.log('💾 Position saved to database');
      } catch (error) {
        console.error('❌ Failed to save position to database:', error);
      }
    }

    this.notifySubscribers();
  }

  // Update positions with current market prices
  updatePrices(marketData: Record<string, { currentPrice: number }>): void {
    if (this.openPositions.length === 0) return;

    let positionsChanged = false;

    for (const position of this.openPositions) {
      const data = marketData[position.symbol];
      if (!data) continue;

      const currentPrice = data.currentPrice;
      position.currentPrice = currentPrice;

      // Calculate unrealized P/L
      position.unrealizedPL = this.calculatePL(position, currentPrice);

      // Check exit conditions
      if (this.shouldClosePosition(position, currentPrice)) {
        this.closePosition(position, this.getExitReason(position, currentPrice), currentPrice);
        positionsChanged = true;
      }
    }

    if (positionsChanged) {
      this.notifySubscribers();
    } else {
      // Still notify for P/L updates
      this.notifySubscribers();
    }
  }

  // Calculate P/L for a position
  private calculatePL(position: AutoTradePosition, currentPrice: number): number {
    const priceDiff = position.type === 'LONG'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

    // Calculate P/L in dollars (simplified: assuming 1 pip = $10 for standard lot)
    // For forex pairs, we need to calculate based on position size
    const pipValue = 10; // Simplified assumption
    const pips = priceDiff / 0.0001; // Convert price diff to pips
    return pips * pipValue;
  }

  // Check if position should be closed
  private shouldClosePosition(position: AutoTradePosition, currentPrice: number): boolean {
    // Check if TP hit
    if (position.type === 'LONG' && currentPrice >= position.takeProfit) return true;
    if (position.type === 'SHORT' && currentPrice <= position.takeProfit) return true;

    // Check if SL hit
    if (position.type === 'LONG' && currentPrice <= position.stopLoss) return true;
    if (position.type === 'SHORT' && currentPrice >= position.stopLoss) return true;

    // Check time limit
    const timeInPosition = Date.now() - position.entryTime;
    if (timeInPosition > this.config.timeLimit * 60000) return true;

    return false;
  }

  // Get exit reason for a position
  private getExitReason(position: AutoTradePosition, currentPrice: number): AutoTradePosition['exitReason'] {
    if (position.type === 'LONG' && currentPrice >= position.takeProfit) return 'HIT_TP';
    if (position.type === 'SHORT' && currentPrice <= position.takeProfit) return 'HIT_TP';
    if (position.type === 'LONG' && currentPrice <= position.stopLoss) return 'HIT_SL';
    if (position.type === 'SHORT' && currentPrice >= position.stopLoss) return 'HIT_SL';

    const timeInPosition = Date.now() - position.entryTime;
    if (timeInPosition > this.config.timeLimit * 60000) return 'TIME_LIMIT';

    return 'MANUAL';
  }

  // Close a position
  async closePosition(position: AutoTradePosition, reason: AutoTradePosition['exitReason'], exitPrice: number): Promise<void> {
    position.status = 'CLOSED';
    position.exitPrice = exitPrice;
    position.exitTime = Date.now();
    position.exitReason = reason;
    position.profitLoss = this.calculatePL(position, exitPrice);

    // Update virtual balance
    this.virtualBalance += position.profitLoss;

    // Move to closed positions
    this.openPositions = this.openPositions.filter(p => p.id !== position.id);
    this.closedPositions.push(position);

    console.log(`📊 Closed ${position.type} position on ${position.symbol} - ${reason} - P/L: $${position.profitLoss.toFixed(2)}`, position);

    // Save to database if callback is set
    if (this.onPositionClose) {
      try {
        await this.onPositionClose(position);
        console.log('💾 Position closed in database');
      } catch (error) {
        console.error('❌ Failed to update closed position in database:', error);
      }
    }

    // Update session stats if we have a session ID
    if (this.currentSessionId && this.onSessionUpdate) {
      try {
        await this.onSessionUpdate(this.currentSessionId, this.getStats());
        console.log('💾 Session stats updated');
      } catch (error) {
        console.error('❌ Failed to update session stats:', error);
      }
    }

    this.notifySubscribers();
  }

  // Manually close a position
  manualClosePosition(positionId: string, currentPrice: number): void {
    const position = this.openPositions.find(p => p.id === positionId);
    if (!position) return;

    this.closePosition(position, 'MANUAL', currentPrice);
  }

  // Get all positions
  getPositions(): { open: AutoTradePosition[], closed: AutoTradePosition[] } {
    return {
      open: [...this.openPositions],
      closed: [...this.closedPositions],
    };
  }

  // Get statistics
  getStats(): AutoTraderStats {
    const winningTrades = this.closedPositions.filter(p => (p.profitLoss || 0) > 0);
    const losingTrades = this.closedPositions.filter(p => (p.profitLoss || 0) < 0);

    const totalProfit = winningTrades.reduce((sum, p) => sum + (p.profitLoss || 0), 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, p) => sum + (p.profitLoss || 0), 0));
    const netPL = totalProfit - totalLoss;

    return {
      totalTrades: this.closedPositions.length + this.openPositions.length,
      openPositions: this.openPositions.length,
      closedPositions: this.closedPositions.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      totalProfit,
      totalLoss,
      netPL,
      winRate: this.closedPositions.length > 0
        ? (winningTrades.length / this.closedPositions.length) * 100
        : 0,
      avgProfit: winningTrades.length > 0
        ? totalProfit / winningTrades.length
        : 0,
      avgLoss: losingTrades.length > 0
        ? totalLoss / losingTrades.length
        : 0,
      isRunning: this.config.enabled,
      startTime: this.config.enabled ? Date.now() : undefined,
      virtualBalance: this.virtualBalance,
    };
  }

  // Reset all data
  reset(): void {
    this.openPositions = [];
    this.closedPositions = [];
    this.dailyTradeCount = 0;
    this.virtualBalance = this.config.startingBalance;
    this.lastTradeDate = '';
    this.config.enabled = false;
    console.log('🔄 Auto-Trader reset');
    this.notifySubscribers();
  }
}

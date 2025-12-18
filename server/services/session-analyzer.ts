/**
 * Session Analyzer Service
 * Analyzes trading performance by session (Asia, London, NY, Overlap)
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

type Session = 'ASIA' | 'LONDON' | 'NY' | 'LONDON_NY_OVERLAP' | 'OFF_HOURS';

interface Trade {
  created_at: string;
  profit_loss_pips: number;
  symbol: string;
}

interface SessionStats {
  session: Session;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgProfit: number;
  totalPips: number;
  bestTrade: number;
  worstTrade: number;
  interpretation: string;
}

interface SessionPerformance {
  sessions: SessionStats[];
  bestSession: Session;
  worstSession: Session;
  recommendation: string;
}

export class SessionAnalyzer {
  /**
   * Detect which trading session a trade occurred in based on UTC time
   */
  detectSession(tradeTime: Date): Session {
    const hour = tradeTime.getUTCHours();

    // Trading sessions (UTC times)
    const ASIA_START = 23; // 11 PM UTC (7 AM Tokyo JST+9)
    const ASIA_END = 8;    // 8 AM UTC (4 PM Tokyo)
    const LONDON_START = 7;   // 7 AM UTC (8 AM London GMT+1)
    const LONDON_END = 16;    // 4 PM UTC (5 PM London)
    const NY_START = 12;      // 12 PM UTC (8 AM NY EST-5)
    const NY_END = 21;        // 9 PM UTC (5 PM NY)

    // London/NY Overlap: 12 PM - 4 PM UTC (most liquid period)
    if (hour >= 12 && hour < 16) return 'LONDON_NY_OVERLAP';

    // London Session: 7 AM - 4 PM UTC
    if (hour >= LONDON_START && hour < LONDON_END) return 'LONDON';

    // NY Session: 12 PM - 9 PM UTC
    if (hour >= NY_START && hour < NY_END) return 'NY';

    // Asia Session: 11 PM - 8 AM UTC (wraps midnight)
    if (hour >= ASIA_START || hour < ASIA_END) return 'ASIA';

    return 'OFF_HOURS';
  }

  /**
   * Analyze performance by trading session
   */
  analyzeBySession(trades: Trade[]): SessionPerformance {
    // Group trades by session
    const sessionGroups = new Map<Session, Trade[]>();

    for (const trade of trades) {
      const session = this.detectSession(new Date(trade.created_at));
      if (!sessionGroups.has(session)) {
        sessionGroups.set(session, []);
      }
      sessionGroups.get(session)!.push(trade);
    }

    // Calculate stats for each session
    const sessions: SessionStats[] = [];
    const allSessions: Session[] = ['ASIA', 'LONDON', 'NY', 'LONDON_NY_OVERLAP', 'OFF_HOURS'];

    for (const session of allSessions) {
      const sessionTrades = sessionGroups.get(session) || [];
      if (sessionTrades.length > 0) {
        sessions.push(this.calculateSessionStats(session, sessionTrades));
      }
    }

    // Find best and worst sessions
    const tradedSessions = sessions.filter(s => s.totalTrades > 0);

    const bestSession = tradedSessions.length > 0
      ? tradedSessions.reduce((best, current) =>
          current.winRate > best.winRate ? current : best
        ).session
      : 'LONDON_NY_OVERLAP';

    const worstSession = tradedSessions.length > 0
      ? tradedSessions.reduce((worst, current) =>
          current.winRate < worst.winRate ? current : worst
        ).session
      : 'OFF_HOURS';

    return {
      sessions,
      bestSession,
      worstSession,
      recommendation: this.generateRecommendation(sessions, bestSession, worstSession)
    };
  }

  /**
   * Calculate statistics for a specific session
   */
  private calculateSessionStats(session: Session, trades: Trade[]): SessionStats {
    const winningTrades = trades.filter(t => t.profit_loss_pips > 0);
    const losingTrades = trades.filter(t => t.profit_loss_pips < 0);

    const totalPips = trades.reduce((sum, t) => sum + t.profit_loss_pips, 0);
    const avgProfit = totalPips / trades.length;
    const winRate = (winningTrades.length / trades.length) * 100;

    const allPips = trades.map(t => t.profit_loss_pips);
    const bestTrade = allPips.length > 0 ? Math.max(...allPips) : 0;
    const worstTrade = allPips.length > 0 ? Math.min(...allPips) : 0;

    return {
      session,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgProfit,
      totalPips,
      bestTrade,
      worstTrade,
      interpretation: this.interpretSession(session, winRate)
    };
  }

  /**
   * Interpret session performance
   */
  private interpretSession(session: Session, winRate: number): string {
    const sessionNames = {
      ASIA: 'Asian Session (quieter, ranging)',
      LONDON: 'London Session (high volatility)',
      NY: 'New York Session (USD pairs active)',
      LONDON_NY_OVERLAP: 'London/NY Overlap (most liquid)',
      OFF_HOURS: 'Off-Hours (low liquidity)'
    };

    const name = sessionNames[session];

    if (winRate >= 70) return `Strong performance during ${name}`;
    if (winRate >= 60) return `Good results in ${name}`;
    if (winRate >= 50) return `Moderate success in ${name}`;
    if (winRate >= 40) return `Below average in ${name} - needs improvement`;
    return `Poor performance in ${name} - avoid or adjust strategy`;
  }

  /**
   * Generate trading recommendation based on session analysis
   */
  private generateRecommendation(
    sessions: SessionStats[],
    bestSession: Session,
    worstSession: Session
  ): string {
    const best = sessions.find(s => s.session === bestSession);
    const worst = sessions.find(s => s.session === worstSession);

    if (!best || !worst) {
      return 'Insufficient data to generate session-based recommendations';
    }

    const winRateDiff = best.winRate - worst.winRate;

    if (winRateDiff > 30) {
      return `Strong preference for ${this.sessionName(bestSession)} trading.
              Consider avoiding ${this.sessionName(worstSession)} or adjusting strategy.
              ${best.winRate.toFixed(1)}% win rate vs ${worst.winRate.toFixed(1)}% win rate.`;
    }

    if (winRateDiff > 15) {
      return `Better results during ${this.sessionName(bestSession)} (${best.winRate.toFixed(1)}% win rate).
              Monitor ${this.sessionName(worstSession)} trades more carefully.`;
    }

    return `Consistent performance across sessions. Current best: ${this.sessionName(bestSession)}`;
  }

  /**
   * Get friendly session name
   */
  private sessionName(session: Session): string {
    const names = {
      ASIA: 'Asian Session',
      LONDON: 'London Session',
      NY: 'New York Session',
      LONDON_NY_OVERLAP: 'London/NY Overlap',
      OFF_HOURS: 'Off-Hours'
    };
    return names[session];
  }

  /**
   * Get session characteristics (for educational content)
   */
  getSessionCharacteristics(session: Session): {
    name: string;
    utcHours: string;
    characteristics: string[];
    bestPairs: string[];
    volatility: string;
  } {
    const characteristics = {
      ASIA: {
        name: 'Asian Session',
        utcHours: '23:00 - 08:00 UTC',
        characteristics: [
          'Lower volatility and tighter ranges',
          'JPY pairs most active',
          'Good for range trading strategies',
          'Fewer breakouts, more consolidation'
        ],
        bestPairs: ['USDJPY', 'EURJPY', 'AUDJPY', 'NZDJPY'],
        volatility: 'Low to Medium'
      },
      LONDON: {
        name: 'London Session',
        utcHours: '07:00 - 16:00 UTC',
        characteristics: [
          'High volatility with strong trends',
          'EUR and GBP pairs most active',
          'Major economic news releases',
          'Best for breakout strategies'
        ],
        bestPairs: ['EURUSD', 'GBPUSD', 'EURGBP', 'EURJPY'],
        volatility: 'High'
      },
      NY: {
        name: 'New York Session',
        utcHours: '12:00 - 21:00 UTC',
        characteristics: [
          'USD pairs dominate',
          'High liquidity and volume',
          'US economic data releases',
          'Afternoon reversals common'
        ],
        bestPairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD'],
        volatility: 'High'
      },
      LONDON_NY_OVERLAP: {
        name: 'London/NY Overlap',
        utcHours: '12:00 - 16:00 UTC',
        characteristics: [
          'Highest liquidity period globally',
          'Tightest spreads',
          'Major moves and breakouts',
          'Ideal for day trading'
        ],
        bestPairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'EURGBP'],
        volatility: 'Very High'
      },
      OFF_HOURS: {
        name: 'Off-Hours',
        utcHours: 'Between major sessions',
        characteristics: [
          'Very low liquidity',
          'Wider spreads',
          'Risk of false breakouts',
          'Generally avoid trading'
        ],
        bestPairs: [],
        volatility: 'Very Low'
      }
    };

    return characteristics[session];
  }
}

// Export singleton instance
export const sessionAnalyzer = new SessionAnalyzer();

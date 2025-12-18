/**
 * Execution Quality Service
 * Grades trade execution quality based on slippage, latency, and MAE
 * Phase: Backend Foundation - Winning Trades Enhancement
 */

interface ExecutionMetrics {
  entry_slippage?: number; // In pips
  exit_slippage?: number; // In pips
  fill_latency?: number; // In milliseconds
  max_adverse_excursion?: number; // In pips
  stop_loss_distance?: number; // Distance to stop in pips
}

interface ExecutionGrade {
  grade: string; // A+, A, A-, B+, B, B-, C+, C, D, F
  score: number; // 0-100
  breakdown: {
    slippageScore: number;
    latencyScore: number;
    maeScore: number;
  };
  interpretation: string;
  recommendations: string[];
}

export class ExecutionQualityService {
  /**
   * Calculate overall execution quality grade
   */
  calculateGrade(metrics: ExecutionMetrics): ExecutionGrade {
    let score = 100;
    const breakdown = {
      slippageScore: 100,
      latencyScore: 100,
      maeScore: 100
    };
    const recommendations: string[] = [];

    // 1. Slippage Analysis (max 20 point penalty)
    const totalSlippage = Math.abs(metrics.entry_slippage || 0) + Math.abs(metrics.exit_slippage || 0);

    if (totalSlippage > 2.0) {
      score -= 20;
      breakdown.slippageScore = 60;
      recommendations.push('High slippage detected - consider limit orders or trading during liquid hours');
    } else if (totalSlippage > 1.0) {
      score -= 10;
      breakdown.slippageScore = 80;
      recommendations.push('Moderate slippage - acceptable but room for improvement');
    } else if (totalSlippage > 0.5) {
      score -= 5;
      breakdown.slippageScore = 90;
    }

    // 2. Fill Latency Analysis (max 20 point penalty)
    const latency = metrics.fill_latency || 0;

    if (latency > 500) {
      score -= 20;
      breakdown.latencyScore = 60;
      recommendations.push('Slow order execution - check broker connection or VPS setup');
    } else if (latency > 200) {
      score -= 10;
      breakdown.latencyScore = 80;
      recommendations.push('Fill latency could be improved - consider faster broker or VPS');
    } else if (latency > 100) {
      score -= 5;
      breakdown.latencyScore = 90;
    }

    // 3. MAE Analysis (max 30 point penalty - most important)
    if (metrics.max_adverse_excursion !== undefined && metrics.stop_loss_distance) {
      const maeRatio = metrics.max_adverse_excursion / metrics.stop_loss_distance;

      if (maeRatio > 0.9) {
        score -= 30;
        breakdown.maeScore = 50;
        recommendations.push('Trade came very close to stop loss - consider wider stops or better entries');
      } else if (maeRatio > 0.8) {
        score -= 20;
        breakdown.maeScore = 70;
        recommendations.push('Significant drawdown experienced - entry timing could be improved');
      } else if (maeRatio > 0.5) {
        score -= 10;
        breakdown.maeScore = 85;
      } else if (maeRatio < 0.2) {
        score += 5; // Bonus for excellent entry
        breakdown.maeScore = 100;
      }
    }

    // Cap score at 100
    score = Math.min(100, Math.max(0, score));

    return {
      grade: this.scoreToGrade(score),
      score,
      breakdown,
      interpretation: this.interpretGrade(score),
      recommendations: recommendations.length > 0 ? recommendations : ['Excellent execution quality - maintain current approach']
    };
  }

  /**
   * Convert numeric score to letter grade
   */
  private scoreToGrade(score: number): string {
    if (score >= 98) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 65) return 'D+';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Interpret what the grade means
   */
  private interpretGrade(score: number): string {
    if (score >= 95) return 'Outstanding execution - institutional-grade quality';
    if (score >= 90) return 'Excellent execution - professional standard';
    if (score >= 85) return 'Very good execution - minor improvements possible';
    if (score >= 80) return 'Good execution - solid performance';
    if (score >= 75) return 'Above average - some areas need attention';
    if (score >= 70) return 'Average execution - notable room for improvement';
    if (score >= 60) return 'Below average - execution issues impacting performance';
    return 'Poor execution - significant improvements needed';
  }

  /**
   * Analyze slippage specifically
   */
  analyzeSlippage(entrySlippage: number, exitSlippage: number): {
    total: number;
    rating: string;
    impact: string;
  } {
    const total = Math.abs(entrySlippage) + Math.abs(exitSlippage);

    let rating: string;
    let impact: string;

    if (total < 0.5) {
      rating = 'Excellent';
      impact = 'Negligible impact on profitability';
    } else if (total < 1.0) {
      rating = 'Good';
      impact = 'Minor impact - within acceptable range';
    } else if (total < 2.0) {
      rating = 'Fair';
      impact = 'Moderate impact - consider optimization';
    } else {
      rating = 'Poor';
      impact = 'Significant impact - execution improvements critical';
    }

    return { total, rating, impact };
  }

  /**
   * Analyze fill latency
   */
  analyzeLatency(latencyMs: number): {
    rating: string;
    category: string;
    recommendation: string;
  } {
    if (latencyMs < 50) {
      return {
        rating: 'Exceptional',
        category: 'Co-located / Low-latency',
        recommendation: 'Maintain current setup - excellent for scalping'
      };
    }

    if (latencyMs < 100) {
      return {
        rating: 'Excellent',
        category: 'Professional-grade',
        recommendation: 'Good for all trading styles including scalping'
      };
    }

    if (latencyMs < 200) {
      return {
        rating: 'Good',
        category: 'Retail VPS / Fast broker',
        recommendation: 'Suitable for day trading and swing trading'
      };
    }

    if (latencyMs < 500) {
      return {
        rating: 'Fair',
        category: 'Standard retail connection',
        recommendation: 'Consider VPS for intraday trading'
      };
    }

    return {
      rating: 'Poor',
      category: 'Slow connection',
      recommendation: 'Upgrade broker or use VPS - latency affecting execution'
    };
  }

  /**
   * Calculate aggregate execution quality for multiple trades
   */
  calculateAggregateQuality(trades: ExecutionMetrics[]): {
    avgGrade: string;
    avgScore: number;
    totalA: number;
    totalB: number;
    totalC: number;
    totalDF: number;
    consistency: string;
  } {
    if (trades.length === 0) {
      return {
        avgGrade: 'N/A',
        avgScore: 0,
        totalA: 0,
        totalB: 0,
        totalC: 0,
        totalDF: 0,
        consistency: 'Insufficient Data'
      };
    }

    const grades = trades.map(t => this.calculateGrade(t));
    const avgScore = grades.reduce((sum, g) => sum + g.score, 0) / grades.length;

    const gradeCounts = {
      A: grades.filter(g => g.grade.startsWith('A')).length,
      B: grades.filter(g => g.grade.startsWith('B')).length,
      C: grades.filter(g => g.grade.startsWith('C')).length,
      DF: grades.filter(g => g.grade.startsWith('D') || g.grade === 'F').length
    };

    // Calculate consistency
    const stdDev = Math.sqrt(
      grades.reduce((sum, g) => sum + Math.pow(g.score - avgScore, 2), 0) / grades.length
    );

    let consistency: string;
    if (stdDev < 5) consistency = 'Highly Consistent';
    else if (stdDev < 10) consistency = 'Consistent';
    else if (stdDev < 15) consistency = 'Moderately Consistent';
    else consistency = 'Inconsistent';

    return {
      avgGrade: this.scoreToGrade(avgScore),
      avgScore,
      totalA: gradeCounts.A,
      totalB: gradeCounts.B,
      totalC: gradeCounts.C,
      totalDF: gradeCounts.DF,
      consistency
    };
  }
}

// Export singleton instance
export const executionQualityService = new ExecutionQualityService();

/**
 * Verification for the Phase 1 additions to /api/admin/growth-stats.
 * Runs the EXACT SQL the handler now issues, against the live database,
 * and prints the payload the endpoint would return. Read-only.
 */
import 'dotenv/config';
import postgres from 'postgres';
import { propFirmService } from '../server/services/prop-firm-config';
import { MAX_EFFECTIVE_EXPOSURE } from '../server/services/correlation-guard';

const db = postgres(process.env.DATABASE_URL!, { ssl: 'require', connect_timeout: 15 });

(async () => {
  const overallRows = await db`
    SELECT
      COUNT(*) as total_signals,
      COUNT(*) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as wins,
      COUNT(*) FILTER (WHERE outcome = 'STOP_HIT') as losses,
      COALESCE(SUM(profit_loss_pips), 0) as total_profit_pips,
      COALESCE(AVG(profit_loss_pips) FILTER (WHERE outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')), 0) as avg_win_pips,
      COALESCE(AVG(ABS(profit_loss_pips)) FILTER (WHERE outcome = 'STOP_HIT'), 0) as avg_loss_pips,
      ROUND(AVG(EXTRACT(EPOCH FROM (outcome_time - created_at)) / 3600)::numeric, 1) as avg_hold_hours,
      ROUND(MAX(profit_loss_pips)::numeric, 1) as best_trade_pips,
      ROUND(MIN(profit_loss_pips)::numeric, 1) as worst_trade_pips,
      ROUND(STDDEV_SAMP(profit_loss_pips)::numeric, 4) as sd_pips,
      COUNT(*) FILTER (WHERE type = 'LONG') as longs,
      COUNT(*) FILTER (WHERE type = 'SHORT') as shorts,
      COUNT(*) FILTER (WHERE type = 'LONG'  AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as long_wins,
      COUNT(*) FILTER (WHERE type = 'SHORT' AND outcome IN ('TP1_HIT','TP2_HIT','TP3_HIT')) as short_wins
    FROM signal_history_deduped
    WHERE outcome != 'PENDING'`;
  const overall: any = overallRows[0];

  const integRows = await db`
    SELECT
      COUNT(*) as total,
      COUNT(corrected_outcome) as reconciled,
      COUNT(*) FILTER (WHERE corrected_outcome IS NOT NULL
                         AND corrected_outcome <> raw_outcome) as disagreed,
      MAX(last_validated_at) as last_validated_at
    FROM signal_history_deduped`;
  const integ: any = integRows[0];

  const openRows = await db`
    SELECT COUNT(*) as pending, MIN(created_at) as oldest_pending_at
    FROM signal_history_deduped WHERE outcome = 'PENDING'`;
  const open: any = openRows[0];

  const totalTrades = parseInt(overall.wins) + parseInt(overall.losses);
  const avgProfitPerTrade = totalTrades > 0 ? parseFloat(overall.total_profit_pips) / totalTrades : 0;
  const sdPips = parseFloat(overall.sd_pips) || 0;
  const sharpeRatio = sdPips > 0 ? avgProfitPerTrade / sdPips : 0;
  const oldSharpe = avgProfitPerTrade > 0 ? avgProfitPerTrade / 100 : 0;

  const reconciledCount = parseInt(integ.reconciled) || 0;
  const disagreedCount = parseInt(integ.disagreed) || 0;
  const cfg = propFirmService.getConfig();

  console.log('\n================ integrity ================');
  console.table([{
    totalRows: parseInt(integ.total),
    reconciled: reconciledCount,
    disagreed: disagreedCount,
    disagreementPct: reconciledCount > 0
      ? parseFloat((100 * disagreedCount / reconciledCount).toFixed(1)) : 0,
    lastValidatedAt: integ.last_validated_at,
  }]);

  console.log('================ open (unrealised) ================');
  console.table([{ pending: parseInt(open.pending), oldestPendingAt: open.oldest_pending_at }]);

  console.log('================ new overall metrics ================');
  console.table([{
    avgHoldHours: parseFloat(overall.avg_hold_hours),
    bestTradePips: parseFloat(overall.best_trade_pips),
    worstTradePips: parseFloat(overall.worst_trade_pips),
    sdPips: parseFloat(sdPips.toFixed(2)),
    longs: parseInt(overall.longs),
    shorts: parseInt(overall.shorts),
    longWinRate: parseInt(overall.longs) > 0
      ? parseFloat((100 * parseInt(overall.long_wins) / parseInt(overall.longs)).toFixed(1)) : 0,
    shortWinRate: parseInt(overall.shorts) > 0
      ? parseFloat((100 * parseInt(overall.short_wins) / parseInt(overall.shorts)).toFixed(1)) : 0,
  }]);

  console.log('================ sharpe: old vs new ================');
  console.table([
    { version: 'OLD (mean/100, clamped >0)', value: parseFloat(oldSharpe.toFixed(4)) },
    { version: 'NEW (mean / sd)',            value: parseFloat(sharpeRatio.toFixed(4)) },
  ]);

  console.log('================ riskConfig ================');
  console.table([{
    maxTradesPerDay: cfg.maxTradesPerDay,
    riskPerTradePercent: cfg.riskPerTrade,
    positionSizeHigh: propFirmService.getPositionSize('HIGH'),
    positionSizeMedium: propFirmService.getPositionSize('MEDIUM'),
    signalCooldownMinutes: 240,
    // Was hardcoded 'none (null)' — true when this script was written in Phase 1, and FALSE
    // since the correlation guard shipped in 55d8d6d. The handler returns the real cap and
    // Admin.tsx renders it, so the literal made this check contradict the page it verifies.
    maxEffectiveExposure: MAX_EFFECTIVE_EXPOSURE,
  }]);

  await db.end();
})();

import { AutoTradePosition } from '@/lib/auto-trader';
import { TrendingUp, TrendingDown, X, Clock, Target, AlertTriangle } from 'lucide-react';

interface PositionCardProps {
  position: AutoTradePosition;
  onClose?: (positionId: string, currentPrice: number) => void;
}

export function PositionCard({ position, onClose }: PositionCardProps) {
  const isProfit = position.unrealizedPL >= 0;
  const isOpen = position.status === 'OPEN';

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDuration = (entryTime: number, exitTime?: number) => {
    const duration = (exitTime || Date.now()) - entryTime;
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  };

  const getExitReasonText = (reason?: AutoTradePosition['exitReason']) => {
    switch (reason) {
      case 'HIT_TP': return 'Take Profit Hit';
      case 'HIT_SL': return 'Stop Loss Hit';
      case 'TIME_LIMIT': return 'Time Limit Reached';
      case 'MANUAL': return 'Manually Closed';
      default: return 'Unknown';
    }
  };

  const getExitReasonColor = (reason?: AutoTradePosition['exitReason']) => {
    switch (reason) {
      case 'HIT_TP': return 'text-green-400';
      case 'HIT_SL': return 'text-red-400';
      case 'TIME_LIMIT': return 'text-yellow-400';
      case 'MANUAL': return 'text-blue-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className={`bg-slate-800 rounded-lg p-4 border-2 transition-all ${
      isOpen
        ? isProfit
          ? 'border-green-500/30 hover:border-green-500/50'
          : 'border-red-500/30 hover:border-red-500/50'
        : 'border-slate-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {position.type === 'LONG' ? (
            <TrendingUp className="w-5 h-5 text-green-400" />
          ) : (
            <TrendingDown className="w-5 h-5 text-red-400" />
          )}
          <div>
            <div className="font-bold text-lg">{position.symbol}</div>
            <div className="text-xs text-slate-400">
              {position.type} • {position.confidence}% Confidence
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOpen && (
            <button
              onClick={() => onClose?.(position.id, position.currentPrice)}
              className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors"
              title="Close Position"
            >
              <X className="w-4 h-4 text-slate-400 hover:text-red-400" />
            </button>
          )}
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`px-2 py-1 rounded text-xs font-semibold ${
          isOpen
            ? 'bg-blue-500/20 text-blue-400'
            : 'bg-slate-700 text-slate-400'
        }`}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </span>

        {!isOpen && position.exitReason && (
          <span className={`px-2 py-1 rounded text-xs font-semibold bg-slate-700 ${getExitReasonColor(position.exitReason)}`}>
            {getExitReasonText(position.exitReason)}
          </span>
        )}
      </div>

      {/* Price Information */}
      <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div>
          <div className="text-slate-400 text-xs mb-1">Entry Price</div>
          <div className="font-mono font-semibold">{position.entryPrice.toFixed(5)}</div>
        </div>

        <div>
          <div className="text-slate-400 text-xs mb-1">Current Price</div>
          <div className="font-mono font-semibold">{position.currentPrice.toFixed(5)}</div>
        </div>

        <div>
          <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Take Profit
          </div>
          <div className="font-mono text-xs text-green-400">{position.takeProfit.toFixed(5)}</div>
        </div>

        <div>
          <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Stop Loss
          </div>
          <div className="font-mono text-xs text-red-400">{position.stopLoss.toFixed(5)}</div>
        </div>
      </div>

      {/* P/L Display */}
      <div className={`p-3 rounded-lg mb-3 ${
        isProfit ? 'bg-green-500/10' : 'bg-red-500/10'
      }`}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">
            {isOpen ? 'Unrealized P/L' : 'Realized P/L'}
          </span>
          <span className={`text-xl font-bold ${
            isProfit ? 'text-green-400' : 'text-red-400'
          }`}>
            {isProfit ? '+' : ''}{(isOpen ? position.unrealizedPL : position.profitLoss || 0).toFixed(2)} USD
          </span>
        </div>
      </div>

      {/* Time Information */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>
            {isOpen ? 'Opened' : 'Entry'}: {formatTime(position.entryTime)}
          </span>
        </div>
        <div>
          Duration: {formatDuration(position.entryTime, position.exitTime)}
        </div>
      </div>

      {isOpen && (
        <div className="mt-2 text-xs text-slate-500">
          Position Size: ${position.positionSize.toLocaleString()}
        </div>
      )}
    </div>
  );
}

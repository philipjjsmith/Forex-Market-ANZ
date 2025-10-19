import { useState } from 'react';
import { TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, User, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface HistorySignal {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  entry_price: number;
  stop_loss: number;
  tp1: number;
  outcome: string;
  outcome_price: number;
  outcome_time: string;
  profit_loss_pips: number;
  manually_closed_by_user: boolean;
  created_at: string;
}

interface SignalHistoryTableProps {
  signals: HistorySignal[];
}

export function SignalHistoryTable({ signals }: SignalHistoryTableProps) {
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');

  // Get unique symbols
  const symbols = Array.from(new Set(signals.map((s) => s.symbol))).sort();

  // Filter signals
  const filteredSignals = signals.filter((signal) => {
    if (symbolFilter !== 'all' && signal.symbol !== symbolFilter) return false;
    if (outcomeFilter !== 'all' && signal.outcome !== outcomeFilter) return false;
    return true;
  });

  const getOutcomeBadge = (outcome: string, manually: boolean) => {
    if (manually) {
      return (
        <Badge variant="outline" className="border-blue-500/50 text-blue-300 bg-blue-500/10">
          <User className="w-3 h-3 mr-1" />
          Manual Close
        </Badge>
      );
    }

    switch (outcome) {
      case 'TP1_HIT':
      case 'TP2_HIT':
      case 'TP3_HIT':
        return (
          <Badge variant="outline" className="border-green-500/50 text-green-300 bg-green-500/10">
            <CheckCircle className="w-3 h-3 mr-1" />
            TP Hit
          </Badge>
        );
      case 'STOP_HIT':
        return (
          <Badge variant="outline" className="border-red-500/50 text-red-300 bg-red-500/10">
            <XCircle className="w-3 h-3 mr-1" />
            Stop Hit
          </Badge>
        );
      case 'EXPIRED':
        return (
          <Badge variant="outline" className="border-yellow-500/50 text-yellow-300 bg-yellow-500/10">
            <Clock className="w-3 h-3 mr-1" />
            Expired
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="border-gray-500/50 text-gray-300 bg-gray-500/10">
            {outcome}
          </Badge>
        );
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (signals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <p>No completed signals yet</p>
        <p className="text-sm mt-2">Wait for signals to hit TP1, SL, or expire</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4">
        <div className="w-48">
          <Select value={symbolFilter} onValueChange={setSymbolFilter}>
            <SelectTrigger className="bg-slate-800 border-white/20 text-white">
              <SelectValue placeholder="All Symbols" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-white/20">
              <SelectItem value="all" className="text-white">All Symbols</SelectItem>
              {symbols.map((symbol) => (
                <SelectItem key={symbol} value={symbol} className="text-white">
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48">
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="bg-slate-800 border-white/20 text-white">
              <SelectValue placeholder="All Outcomes" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-white/20">
              <SelectItem value="all" className="text-white">All Outcomes</SelectItem>
              <SelectItem value="TP1_HIT" className="text-white">TP1 Hit (Win)</SelectItem>
              <SelectItem value="STOP_HIT" className="text-white">Stop Hit (Loss)</SelectItem>
              <SelectItem value="EXPIRED" className="text-white">Expired</SelectItem>
              <SelectItem value="MANUALLY_CLOSED" className="text-white">Manual Close</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 text-right text-sm text-blue-200">
          Showing {filteredSignals.length} of {signals.length} signals
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-white/5">
              <TableHead className="text-blue-200">Date</TableHead>
              <TableHead className="text-blue-200">Symbol</TableHead>
              <TableHead className="text-blue-200">Type</TableHead>
              <TableHead className="text-blue-200">Confidence</TableHead>
              <TableHead className="text-blue-200">Entry</TableHead>
              <TableHead className="text-blue-200">Exit</TableHead>
              <TableHead className="text-blue-200">Outcome</TableHead>
              <TableHead className="text-blue-200 text-right">P/L (pips)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSignals.map((signal) => (
              <TableRow key={signal.signal_id} className="border-white/10 hover:bg-white/5">
                <TableCell className="text-gray-300 text-sm">
                  {formatDate(signal.outcome_time)}
                </TableCell>
                <TableCell className="font-medium text-white">
                  {signal.symbol}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      signal.type === 'LONG'
                        ? 'border-green-500/50 text-green-300 bg-green-500/10'
                        : 'border-red-500/50 text-red-300 bg-red-500/10'
                    }
                  >
                    {signal.type === 'LONG' ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {signal.type}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      signal.confidence >= 90
                        ? 'border-purple-500/50 text-purple-300 bg-purple-500/10'
                        : signal.confidence >= 80
                        ? 'border-blue-500/50 text-blue-300 bg-blue-500/10'
                        : 'border-yellow-500/50 text-yellow-300 bg-yellow-500/10'
                    }
                  >
                    {signal.confidence}%
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-white">
                  {signal.entry_price.toFixed(5)}
                </TableCell>
                <TableCell className="font-mono text-white">
                  {signal.outcome_price?.toFixed(5) || 'N/A'}
                </TableCell>
                <TableCell>
                  {getOutcomeBadge(signal.outcome, signal.manually_closed_by_user)}
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={`font-mono font-semibold ${
                      signal.profit_loss_pips > 0
                        ? 'text-green-400'
                        : signal.profit_loss_pips < 0
                        ? 'text-red-400'
                        : 'text-gray-400'
                    }`}
                  >
                    {signal.profit_loss_pips > 0 ? '+' : ''}
                    {signal.profit_loss_pips?.toFixed(1) || '0.0'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filteredSignals.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <p>No signals match your filters</p>
        </div>
      )}
    </div>
  );
}

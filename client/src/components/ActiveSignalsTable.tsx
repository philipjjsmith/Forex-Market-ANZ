import { useState } from 'react';
import { Clock, TrendingUp, TrendingDown, Target, X, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { API_ENDPOINTS } from '@/config/api';
import { getToken } from '@/lib/auth';
import { calculatePotentialProfit } from '@/lib/profit-calculator';

interface ActiveSignal {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  entry_price: number;
  current_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  order_type: string;
  execution_type: string;
  created_at: string;
  expires_at: string;
  indicators: any;
}

interface PerformanceData {
  confidence_bracket: string;
  win_rate: number;
  total_signals: number;
}

interface ActiveSignalsTableProps {
  signals: ActiveSignal[];
  accountSize: number;
  performanceData: PerformanceData[];
  onSignalClosed: () => void;
}

export function ActiveSignalsTable({ signals, accountSize, performanceData, onSignalClosed }: ActiveSignalsTableProps) {
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<ActiveSignal | null>(null);
  const [closePrice, setClosePrice] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const calculateTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }

    return `${hours}h ${minutes}m`;
  };

  const calculateCurrentPL = (signal: ActiveSignal) => {
    // Use entry_price and current_price to calculate P/L
    const pipValue = 0.0001;
    let pips: number;

    if (signal.type === 'LONG') {
      pips = (signal.current_price - signal.entry_price) / pipValue;
    } else {
      pips = (signal.entry_price - signal.current_price) / pipValue;
    }

    return pips;
  };

  const handleCloseClick = (signal: ActiveSignal) => {
    setSelectedSignal(signal);
    setClosePrice(signal.current_price.toFixed(5));
    setCloseError(null);
    setIsCloseDialogOpen(true);
  };

  const handleCloseSignal = async () => {
    if (!selectedSignal || !closePrice) return;

    setIsClosing(true);
    setCloseError(null);

    try {
      const price = parseFloat(closePrice);
      if (isNaN(price)) {
        throw new Error('Invalid price');
      }

      const token = getToken();
      const response = await fetch(API_ENDPOINTS.SIGNALS_CLOSE(selectedSignal.signal_id), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({ closePrice: price }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to close signal');
      }

      // Success
      setIsCloseDialogOpen(false);
      setSelectedSignal(null);
      setClosePrice('');
      onSignalClosed();
    } catch (err: any) {
      setCloseError(err.message);
    } finally {
      setIsClosing(false);
    }
  };

  if (signals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <Clock className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <p>No active signals being tracked</p>
        <p className="text-sm mt-2">Generate signals with 70%+ confidence on the Dashboard</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-white/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-white/5">
              <TableHead className="text-blue-200">Symbol</TableHead>
              <TableHead className="text-blue-200">Type</TableHead>
              <TableHead className="text-blue-200">Confidence</TableHead>
              <TableHead className="text-blue-200">Entry</TableHead>
              <TableHead className="text-blue-200">TP1</TableHead>
              <TableHead className="text-blue-200">Stop Loss</TableHead>
              <TableHead className="text-blue-200">Current P/L</TableHead>
              <TableHead className="text-blue-200">Potential Profit</TableHead>
              <TableHead className="text-blue-200">Time Left</TableHead>
              <TableHead className="text-blue-200">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signals.map((signal) => {
              const currentPL = calculateCurrentPL(signal);
              const timeLeft = calculateTimeRemaining(signal.expires_at);
              const potentialProfit = calculatePotentialProfit(accountSize, signal, performanceData);

              return (
                <TableRow key={signal.signal_id} className="border-white/10 hover:bg-white/5">
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
                  <TableCell className="font-mono text-green-300">
                    {signal.tp1.toFixed(5)}
                  </TableCell>
                  <TableCell className="font-mono text-red-300">
                    {signal.stop_loss.toFixed(5)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`font-mono font-semibold ${
                        currentPL > 0
                          ? 'text-green-400'
                          : currentPL < 0
                          ? 'text-red-400'
                          : 'text-gray-400'
                      }`}
                    >
                      {currentPL > 0 ? '+' : ''}
                      {currentPL.toFixed(1)} pips
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-green-400" />
                      <span className="font-mono font-semibold text-green-400">
                        ${potentialProfit.profitUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {potentialProfit.riskPercent.toFixed(1)}% risk
                    </div>
                  </TableCell>
                  <TableCell className="text-yellow-300">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeLeft}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCloseClick(signal)}
                      className="border-blue-500/50 text-blue-300 hover:bg-blue-500/20"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Close
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Close Signal Dialog */}
      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent className="bg-slate-900 border-white/20 text-white">
          <DialogHeader>
            <DialogTitle>Close Signal Manually</DialogTitle>
            <DialogDescription className="text-blue-200">
              Enter the current price to close this signal and calculate P/L
            </DialogDescription>
          </DialogHeader>

          {selectedSignal && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Symbol</p>
                  <p className="font-semibold">{selectedSignal.symbol}</p>
                </div>
                <div>
                  <p className="text-gray-400">Type</p>
                  <p className="font-semibold">{selectedSignal.type}</p>
                </div>
                <div>
                  <p className="text-gray-400">Entry Price</p>
                  <p className="font-mono">{selectedSignal.entry_price.toFixed(5)}</p>
                </div>
                <div>
                  <p className="text-gray-400">Current Price</p>
                  <p className="font-mono">{selectedSignal.current_price.toFixed(5)}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="closePrice">Close Price</Label>
                <Input
                  id="closePrice"
                  type="number"
                  step="0.00001"
                  value={closePrice}
                  onChange={(e) => setClosePrice(e.target.value)}
                  placeholder="Enter close price"
                  className="bg-slate-800 border-white/20 text-white"
                />
              </div>

              {closeError && (
                <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
                  {closeError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCloseDialogOpen(false)}
              disabled={isClosing}
              className="border-white/20 hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCloseSignal}
              disabled={isClosing || !closePrice}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isClosing ? 'Closing...' : 'Close Signal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

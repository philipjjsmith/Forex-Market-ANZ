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
    // 🔧 FIX: JPY pairs use 0.01 for 1 pip, all other pairs use 0.0001
    const pipValue = signal.symbol.includes('JPY') ? 0.01 : 0.0001;
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
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="w-16 h-16 mx-auto mb-4 opacity-20" />
        <p>No active signals being tracked</p>
        <p className="text-sm mt-2">Generate signals with 70%+ confidence on the Dashboard</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-card-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-card-border hover:bg-card/20">
              <TableHead className="text-primary">Symbol</TableHead>
              <TableHead className="text-primary">Type</TableHead>
              <TableHead className="text-primary">Confidence</TableHead>
              <TableHead className="text-primary">Entry</TableHead>
              <TableHead className="text-primary">TP1</TableHead>
              <TableHead className="text-primary">Stop Loss</TableHead>
              <TableHead className="text-primary">Current P/L</TableHead>
              <TableHead className="text-primary">Potential Profit</TableHead>
              <TableHead className="text-primary">Time Left</TableHead>
              <TableHead className="text-primary">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signals.map((signal) => {
              const currentPL = calculateCurrentPL(signal);
              const timeLeft = calculateTimeRemaining(signal.expires_at);
              const potentialProfit = calculatePotentialProfit(accountSize, signal, performanceData);

              return (
                <TableRow key={signal.signal_id} className="border-card-border hover:bg-card/20">
                  <TableCell className="font-medium text-foreground">
                    {signal.symbol}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        signal.type === 'LONG'
                          ? 'border-chart-2/50 text-chart-2 bg-chart-2/10'
                          : 'border-destructive/50 text-destructive bg-destructive/10'
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
                          ? 'border-chart-2/50 text-chart-2 bg-chart-2/10'
                          : signal.confidence >= 80
                          ? 'border-primary/50 text-primary bg-primary/10'
                          : 'border-primary/40 text-primary bg-primary/10'
                      }
                    >
                      {signal.confidence}%
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-foreground">
                    {signal.entry_price.toFixed(5)}
                  </TableCell>
                  <TableCell className="font-mono text-chart-2">
                    {signal.tp1.toFixed(5)}
                  </TableCell>
                  <TableCell className="font-mono text-destructive">
                    {signal.stop_loss.toFixed(5)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`font-mono font-semibold ${
                        currentPL > 0
                          ? 'text-chart-2'
                          : currentPL < 0
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {currentPL > 0 ? '+' : ''}
                      {currentPL.toFixed(1)} pips
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-chart-2" />
                      <span className="font-mono font-semibold text-chart-2">
                        ${potentialProfit.profitUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {potentialProfit.riskPercent.toFixed(1)}% risk
                    </div>
                  </TableCell>
                  <TableCell className="text-primary">
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
                      className="border-primary/50 text-primary hover:bg-primary/20"
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
        <DialogContent className="bg-card border-card-border text-foreground">
          <DialogHeader>
            <DialogTitle>Close Signal Manually</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Enter the current price to close this signal and calculate P/L
            </DialogDescription>
          </DialogHeader>

          {selectedSignal && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Symbol</p>
                  <p className="font-semibold">{selectedSignal.symbol}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <p className="font-semibold">{selectedSignal.type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Entry Price</p>
                  <p className="font-mono">{selectedSignal.entry_price.toFixed(5)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Current Price</p>
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
                  className="bg-card/50 border-card-border text-foreground"
                />
              </div>

              {closeError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
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
              className="border-card-border hover:bg-card/80"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCloseSignal}
              disabled={isClosing || !closePrice}
              className="bg-primary hover:bg-primary/80 text-white"
            >
              {isClosing ? 'Closing...' : 'Close Signal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

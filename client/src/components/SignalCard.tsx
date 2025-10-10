import { TrendingUp, TrendingDown, Target, Shield, AlertTriangle, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

interface SignalCardProps {
  id?: string;
  type: 'LONG' | 'SHORT';
  symbol: string;
  entry: number;
  stop: number;
  stopLimitPrice?: number;
  targets: number[];
  confidence: number;
  rationale: string;
  timestamp: string;
  orderType?: string;
  onSaveToggle?: (id: string, saved: boolean) => void;
}

export default function SignalCard({
  id = '',
  type,
  symbol,
  entry,
  stop,
  stopLimitPrice,
  targets,
  confidence,
  rationale,
  timestamp,
  orderType = 'MARKET',
  onSaveToggle
}: SignalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const isLong = type === 'LONG';

  useEffect(() => {
    const savedSignals = JSON.parse(localStorage.getItem('savedSignals') || '[]');
    setIsSaved(savedSignals.some((s: any) => s.id === id));
  }, [id]);

  const handleSaveToggle = () => {
    const savedSignals = JSON.parse(localStorage.getItem('savedSignals') || '[]');
    let newSaved;
    
    if (isSaved) {
      newSaved = savedSignals.filter((s: any) => s.id !== id);
    } else {
      newSaved = [...savedSignals, { id, type, symbol, entry, stop, stopLimitPrice, targets, confidence, rationale, timestamp, orderType }];
    }
    
    localStorage.setItem('savedSignals', JSON.stringify(newSaved));
    setIsSaved(!isSaved);
    onSaveToggle?.(id, !isSaved);
    console.log('Signal saved status:', !isSaved);
  };
  
  const getConfidenceColor = (conf: number) => {
    if (conf >= 85) return 'bg-market-green text-white';
    if (conf >= 70) return 'bg-primary text-white';
    return 'bg-amber-500 text-white';
  };

  const riskReward = Math.abs((targets[1] - entry) / (stop - entry)).toFixed(2);

  return (
    <Card className="hover-elevate" data-testid={`signal-${symbol}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <CardTitle className="text-lg font-semibold">{symbol}</CardTitle>
            <Badge className={isLong ? 'bg-market-green text-white' : 'bg-market-red text-white'}>
              {isLong ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {type}
            </Badge>
            <Badge variant="outline" className="text-xs">{orderType}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getConfidenceColor(confidence)} data-testid={`confidence-${symbol}`}>
              {confidence}%
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 ${isSaved ? 'text-amber-500' : 'text-muted-foreground'}`}
              onClick={handleSaveToggle}
              data-testid={`button-save-${symbol}`}
            >
              <Star className={`w-4 h-4 ${isSaved ? 'fill-amber-500' : ''}`} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {new Date(timestamp).toLocaleString()}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Entry</p>
            <p className="font-mono font-semibold" data-testid={`entry-${symbol}`}>{entry.toFixed(5)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Shield className="w-3 h-3" /> Stop Loss
            </p>
            <p className="font-mono font-semibold text-market-red" data-testid={`stop-${symbol}`}>{stop.toFixed(5)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" /> R:R
            </p>
            <p className="font-mono font-semibold" data-testid={`rr-${symbol}`}>1:{riskReward}</p>
          </div>
        </div>

        {stopLimitPrice && (orderType === 'BUY_STOP_LIMIT' || orderType === 'SELL_STOP_LIMIT') && (
          <div className="p-2 rounded-md bg-muted">
            <p className="text-xs text-muted-foreground mb-1">Stop Limit Price</p>
            <p className="font-mono font-semibold text-sm">{stopLimitPrice.toFixed(5)}</p>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-2">Take Profit Targets</p>
          <div className="flex gap-2">
            {targets.map((target, idx) => (
              <div key={idx} className="flex-1 p-2 rounded-md bg-muted">
                <p className="text-xs text-muted-foreground">TP{idx + 1}</p>
                <p className="font-mono font-semibold text-sm text-market-green">{target.toFixed(5)}</p>
              </div>
            ))}
          </div>
        </div>

        {expanded && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Analysis
            </p>
            <p className="text-sm">{rationale}</p>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            setExpanded(!expanded);
            console.log('Signal expanded:', symbol, !expanded);
          }}
          data-testid={`button-expand-${symbol}`}
        >
          {expanded ? 'Hide Details' : 'Show Details'}
        </Button>
      </CardContent>
    </Card>
  );
}

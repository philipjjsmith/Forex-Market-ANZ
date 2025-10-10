import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface PriceCardProps {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  onClick?: () => void;
}

export default function PriceCard({ symbol, name, price, change, changePercent, onClick }: PriceCardProps) {
  const isPositive = change >= 0;
  
  return (
    <Card 
      className="hover-elevate active-elevate-2 cursor-pointer transition-all"
      onClick={() => {
        onClick?.();
        console.log('Price card clicked:', symbol);
      }}
      data-testid={`card-price-${symbol}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground" data-testid={`text-symbol-${symbol}`}>{symbol}</h3>
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-market-green" />
              ) : (
                <TrendingDown className="w-4 h-4 text-market-red" />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{name}</p>
          </div>
          
          <div className="text-right">
            <p className="font-mono font-semibold text-lg" data-testid={`text-price-${symbol}`}>
              {price.toFixed(5)}
            </p>
            <p className={`text-xs font-mono ${isPositive ? 'text-market-green' : 'text-market-red'}`} data-testid={`text-change-${symbol}`}>
              {isPositive ? '+' : ''}{change.toFixed(5)} ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

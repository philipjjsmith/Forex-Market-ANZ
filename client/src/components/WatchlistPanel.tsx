import { Plus, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface WatchlistPanelProps {
  items?: WatchlistItem[];
}

export default function WatchlistPanel({ items = [] }: WatchlistPanelProps) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(items);

  const removeItem = (symbol: string) => {
    setWatchlist(watchlist.filter(item => item.symbol !== symbol));
    console.log('Removed from watchlist:', symbol);
  };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">Watchlist</CardTitle>
        <Button size="sm" variant="outline" data-testid="button-add-watchlist">
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="px-4 space-y-2 pb-4">
            {watchlist.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Star className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No items in watchlist</p>
                <p className="text-xs mt-1">Click Add to start tracking</p>
              </div>
            ) : (
              watchlist.map((item) => {
                const isPositive = item.change >= 0;
                return (
                  <div
                    key={item.symbol}
                    className="flex items-center justify-between p-3 rounded-md hover-elevate border"
                    data-testid={`watchlist-item-${item.symbol}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{item.symbol}</span>
                        <Badge variant={isPositive ? "default" : "destructive"} className="text-xs font-mono">
                          {isPositive ? '+' : ''}{item.changePercent.toFixed(2)}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{item.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-sm">${item.price.toFixed(2)}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => removeItem(item.symbol)}
                        data-testid={`button-remove-${item.symbol}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

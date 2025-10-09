import { TrendingUp, TrendingDown, Search, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";

interface MarketHeaderProps {
  selectedSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
}

export default function MarketHeader({ selectedSymbol = "SPY", onSymbolChange }: MarketHeaderProps) {
  const [isDark, setIsDark] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <header className="border-b bg-card sticky top-0 z-50">
      <div className="flex items-center justify-between px-4 py-3 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-foreground">Market Tracker</h1>
          <div className="hidden md:flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">S&P 500</span>
            <span className="font-mono font-semibold text-market-green">4,783.45</span>
            <span className="flex items-center text-market-green text-xs">
              <TrendingUp className="w-3 h-3 mr-1" />
              +1.24%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search symbols..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-symbol"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setIsDark(!isDark);
              console.log('Theme toggled:', !isDark ? 'dark' : 'light');
            }}
            data-testid="button-theme-toggle"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}

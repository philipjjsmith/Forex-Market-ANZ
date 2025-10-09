import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Holding {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  totalValue: number;
  gainLoss: number;
  gainLossPercent: number;
}

interface PortfolioHoldingsProps {
  holdings?: Holding[];
}

export default function PortfolioHoldings({ holdings = [] }: PortfolioHoldingsProps) {
  const [sortBy, setSortBy] = useState<keyof Holding | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sortedHoldings = [...holdings].sort((a, b) => {
    if (!sortBy) return 0;
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortAsc ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
  });

  const handleSort = (field: keyof Holding) => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(true);
    }
    console.log('Sorting by:', field, sortAsc ? 'asc' : 'desc');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Portfolio Holdings</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button variant="ghost" size="sm" onClick={() => handleSort('symbol')} className="p-0 h-auto font-semibold" data-testid="sort-symbol">
                    Symbol <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleSort('shares')} className="p-0 h-auto font-semibold" data-testid="sort-shares">
                    Shares <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleSort('totalValue')} className="p-0 h-auto font-semibold" data-testid="sort-value">
                    Total Value <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleSort('gainLoss')} className="p-0 h-auto font-semibold" data-testid="sort-gainloss">
                    Gain/Loss <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedHoldings.map((holding) => {
                const isPositive = holding.gainLoss >= 0;
                return (
                  <TableRow key={holding.symbol} className="hover-elevate" data-testid={`holding-row-${holding.symbol}`}>
                    <TableCell className="font-semibold">{holding.symbol}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{holding.name}</TableCell>
                    <TableCell className="text-right font-mono">{holding.shares.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{holding.avgCost.toFixed(5)}</TableCell>
                    <TableCell className="text-right font-mono">{holding.currentPrice.toFixed(5)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">${holding.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className={`text-right font-mono ${isPositive ? 'text-market-green' : 'text-market-red'}`}>
                      {isPositive ? '+' : ''}${Math.abs(holding.gainLoss).toFixed(2)}
                      <div className="text-xs">({isPositive ? '+' : ''}{holding.gainLossPercent.toFixed(2)}%)</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

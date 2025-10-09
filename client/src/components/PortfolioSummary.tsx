import { TrendingUp, DollarSign, Activity, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PortfolioSummaryProps {
  totalValue?: number;
  totalGain?: number;
  totalGainPercent?: number;
  dayGain?: number;
  dayGainPercent?: number;
}

export default function PortfolioSummary({
  totalValue = 125430.50,
  totalGain = 12430.50,
  totalGainPercent = 10.98,
  dayGain = 1245.30,
  dayGainPercent = 1.00
}: PortfolioSummaryProps) {
  const isTotalPositive = totalGain >= 0;
  const isDayPositive = dayGain >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
          <DollarSign className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono" data-testid="text-total-value">
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Gain/Loss</CardTitle>
          <TrendingUp className={`w-4 h-4 ${isTotalPositive ? 'text-market-green' : 'text-market-red'}`} />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold font-mono ${isTotalPositive ? 'text-market-green' : 'text-market-red'}`} data-testid="text-total-gain">
            {isTotalPositive ? '+' : ''}${Math.abs(totalGain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className={`text-xs font-mono mt-1 ${isTotalPositive ? 'text-market-green' : 'text-market-red'}`}>
            {isTotalPositive ? '+' : ''}{totalGainPercent.toFixed(2)}%
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Day Gain/Loss</CardTitle>
          <Activity className={`w-4 h-4 ${isDayPositive ? 'text-market-green' : 'text-market-red'}`} />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold font-mono ${isDayPositive ? 'text-market-green' : 'text-market-red'}`} data-testid="text-day-gain">
            {isDayPositive ? '+' : ''}${Math.abs(dayGain).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className={`text-xs font-mono mt-1 ${isDayPositive ? 'text-market-green' : 'text-market-red'}`}>
            {isDayPositive ? '+' : ''}{dayGainPercent.toFixed(2)}%
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
          <Target className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono" data-testid="text-win-rate">67.5%</div>
          <p className="text-xs text-muted-foreground mt-1">Last 30 days</p>
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Indicator {
  name: string;
  value: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  description: string;
}

interface TechnicalIndicatorsProps {
  indicators?: Indicator[];
}

export default function TechnicalIndicators({ indicators = [] }: TechnicalIndicatorsProps) {
  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'bullish':
        return 'text-market-green';
      case 'bearish':
        return 'text-market-red';
      default:
        return 'text-muted-foreground';
    }
  };

  const getSignalBadge = (signal: string) => {
    switch (signal) {
      case 'bullish':
        return <Badge className="bg-market-green text-white">Bullish</Badge>;
      case 'bearish':
        return <Badge className="bg-market-red text-white">Bearish</Badge>;
      default:
        return <Badge variant="secondary">Neutral</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Technical Indicators</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {indicators.map((indicator, index) => (
          <div key={index} className="flex items-center justify-between pb-3 border-b last:border-0" data-testid={`indicator-${indicator.name}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">{indicator.name}</h4>
                {getSignalBadge(indicator.signal)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{indicator.description}</p>
            </div>
            <div className={`font-mono font-semibold text-lg ${getSignalColor(indicator.signal)}`}>
              {indicator.value}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

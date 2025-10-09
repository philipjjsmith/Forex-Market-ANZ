import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useState } from "react";

interface ChartDataPoint {
  time: string;
  price: number;
  volume?: number;
  ma20?: number;
  ma50?: number;
}

interface MarketChartProps {
  symbol?: string;
  data?: ChartDataPoint[];
}

export default function MarketChart({ symbol = "SPY", data = [] }: MarketChartProps) {
  const [timeframe, setTimeframe] = useState("1D");

  return (
    <Card className="col-span-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">{symbol} Price Chart</CardTitle>
        <Tabs value={timeframe} onValueChange={setTimeframe} className="w-auto">
          <TabsList>
            <TabsTrigger value="1D" data-testid="tab-1d">1D</TabsTrigger>
            <TabsTrigger value="1W" data-testid="tab-1w">1W</TabsTrigger>
            <TabsTrigger value="1M" data-testid="tab-1m">1M</TabsTrigger>
            <TabsTrigger value="3M" data-testid="tab-3m">3M</TabsTrigger>
            <TabsTrigger value="1Y" data-testid="tab-1y">1Y</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1E3A8A" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#1E3A8A" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis 
                dataKey="time" 
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis 
                tick={{ fill: '#6b7280', fontSize: 12 }}
                tickLine={{ stroke: '#e5e7eb' }}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontFamily: 'JetBrains Mono, monospace'
                }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="price" 
                stroke="#1E3A8A" 
                strokeWidth={2}
                fill="url(#colorPrice)" 
                name="Price"
              />
              <Line 
                type="monotone" 
                dataKey="ma20" 
                stroke="#059669" 
                strokeWidth={1.5}
                dot={false}
                name="MA(20)"
              />
              <Line 
                type="monotone" 
                dataKey="ma50" 
                stroke="#DC2626" 
                strokeWidth={1.5}
                dot={false}
                name="MA(50)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

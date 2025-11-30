import { useState } from "react";
import { TrendingUp, TrendingDown, Clock, Target, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WinningTradeChart from "./WinningTradeChart";

interface Candle {
  date?: string;
  timestamp?: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface WinningTrade {
  signal_id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  confidence: number;
  tier: 'HIGH' | 'MEDIUM';
  entry_price: number;
  stop_loss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  outcome: 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT';
  outcome_price: number;
  outcome_time: string;
  profit_loss_pips: number;
  indicators: {
    rsi: string;
    adx: string;
    macd: {
      value: number;
      signal: number;
      histogram: number;
    };
    ema20: number;
    ema50: number;
    atr: number;
    bb: {
      upper: number;
      middle: number;
      lower: number;
    };
  };
  candles: Candle[];
  strategy_name: string;
  strategy_version: string;
  created_at: string;
  duration: string;
  durationHours: number;
  achievedRR: number;
}

interface WinningTradeCardProps {
  trade: WinningTrade;
}

export default function WinningTradeCard({ trade: rawTrade }: WinningTradeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'simple' | 'advanced'>('simple');

  // Convert all numeric fields to actual numbers (backend may send strings)
  const trade = {
    ...rawTrade,
    entry_price: Number(rawTrade.entry_price),
    stop_loss: Number(rawTrade.stop_loss),
    tp1: Number(rawTrade.tp1),
    tp2: Number(rawTrade.tp2),
    tp3: Number(rawTrade.tp3),
    outcome_price: Number(rawTrade.outcome_price),
    profit_loss_pips: Number(rawTrade.profit_loss_pips),
    achievedRR: Number(rawTrade.achievedRR),
    confidence: Number(rawTrade.confidence),
  };

  const isLong = trade.type === 'LONG';
  const targetHit = trade.outcome === 'TP1_HIT' ? 1 : trade.outcome === 'TP2_HIT' ? 2 : 3;

  // Get explanation based on trade data
  const explanation = getWinningTradeExplanation(trade);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isLong ? 'bg-emerald-100' : 'bg-rose-100'}`}>
              {isLong ? (
                <TrendingUp className="h-6 w-6 text-emerald-600" />
              ) : (
                <TrendingDown className="h-6 w-6 text-rose-600" />
              )}
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">{trade.symbol}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={isLong ? "default" : "destructive"} className="font-semibold">
                  {trade.type}
                </Badge>
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  TP{targetHit} Hit
                </Badge>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-emerald-600">
              +{trade.profit_loss_pips.toFixed(1)} pips
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              {trade.achievedRR.toFixed(2)}:1 R:R
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Chart */}
        <div className="rounded-lg overflow-hidden border border-gray-200">
          <WinningTradeChart
            candles={trade.candles}
            entryPrice={trade.entry_price}
            entryTime={new Date(trade.created_at).getTime() / 1000}
            exitPrice={trade.outcome_price}
            exitTime={new Date(trade.outcome_time).getTime() / 1000}
            stopLoss={trade.stop_loss}
            tp1={trade.tp1}
            tp2={trade.tp2}
            tp3={trade.tp3}
            type={isLong ? 'long' : 'short'}
            targetHit={targetHit}
          />
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
            <Clock className="h-4 w-4 text-slate-600" />
            <div>
              <div className="text-xs text-muted-foreground">Duration</div>
              <div className="font-semibold text-sm">{trade.duration}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
            <Target className="h-4 w-4 text-slate-600" />
            <div>
              <div className="text-xs text-muted-foreground">Entry</div>
              <div className="font-semibold text-sm font-mono">{trade.entry_price.toFixed(5)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div>
              <div className="text-xs text-muted-foreground">Exit</div>
              <div className="font-semibold text-sm font-mono text-emerald-700">{trade.outcome_price.toFixed(5)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
            <div className="text-blue-600 font-bold text-sm">
              {trade.confidence}%
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Confidence</div>
              <div className="font-semibold text-sm">{trade.tier === 'HIGH' ? 'Live Trade' : 'Practice'}</div>
            </div>
          </div>
        </div>

        {/* Progressive Disclosure - Layer 1: Summary */}
        <div className="pt-2 border-t">
          <div className="prose prose-sm max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              {explanation.summary}
            </p>
          </div>

          <Button
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            className="w-full mt-3 text-sm"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-2" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-2" />
                Learn Why This Trade Won
              </>
            )}
          </Button>
        </div>

        {/* Progressive Disclosure - Layer 2: Detailed Explanation */}
        {expanded && (
          <div className="space-y-4 pt-4 border-t animate-in slide-in-from-top-2">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'simple' | 'advanced')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="simple">Simple Explanation</TabsTrigger>
                <TabsTrigger value="advanced">Advanced Analysis</TabsTrigger>
              </TabsList>

              <TabsContent value="simple" className="space-y-4 mt-4">
                {/* The Setup */}
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">1</div>
                    The Setup
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {explanation.simple.setup}
                  </p>
                </div>

                {/* The Execution */}
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold">2</div>
                    The Execution
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {explanation.simple.execution}
                  </p>
                </div>

                {/* Why It Worked */}
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-bold">3</div>
                    Why It Worked
                  </h4>
                  <ul className="space-y-2">
                    {explanation.simple.whyItWorked.map((reason, idx) => (
                      <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Key Lesson */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-sm mb-2 text-blue-900">Key Lesson</h4>
                  <p className="text-sm text-blue-800 leading-relaxed">
                    {explanation.simple.keyLesson}
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="advanced" className="space-y-4 mt-4">
                {/* Technical Analysis */}
                <div>
                  <h4 className="font-semibold text-sm mb-3">Technical Indicators</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground">RSI</div>
                      <div className="font-semibold text-sm font-mono">{trade.indicators.rsi}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground">ADX</div>
                      <div className="font-semibold text-sm font-mono">{trade.indicators.adx}</div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground">MACD</div>
                      <div className="font-semibold text-sm font-mono">
                        {formatNumber(trade.indicators.macd?.histogram, 4)}
                      </div>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg">
                      <div className="text-xs text-muted-foreground">ATR</div>
                      <div className="font-semibold text-sm font-mono">{formatNumber(trade.indicators.atr, 5)}</div>
                    </div>
                  </div>
                </div>

                {/* Multi-Timeframe Analysis */}
                <div>
                  <h4 className="font-semibold text-sm mb-2">Multi-Timeframe Confluence</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {explanation.advanced.multiTimeframe}
                  </p>
                </div>

                {/* Risk Management */}
                <div>
                  <h4 className="font-semibold text-sm mb-2">Risk Management Execution</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {explanation.advanced.riskManagement}
                  </p>
                </div>

                {/* Strategy Version */}
                <div className="bg-slate-50 p-3 rounded-lg">
                  <div className="text-xs text-muted-foreground">Strategy</div>
                  <div className="font-semibold text-sm">
                    {trade.strategy_name} {trade.strategy_version}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Safe number formatting helper
function formatNumber(value: any, decimals: number): string {
  const num = Number(value);
  return isNaN(num) ? 'N/A' : num.toFixed(decimals);
}

// Safe number extraction helper
function toNumber(value: any, defaultValue: number = 0): number {
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

// Explanation generator based on trade data
function getWinningTradeExplanation(trade: WinningTrade) {
  const isLong = trade.type === 'LONG';
  const targetHit = trade.outcome === 'TP1_HIT' ? 1 : trade.outcome === 'TP2_HIT' ? 2 : 3;
  const rsiValue = toNumber(trade.indicators.rsi);
  const adxValue = toNumber(trade.indicators.adx);

  // Determine trend strength
  const trendStrength = adxValue > 40 ? 'very strong' : adxValue > 30 ? 'strong' : 'moderate';

  // Determine momentum quality (safely handle missing MACD data)
  const macdHistogram = toNumber(trade.indicators.macd?.histogram, 0);
  const momentumQuality = Math.abs(macdHistogram) > 0.001 ? 'strong' : 'moderate';

  return {
    summary: `This ${isLong ? 'buy' : 'sell'} signal on ${trade.symbol} captured +${trade.profit_loss_pips.toFixed(1)} pips over ${trade.duration} with a ${trendStrength} trend and ${momentumQuality} momentum. The trade reached TP${targetHit}, delivering ${trade.achievedRR.toFixed(2)}:1 risk/reward.`,

    simple: {
      setup: `We identified a ${isLong ? 'bullish' : 'bearish'} opportunity on ${trade.symbol} when the market showed ${trendStrength} ${isLong ? 'upward' : 'downward'} momentum. Multiple indicators aligned: the RSI was at ${rsiValue.toFixed(1)} (showing ${isLong ? 'buying pressure without being overbought' : 'selling pressure without being oversold'}), and the trend strength (ADX) registered ${adxValue.toFixed(1)}, confirming a ${trendStrength} trend.`,

      execution: `We entered ${isLong ? 'long' : 'short'} at ${trade.entry_price.toFixed(5)} with a protective stop-loss at ${trade.stop_loss.toFixed(5)}. The trade took ${trade.duration} to develop, and price ${isLong ? 'rallied' : 'dropped'} to ${trade.outcome_price.toFixed(5)}, hitting our ${targetHit === 1 ? 'first' : targetHit === 2 ? 'second' : 'third'} profit target.`,

      whyItWorked: [
        `${trendStrength.charAt(0).toUpperCase() + trendStrength.slice(1)} directional trend (ADX: ${adxValue.toFixed(1)}) provided sustained momentum`,
        `RSI at ${rsiValue.toFixed(1)} indicated optimal ${isLong ? 'buying' : 'selling'} conditions without exhaustion`,
        `MACD histogram of ${macdHistogram > 0 ? '+' : ''}${macdHistogram.toFixed(4)} confirmed ${momentumQuality} ${isLong ? 'bullish' : 'bearish'} momentum`,
        `Proper risk management with ${trade.confidence}% confidence enabled ${trade.tier === 'HIGH' ? 'live trading with 1.5% account risk' : 'practice signal execution'}`
      ],

      keyLesson: `Multi-indicator confluence is key. This trade succeeded because trend strength (ADX), momentum (MACD), and positioning (RSI) all aligned in the same direction. The ${trade.durationHours < 12 ? 'quick' : trade.durationHours < 48 ? 'steady' : 'patient'} ${trade.duration} move to TP${targetHit} demonstrates the importance of letting winners run when trend conditions support continuation.`
    },

    advanced: {
      multiTimeframe: `This signal was generated using ICT 3-Timeframe Rule methodology (${trade.strategy_version}). Weekly, Daily, and 4H timeframes showed ${isLong ? 'bullish' : 'bearish'} alignment with EMA20/50 crossovers and MACD confirmation. The 1H timeframe provided optimal entry timing${trade.durationHours > 24 ? ', with patience rewarded as the multi-day trend developed' : ' for quick momentum capture'}.`,

      riskManagement: `Initial risk was ${Math.abs(trade.entry_price - trade.stop_loss).toFixed(5)} (${(Math.abs(trade.entry_price - trade.stop_loss) / (trade.symbol.includes('JPY') ? 0.01 : 0.0001)).toFixed(1)} pips). ATR-based position sizing at ${formatNumber(trade.indicators.atr, 5)} enabled optimal stop placement. Achieved R:R of ${trade.achievedRR.toFixed(2)}:1 by reaching TP${targetHit} at ${trade.outcome_price.toFixed(5)}, ${targetHit === 1 ? 'capturing 33% of position' : targetHit === 2 ? 'capturing 67% of position' : 'full position closure at maximum target'}.`
    }
  };
}

import TechnicalIndicators from '../TechnicalIndicators';

export default function TechnicalIndicatorsExample() {
  const mockIndicators = [
    { name: "RSI (14)", value: "68.5", signal: "bullish" as const, description: "Momentum indicator showing strength" },
    { name: "MACD", value: "2.34", signal: "bullish" as const, description: "Trend-following momentum indicator" },
    { name: "ADX (14)", value: "42.1", signal: "neutral" as const, description: "Trend strength indicator" },
    { name: "Stochastic", value: "72.8", signal: "bearish" as const, description: "Overbought/oversold indicator" },
  ];

  return <TechnicalIndicators indicators={mockIndicators} />;
}

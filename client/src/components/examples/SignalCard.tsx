import SignalCard from '../SignalCard';

export default function SignalCardExample() {
  return (
    <div className="space-y-4 p-4">
      <SignalCard
        type="LONG"
        symbol="AAPL"
        entry={185.50}
        stop={182.30}
        targets={[188.25, 191.50, 195.00]}
        confidence={85}
        rationale="Bullish MA crossover detected. RSI in favorable range. Strong trend confirmed by ADX. Higher timeframe trend is bullish."
        timestamp={new Date().toISOString()}
      />
      <SignalCard
        type="SHORT"
        symbol="TSLA"
        entry={245.80}
        stop={249.20}
        targets={[242.50, 239.00, 235.00]}
        confidence={72}
        rationale="Bearish MA crossover detected. RSI showing weakness. Price in upper BB region. Higher timeframe trend is bearish."
        timestamp={new Date().toISOString()}
      />
    </div>
  );
}

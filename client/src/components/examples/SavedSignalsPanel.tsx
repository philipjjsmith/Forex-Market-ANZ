import SavedSignalsPanel from '../SavedSignalsPanel';

export default function SavedSignalsPanelExample() {
  // Pre-populate with some saved signals for demo
  const demoSignals = [
    {
      id: "DEMO1",
      type: "LONG" as const,
      symbol: "EUR/USD",
      entry: 1.08945,
      stop: 1.08645,
      targets: [1.09395, 1.09945, 1.10645],
      confidence: 85,
      rationale: "Bullish MA crossover detected. RSI in favorable range.",
      timestamp: new Date().toISOString(),
      orderType: "BUY_LIMIT"
    }
  ];
  
  // Save to localStorage for demo
  if (typeof window !== 'undefined') {
    localStorage.setItem('savedSignals', JSON.stringify(demoSignals));
  }

  return <SavedSignalsPanel />;
}

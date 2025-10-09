import PriceCard from '../PriceCard';

export default function PriceCardExample() {
  return (
    <div className="space-y-4 p-4">
      <PriceCard
        symbol="AAPL"
        name="Apple Inc."
        price={185.92}
        change={3.45}
        changePercent={1.89}
      />
      <PriceCard
        symbol="TSLA"
        name="Tesla Inc."
        price={242.18}
        change={-5.32}
        changePercent={-2.15}
      />
    </div>
  );
}

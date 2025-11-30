import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, IPriceLine } from "lightweight-charts";

interface Candle {
  date?: string;
  timestamp?: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface WinningTradeChartProps {
  candles: Candle[];
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  type: 'long' | 'short';
  targetHit: 1 | 2 | 3;
  height?: number;
}

export default function WinningTradeChart(props: WinningTradeChartProps) {
  // Convert all price props to numbers (PostgreSQL may return DECIMAL as strings)
  const entryPrice = Number(props.entryPrice);
  const exitPrice = Number(props.exitPrice);
  const stopLoss = Number(props.stopLoss);
  const tp1 = Number(props.tp1);
  const tp2 = Number(props.tp2);
  const tp3 = Number(props.tp3);

  // Extract remaining props
  const { candles, entryTime, exitTime, type, targetHit, height = 400 } = props;

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#333",
      },
      grid: {
        vertLines: { color: "#e1e1e1" },
        horzLines: { color: "#e1e1e1" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#cccccc",
      },
      timeScale: {
        borderColor: "#cccccc",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    candlestickSeriesRef.current = candlestickSeries;

    // Handle window resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [height]);

  // Update candle data
  useEffect(() => {
    if (!candlestickSeriesRef.current || !candles || candles.length === 0) return;

    const chartData: CandlestickData[] = candles.map((candle) => {
      let time: Time;

      if (candle.timestamp) {
        time = Math.floor(candle.timestamp.getTime() / 1000) as Time;
      } else if (candle.date) {
        time = Math.floor(new Date(candle.date).getTime() / 1000) as Time;
      } else {
        time = Math.floor(Date.now() / 1000) as Time;
      }

      return {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
    });

    chartData.sort((a, b) => (a.time as number) - (b.time as number));
    candlestickSeriesRef.current.setData(chartData);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  // Draw price lines and zones
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    // Clear old price lines
    priceLinesRef.current.forEach(line => {
      candlestickSeriesRef.current!.removePriceLine(line);
    });
    priceLinesRef.current = [];

    const newPriceLines: IPriceLine[] = [];

    // Entry line (blue, solid)
    const entryLine = candlestickSeriesRef.current.createPriceLine({
      price: entryPrice,
      color: '#2962FF',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: `Entry: ${entryPrice.toFixed(5)}`,
    });
    newPriceLines.push(entryLine);

    // Stop Loss line (red, dashed)
    const slLine = candlestickSeriesRef.current.createPriceLine({
      price: stopLoss,
      color: '#ef5350',
      lineWidth: 2,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `SL: ${stopLoss.toFixed(5)}`,
    });
    newPriceLines.push(slLine);

    // TP1 line (green, dashed)
    const tp1Line = candlestickSeriesRef.current.createPriceLine({
      price: tp1,
      color: '#10b981',
      lineWidth: targetHit >= 1 ? 3 : 2,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `TP1: ${tp1.toFixed(5)}${targetHit === 1 ? ' ✓' : ''}`,
    });
    newPriceLines.push(tp1Line);

    // TP2 line (green, dashed)
    const tp2Line = candlestickSeriesRef.current.createPriceLine({
      price: tp2,
      color: '#10b981',
      lineWidth: targetHit >= 2 ? 3 : 2,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `TP2: ${tp2.toFixed(5)}${targetHit === 2 ? ' ✓' : ''}`,
    });
    newPriceLines.push(tp2Line);

    // TP3 line (green, dashed)
    const tp3Line = candlestickSeriesRef.current.createPriceLine({
      price: tp3,
      color: '#10b981',
      lineWidth: targetHit >= 3 ? 3 : 2,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `TP3: ${tp3.toFixed(5)}${targetHit === 3 ? ' ✓' : ''}`,
    });
    newPriceLines.push(tp3Line);

    // Exit marker (where trade actually closed)
    const exitLine = candlestickSeriesRef.current.createPriceLine({
      price: exitPrice,
      color: '#059669',
      lineWidth: 3,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: `Exit: ${exitPrice.toFixed(5)} ✓`,
    });
    newPriceLines.push(exitLine);

    priceLinesRef.current = newPriceLines;
  }, [entryPrice, stopLoss, tp1, tp2, tp3, exitPrice, targetHit]);

  return (
    <div className="relative">
      <div
        ref={chartContainerRef}
        className="rounded-lg overflow-hidden"
        style={{ width: "100%", height: `${height}px` }}
      />

      {/* Legend */}
      <div className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm p-3 rounded-lg shadow-sm border border-gray-200 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-blue-600"></div>
          <span className="text-gray-700">Entry: {entryPrice.toFixed(5)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-red-500 border-t-2 border-dashed border-red-500"></div>
          <span className="text-gray-700">Stop Loss: {stopLoss.toFixed(5)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-emerald-500 border-t-2 border-dashed border-emerald-500"></div>
          <span className="text-gray-700">Take Profits</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-emerald-600"></div>
          <span className="text-emerald-700 font-semibold">Exit ✓</span>
        </div>
      </div>

      {/* Trade Result Badge */}
      <div className="absolute top-2 right-2 bg-emerald-600 text-white px-3 py-2 rounded-lg shadow-lg font-semibold text-sm">
        TP{targetHit} Hit ✓
      </div>
    </div>
  );
}

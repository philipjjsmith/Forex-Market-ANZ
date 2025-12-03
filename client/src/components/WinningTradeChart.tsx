import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, CandlestickSeries, Time, IPriceLine } from "lightweight-charts";

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
  const height = Number(props.height) || 400;

  // Extract remaining props
  const { candles, entryTime, exitTime, type, targetHit } = props;

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Ensure we have valid dimensions (fallback if container not sized yet)
    const containerWidth = chartContainerRef.current.clientWidth || 600;
    const containerHeight = height || 400;

    let chart;
    let candlestickSeries;

    try {
      chart = createChart(chartContainerRef.current, {
        width: containerWidth,
        height: containerHeight,
        layout: {
          background: { color: "#ffffff" },
          textColor: "#191919",
          fontSize: 12,
        },
        grid: {
          vertLines: {
            color: "#e0e3eb",
            style: 1,
          },
          horzLines: {
            color: "#e0e3eb",
            style: 1,
          },
        },
        crosshair: {
          mode: 1,
          vertLine: {
            color: '#758696',
            width: 1,
            style: 3,
            labelBackgroundColor: '#4682B4',
          },
          horzLine: {
            color: '#758696',
            width: 1,
            style: 3,
            labelBackgroundColor: '#4682B4',
          },
        },
        rightPriceScale: {
          borderColor: "#d1d4dc",
          scaleMargins: {
            top: 0.05,    // Tighter view: 5% padding (was 10%)
            bottom: 0.05,
          },
          autoScale: false,  // Fixed range based on trade prices, not candle data
        },
        timeScale: {
          borderColor: "#d1d4dc",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 12,
          barSpacing: 8,
          minBarSpacing: 4,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
        },
      });

      if (!chart) {
        throw new Error('createChart returned null/undefined');
      }

      chartRef.current = chart;

      candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });

      if (!candlestickSeries) {
        throw new Error('addCandlestickSeries returned null/undefined');
      }

      candlestickSeriesRef.current = candlestickSeries;
    } catch (error) {
      console.error('Chart initialization error:', error, {
        containerWidth,
        containerHeight,
        chartExists: !!chart,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      return;
    }

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
        // timestamp might be a Date object or a string - handle both
        const date = candle.timestamp instanceof Date ? candle.timestamp : new Date(candle.timestamp);
        time = Math.floor(date.getTime() / 1000) as Time;
      } else if (candle.date) {
        time = Math.floor(new Date(candle.date).getTime() / 1000) as Time;
      } else {
        time = Math.floor(Date.now() / 1000) as Time;
      }

      return {
        time,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      };
    });

    chartData.sort((a, b) => (a.time as number) - (b.time as number));
    candlestickSeriesRef.current.setData(chartData);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles]);

  // Set explicit price range based on trade levels (not candle data)
  useEffect(() => {
    if (!chartRef.current || !candlestickSeriesRef.current || !candles || candles.length === 0) return;

    try {
      // Calculate price range from trade levels
      const pricePoints = [entryPrice, stopLoss, tp1, tp2, tp3, exitPrice].filter(p => p > 0);
      if (pricePoints.length === 0) return;

      const minPrice = Math.min(...pricePoints);
      const maxPrice = Math.max(...pricePoints);
      const range = maxPrice - minPrice;

      // Add 10% padding to ensure candles fit comfortably
      const padding = range * 0.10;

      // Set visible range on time axis (shows all candles)
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: 0,
        to: Math.max(candles.length - 1, 0),
      });

    } catch (error) {
      console.error('Error setting chart range:', error);
    }
  }, [entryPrice, stopLoss, tp1, tp2, tp3, exitPrice, candles]);

  // Draw price lines and zones
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    // Clear old price lines
    priceLinesRef.current.forEach(line => {
      candlestickSeriesRef.current!.removePriceLine(line);
    });
    priceLinesRef.current = [];

    const newPriceLines: IPriceLine[] = [];

    // Entry line (blue)
    const entryLine = candlestickSeriesRef.current.createPriceLine({
      price: entryPrice,
      color: '#2962FF',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `Entry`,
    });
    newPriceLines.push(entryLine);

    // Stop Loss line (red, dashed)
    const slLine = candlestickSeriesRef.current.createPriceLine({
      price: stopLoss,
      color: '#FF5252',
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: `Stop Loss`,
    });
    newPriceLines.push(slLine);

    // Only show the TP level that was actually hit (cleaner)
    const hitTpPrice = targetHit === 1 ? tp1 : targetHit === 2 ? tp2 : tp3;
    const tpLine = candlestickSeriesRef.current.createPriceLine({
      price: hitTpPrice,
      color: '#00C853',
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: `TP${targetHit} Target`,
    });
    newPriceLines.push(tpLine);

    // Exit/Close line (emerald, solid - most important)
    const exitLine = candlestickSeriesRef.current.createPriceLine({
      price: exitPrice,
      color: '#10B981',
      lineWidth: 3,
      lineStyle: 0,
      axisLabelVisible: true,
      title: `Exit`,
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

      {/* Compact Legend */}
      <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-md shadow-md border border-gray-300 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-blue-600"></div>
            <span className="text-gray-600 font-medium">Entry</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-red-500 border-t border-dashed border-red-500"></div>
            <span className="text-gray-600 font-medium">SL</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-green-600 border-t border-dashed border-green-600"></div>
            <span className="text-gray-600 font-medium">TP{targetHit}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-emerald-600"></div>
            <span className="text-emerald-700 font-semibold">Exit ✓</span>
          </div>
        </div>
      </div>

      {/* Trade Result Badge */}
      <div className="absolute top-3 right-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white px-3 py-1.5 rounded-md shadow-lg font-semibold text-xs flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
        </svg>
        TP{targetHit} Hit
      </div>
    </div>
  );
}

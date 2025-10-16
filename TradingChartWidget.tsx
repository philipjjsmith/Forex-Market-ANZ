import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, CandlestickSeries, LineSeries, AreaSeries, LineData, Time, MouseEventParams, IPriceLine } from "lightweight-charts";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Position {
  entryPrice: number;
  entryTime: number;
  type: "long" | "short" | null;
  stopLoss?: number;
  takeProfit?: number;
}

interface TradingChartWidgetProps {
  candles: Candle[];
  height?: number;
  position?: Position;
  currentPL?: number;
  onEntryClick?: (price: number, time: number) => void;
}

export interface TradingChartHandle {
  clearPosition: () => void;
}

const TradingChartWidget = forwardRef<TradingChartHandle, TradingChartWidgetProps>(
  ({ candles, height = 500, position, currentPL, onEntryClick }, ref) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const profitZoneSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const lossZoneSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
    const [priceLines, setPriceLines] = useState<IPriceLine[]>([]);

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      clearPosition: () => {
        // Clear price lines
        priceLines.forEach(line => {
          if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.removePriceLine(line);
          }
        });
        setPriceLines([]);
      },
    }));

    useEffect(() => {
      if (!chartContainerRef.current) return;

      // Create chart with TradingView-style configuration
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
          mode: 1, // Normal crosshair
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

      // Add candlestick series
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });

      candlestickSeriesRef.current = candlestickSeries;

      // Add profit zone series (green shaded area) - TradingView style
      const profitZoneSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(76, 175, 80, 0.3)',
        bottomColor: 'rgba(76, 175, 80, 0.1)',
        lineColor: 'rgba(76, 175, 80, 0)',
        lineWidth: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      profitZoneSeriesRef.current = profitZoneSeries;

      // Add loss zone series (red shaded area) - TradingView style
      const lossZoneSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(244, 67, 54, 0.3)',
        bottomColor: 'rgba(244, 67, 54, 0.1)',
        lineColor: 'rgba(244, 67, 54, 0)',
        lineWidth: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      lossZoneSeriesRef.current = lossZoneSeries;

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
        }
      };
    }, [height]);

    // Update chart data when candles change
    useEffect(() => {
      if (!candlestickSeriesRef.current || candles.length === 0) return;

      // Convert candles to Lightweight Charts format
      const chartData: CandlestickData[] = candles.map((candle) => ({
        time: (new Date(candle.date).getTime() / 1000) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      candlestickSeriesRef.current.setData(chartData);

      // Fit content to visible range
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }, [candles]);

    // Handle click events for entry placement
    useEffect(() => {
      if (!chartRef.current || !onEntryClick) return;

      const handleClick = (param: MouseEventParams) => {
        if (!param.time || !param.point) return;
        if (position?.entryPrice) return; // Already have entry

        const price = param.seriesData.get(candlestickSeriesRef.current!) as CandlestickData | undefined;
        if (!price) return;

        const clickedPrice = param.point.y
          ? candlestickSeriesRef.current?.coordinateToPrice(param.point.y)
          : price.close;

        if (clickedPrice === null || clickedPrice === undefined) return;

        onEntryClick(clickedPrice, param.time as number);
      };

      chartRef.current.subscribeClick(handleClick);

      return () => {
        if (chartRef.current) {
          chartRef.current.unsubscribeClick(handleClick);
        }
      };
    }, [onEntryClick, position]);

    // Draw position lines and zones
    useEffect(() => {
      if (!candlestickSeriesRef.current || !position?.entryPrice || !position?.type) return;

      // Clear old price lines
      priceLines.forEach(line => {
        candlestickSeriesRef.current!.removePriceLine(line);
      });

      const newPriceLines: IPriceLine[] = [];

      // Entry line (blue)
      const entryLine = candlestickSeriesRef.current.createPriceLine({
        price: position.entryPrice,
        color: '#2962FF',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: `Entry: ${position.entryPrice.toFixed(5)}`,
      });
      newPriceLines.push(entryLine);

      // Stop Loss line (red)
      if (position.stopLoss) {
        const slLine = candlestickSeriesRef.current.createPriceLine({
          price: position.stopLoss,
          color: '#ef5350',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `SL: ${position.stopLoss.toFixed(5)}`,
        });
        newPriceLines.push(slLine);
      }

      // Take Profit line (green)
      if (position.takeProfit) {
        const tpLine = candlestickSeriesRef.current.createPriceLine({
          price: position.takeProfit,
          color: '#26a69a',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `TP: ${position.takeProfit.toFixed(5)}`,
        });
        newPriceLines.push(tpLine);
      }

      setPriceLines(newPriceLines);

      // Draw profit/loss zones (filled areas) - TradingView style
      if (candles.length > 0) {
        const entryIndex = candles.findIndex(c => (new Date(c.date).getTime() / 1000) >= position.entryTime);
        const relevantCandles = entryIndex >= 0 ? candles.slice(entryIndex) : candles;

        if (position.type === "long") {
          const profitTop = position.takeProfit || position.entryPrice * 1.05;
          const profitZoneData: LineData[] = [];
          relevantCandles.forEach(c => {
            const time = (new Date(c.date).getTime() / 1000) as Time;
            profitZoneData.push({ time, value: position.entryPrice });
            profitZoneData.push({ time, value: profitTop });
          });

          const lossBottom = position.stopLoss || position.entryPrice * 0.95;
          const lossZoneData: LineData[] = [];
          relevantCandles.forEach(c => {
            const time = (new Date(c.date).getTime() / 1000) as Time;
            lossZoneData.push({ time, value: lossBottom });
            lossZoneData.push({ time, value: position.entryPrice });
          });

          profitZoneSeriesRef.current?.setData(profitZoneData);
          lossZoneSeriesRef.current?.setData(lossZoneData);
        } else {
          const profitBottom = position.takeProfit || position.entryPrice * 0.95;
          const profitZoneData: LineData[] = [];
          relevantCandles.forEach(c => {
            const time = (new Date(c.date).getTime() / 1000) as Time;
            profitZoneData.push({ time, value: profitBottom });
            profitZoneData.push({ time, value: position.entryPrice });
          });

          const lossTop = position.stopLoss || position.entryPrice * 1.05;
          const lossZoneData: LineData[] = [];
          relevantCandles.forEach(c => {
            const time = (new Date(c.date).getTime() / 1000) as Time;
            lossZoneData.push({ time, value: position.entryPrice });
            lossZoneData.push({ time, value: lossTop });
          });

          profitZoneSeriesRef.current?.setData(profitZoneData);
          lossZoneSeriesRef.current?.setData(lossZoneData);
        }
      }
    }, [position, candles, priceLines]);

    return (
      <div className="relative">
        <div
          ref={chartContainerRef}
          className={`rounded-lg overflow-hidden border-2 ${
            !position?.entryPrice ? "border-blue-400 cursor-crosshair" : "border-gray-200"
          }`}
          style={{ width: "100%", height: `${height}px` }}
        />

        {currentPL !== undefined && position?.type && (
          <div className={`absolute top-4 left-4 px-4 py-2 rounded-lg font-bold text-lg shadow-lg ${
            currentPL >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          }`}>
            {currentPL >= 0 ? "+" : ""}{currentPL.toFixed(2)} USD
          </div>
        )}
      </div>
    );
  }
);

TradingChartWidget.displayName = "TradingChartWidget";

export default TradingChartWidget;

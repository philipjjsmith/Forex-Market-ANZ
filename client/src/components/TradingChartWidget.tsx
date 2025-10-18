import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, CandlestickSeries, LineSeries, AreaSeries, LineData, Time, MouseEventParams, IPriceLine } from "lightweight-charts";

interface Candle {
  date?: string;
  timestamp?: Date;
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
        topColor: 'rgba(76, 175, 80, 0.3)',      // Green profit zone
        bottomColor: 'rgba(76, 175, 80, 0.1)',
        lineColor: 'rgba(76, 175, 80, 0)',        // No visible border line
        lineWidth: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      profitZoneSeriesRef.current = profitZoneSeries;

      // Add loss zone series (red shaded area) - TradingView style
      const lossZoneSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(244, 67, 54, 0.3)',       // Red loss zone
        bottomColor: 'rgba(244, 67, 54, 0.1)',
        lineColor: 'rgba(244, 67, 54, 0)',         // No visible border line
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
      const chartData: CandlestickData[] = candles.map((candle) => {
        // Handle both date string and timestamp formats
        const dateValue = candle.date || candle.timestamp;
        if (!dateValue) {
          console.error('Candle missing date/timestamp:', candle);
          return null;
        }

        const time = (new Date(dateValue).getTime() / 1000) as Time;
        return {
          time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };
      }).filter(Boolean) as CandlestickData[];

      candlestickSeriesRef.current.setData(chartData);

      // Set a fixed visible range to show last 60 candles for consistent zoom level
      if (chartRef.current && chartData.length > 0) {
        const visibleBars = Math.min(60, chartData.length); // Show max 60 bars, or all if less
        const from = Math.max(0, chartData.length - visibleBars);
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: from,
          to: chartData.length - 1,
        });
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
        lineStyle: 0, // Solid
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
          lineStyle: 2, // Dashed
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
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `TP: ${position.takeProfit.toFixed(5)}`,
        });
        newPriceLines.push(tpLine);
      }

      setPriceLines(newPriceLines);

      // Draw profit/loss projection zones (TradingView style)
      if (candles.length > 0 && profitZoneSeriesRef.current && lossZoneSeriesRef.current) {
        // Get the last candle time as the starting point for projections
        const lastCandle = candles[candles.length - 1];
        const lastCandleTime = new Date(lastCandle.timestamp || lastCandle.date).getTime() / 1000;

        // Current price from last candle
        const currentPrice = lastCandle.close;

        // Create future time points for projection (extend into future)
        const timeInterval = 300; // 5 minutes in seconds (base interval)
        const projectionSteps = 30; // Number of future intervals to show

        if (position.type === "long") {
          // LONG: Green zone above entry (profit area), Red zone below entry (loss area)
          const profitTop = position.takeProfit || position.entryPrice * 1.002;
          const lossBottom = position.stopLoss || position.entryPrice * 0.998;

          // Profit zone: Area chart showing zone from current price to TP
          const profitZoneData: LineData[] = [];
          for (let i = 0; i <= projectionSteps; i++) {
            const time = (lastCandleTime + (i * timeInterval)) as Time;
            // Area series displays from this value down to zero, so we set it to the top of profit zone
            profitZoneData.push({ time, value: profitTop });
          }

          // Loss zone: Area chart showing zone from SL to current price
          const lossZoneData: LineData[] = [];
          for (let i = 0; i <= projectionSteps; i++) {
            const time = (lastCandleTime + (i * timeInterval)) as Time;
            lossZoneData.push({ time, value: lossBottom });
          }

          profitZoneSeriesRef.current.setData(profitZoneData);
          lossZoneSeriesRef.current.setData(lossZoneData);
        } else {
          // SHORT: Green zone below entry (profit area), Red zone above entry (loss area)
          const profitBottom = position.takeProfit || position.entryPrice * 0.998;
          const lossTop = position.stopLoss || position.entryPrice * 1.002;

          // Profit zone: from TP to entry
          const profitZoneData: LineData[] = [];
          for (let i = 0; i <= projectionSteps; i++) {
            const time = (lastCandleTime + (i * timeInterval)) as Time;
            profitZoneData.push({ time, value: profitBottom });
          }

          // Loss zone: from entry to SL
          const lossZoneData: LineData[] = [];
          for (let i = 0; i <= projectionSteps; i++) {
            const time = (lastCandleTime + (i * timeInterval)) as Time;
            lossZoneData.push({ time, value: lossTop });
          }

          profitZoneSeriesRef.current.setData(profitZoneData);
          lossZoneSeriesRef.current.setData(lossZoneData);
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

        {/* P/L Display Overlay */}
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

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
    const priceLinesRef = useRef<IPriceLine[]>([]);

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      clearPosition: () => {
        // Clear price lines
        priceLinesRef.current.forEach(line => {
          if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.removePriceLine(line);
          }
        });
        priceLinesRef.current = [];
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

      // Add profit zone series (green shaded area) - Use separate price scale to control bounds
      const profitZoneSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(34, 139, 34, 0.5)',      // Forest green - MORE visible
        bottomColor: 'rgba(34, 139, 34, 0.2)',
        lineColor: 'rgba(34, 139, 34, 0)',       // Invisible border
        lineWidth: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'profit-zone',  // Separate scale
      });

      profitZoneSeriesRef.current = profitZoneSeries;

      // Add loss zone series (red shaded area) - Use separate price scale to control bounds
      const lossZoneSeries = chart.addSeries(AreaSeries, {
        topColor: 'rgba(220, 20, 60, 0.5)',       // Crimson red - MORE visible
        bottomColor: 'rgba(220, 20, 60, 0.2)',
        lineColor: 'rgba(220, 20, 60, 0)',        // Invisible border
        lineWidth: 0,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'loss-zone',    // Separate scale
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

      // Set a fixed visible range - show last 80 candles + compact projection area
      if (chartRef.current && chartData.length > 0) {
        const visibleHistoricalBars = 80; // Show 80 candles
        const projectionBars = 12; // Plus 12 bars of projection space (slightly more than 10 for padding)
        const from = Math.max(0, chartData.length - visibleHistoricalBars);
        const to = chartData.length - 1 + projectionBars; // Extend into future for projections

        chartRef.current.timeScale().setVisibleLogicalRange({
          from: from,
          to: to,
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
      if (!candlestickSeriesRef.current || !position?.entryPrice || !position?.type) {
        // Clear any existing lines if position is removed
        priceLinesRef.current.forEach(line => {
          if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.removePriceLine(line);
          }
        });
        priceLinesRef.current = [];
        return;
      }

      // Clear old price lines
      priceLinesRef.current.forEach(line => {
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

      priceLinesRef.current = newPriceLines;

      // Draw profit/loss projection zones - using normalized scale (0-100)
      if (candles.length > 0 && profitZoneSeriesRef.current && lossZoneSeriesRef.current) {
        // Get the last candle time as the starting point for projections
        const lastCandle = candles[candles.length - 1];
        const lastCandleTime = new Date(lastCandle.timestamp || lastCandle.date).getTime() / 1000;

        // Create compact future projection - 10 bars into future
        const timeInterval = 300; // 5 minutes in seconds (base interval)
        const projectionSteps = 10; // 10 bars = 50 minutes projection

        // Use normalized 0-100 scale for zones (they have separate price scales)
        const profitZoneData: LineData[] = [];
        const lossZoneData: LineData[] = [];

        // Start at bottom (0) and go to top (100) - the separate price scales will position them correctly
        for (let i = 0; i <= projectionSteps; i++) {
          const time = (lastCandleTime + (i * timeInterval)) as Time;
          profitZoneData.push({ time, value: 100 }); // Fill from 0 to 100
          lossZoneData.push({ time, value: 100 });   // Fill from 0 to 100
        }

        profitZoneSeriesRef.current.setData(profitZoneData);
        lossZoneSeriesRef.current.setData(lossZoneData);

        // Configure the separate price scales to map 0-100 to the actual price ranges
        if (position.type === "long") {
          const profitTop = position.takeProfit || position.entryPrice * 1.002;
          const lossBottom = position.stopLoss || position.entryPrice * 0.998;

          // Map profit zone's 0-100 to Entry-TP range
          profitZoneSeriesRef.current.priceScale().applyOptions({
            scaleMargins: {
              top: 1 - ((profitTop - position.entryPrice) / (profitTop - lossBottom)),
              bottom: (position.entryPrice - lossBottom) / (profitTop - lossBottom),
            },
            autoScale: false,
          });

          // Map loss zone's 0-100 to SL-Entry range
          lossZoneSeriesRef.current.priceScale().applyOptions({
            scaleMargins: {
              top: 1 - ((position.entryPrice - lossBottom) / (profitTop - lossBottom)),
              bottom: 0,
            },
            autoScale: false,
          });
        } else {
          const profitBottom = position.takeProfit || position.entryPrice * 0.998;
          const lossTop = position.stopLoss || position.entryPrice * 1.002;

          // Map profit zone's 0-100 to TP-Entry range
          profitZoneSeriesRef.current.priceScale().applyOptions({
            scaleMargins: {
              top: 1 - ((position.entryPrice - profitBottom) / (lossTop - profitBottom)),
              bottom: 0,
            },
            autoScale: false,
          });

          // Map loss zone's 0-100 to Entry-SL range
          lossZoneSeriesRef.current.priceScale().applyOptions({
            scaleMargins: {
              top: 1,
              bottom: (position.entryPrice - profitBottom) / (lossTop - profitBottom),
            },
            autoScale: false,
          });
        }
      }
    }, [position, candles]);

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

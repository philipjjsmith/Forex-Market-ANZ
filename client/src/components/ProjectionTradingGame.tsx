import { useState, useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, RotateCcw, Trophy, XCircle } from "lucide-react";

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Projection {
  type: 'long' | 'short';
  entry: number;
  takeProfit: number;
  stopLoss: number;
}

type GamePhase = 'analysis' | 'drawing' | 'confirmed' | 'playing' | 'result';

export default function ProjectionTradingGame() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [allCandles, setAllCandles] = useState<Candle[]>([]);
  const [visibleCandleCount, setVisibleCandleCount] = useState(0);
  const [gamePhase, setGamePhase] = useState<GamePhase>('analysis');
  const [projection, setProjection] = useState<Projection | null>(null);
  const [positionType, setPositionType] = useState<'long' | 'short'>('long');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ price: number; x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ price: number; x: number; y: number } | null>(null);

  // Chart bounds for price calculation
  const [priceRange, setPriceRange] = useState<{ min: number; max: number } | null>(null);
  const [chartHeight, setChartHeight] = useState(500);

  // Result state
  const [result, setResult] = useState<'win' | 'loss' | null>(null);
  const [finalPL, setFinalPL] = useState(0);
  const [hitPrice, setHitPrice] = useState(0);

  const HISTORICAL_CANDLES = 60; // Show first 60 candles for analysis
  const FOREX_PAIR = "EUR-USD";

  // Fetch historical data
  useEffect(() => {
    fetchHistoricalData();
  }, []);

  const fetchHistoricalData = async () => {
    try {
      setLoading(true);
      setError(null);

      const apiUrl = import.meta.env.PROD
        ? `https://forex-market-anz.onrender.com/api/forex/historical/${FOREX_PAIR}`
        : `/api/forex/historical/${FOREX_PAIR}`;

      const response = await fetch(apiUrl);
      const data = await response.json();

      if (!data.success || !data.data.candles || data.data.candles.length === 0) {
        throw new Error("Failed to load market data");
      }

      const candles = data.data.candles.map((c: any) => ({
        time: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      setAllCandles(candles);
      setVisibleCandleCount(HISTORICAL_CANDLES);
      setLoading(false);
    } catch (err: any) {
      console.error("Error fetching data:", err);
      setError(err.message || "Failed to load data");
      setLoading(false);
    }
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current || allCandles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#1e293b' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#334155' },
        horzLines: { color: '#334155' },
      },
      crosshair: {
        mode: 1,
      },
      timeScale: {
        borderColor: '#475569',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#475569',
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    // Set initial data (historical candles only)
    const visibleData = allCandles.slice(0, visibleCandleCount);
    candleSeries.setData(visibleData as any);

    // Calculate price range from visible candles
    const prices = visibleData.flatMap(c => [c.high, c.low]);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    setPriceRange({ min: minPrice, max: maxPrice });
    setChartHeight(500);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [allCandles, visibleCandleCount]);

  const handleProjectionClick = () => {
    setGamePhase('drawing');
    setIsDrawing(false);
    setDrawStart(null);
    setDrawEnd(null);
  };

  // Convert Y pixel coordinate to price
  const yToPrice = (y: number): number => {
    if (!priceRange) return 0;
    const { min, max } = priceRange;
    // Y coordinate is inverted (0 = top, chartHeight = bottom)
    const ratio = 1 - (y / chartHeight);
    return min + ratio * (max - min);
  };

  // Mouse event handlers for drawing
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (gamePhase !== 'drawing') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = yToPrice(y);

    setIsDrawing(true);
    setDrawStart({ price, x, y });
    setDrawEnd({ price, x, y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || gamePhase !== 'drawing') return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const price = yToPrice(y);

    setDrawEnd({ price, x, y });
  };

  const handleMouseUp = () => {
    if (!isDrawing || gamePhase !== 'drawing') return;
    setIsDrawing(false);
    // Keep drawStart and drawEnd so user can see their projection
  };

  const calculateProjection = () => {
    if (!drawStart || !drawEnd) return null;

    const entry = drawStart.price;
    let takeProfit: number;
    let stopLoss: number;

    if (positionType === 'long') {
      // For long: TP above entry, SL below
      takeProfit = Math.max(drawStart.price, drawEnd.price);
      stopLoss = Math.min(drawStart.price, drawEnd.price);
    } else {
      // For short: TP below entry, SL above
      takeProfit = Math.min(drawStart.price, drawEnd.price);
      stopLoss = Math.max(drawStart.price, drawEnd.price);
    }

    return { type: positionType, entry, takeProfit, stopLoss };
  };

  const handleConfirmProjection = () => {
    const proj = calculateProjection();
    if (!proj) return;

    setProjection(proj);
    setGamePhase('confirmed');
  };

  const handlePlayMarket = () => {
    if (!projection) return;

    setGamePhase('playing');
    playMarketAnimation();
  };

  const playMarketAnimation = () => {
    if (!projection) return;

    let currentCandle = visibleCandleCount;
    const maxCandles = allCandles.length;

    const interval = setInterval(() => {
      if (currentCandle >= maxCandles) {
        clearInterval(interval);
        // No TP/SL hit - consider it a neutral result
        setGamePhase('result');
        setResult(null);
        return;
      }

      // Add next candle
      const candle = allCandles[currentCandle];
      setVisibleCandleCount(currentCandle + 1);

      // Check if TP or SL hit
      if (projection.type === 'long') {
        if (candle.high >= projection.takeProfit) {
          // TP hit!
          clearInterval(interval);
          const pips = ((projection.takeProfit - projection.entry) * 10000).toFixed(1);
          setFinalPL(parseFloat(pips));
          setHitPrice(projection.takeProfit);
          setResult('win');
          setGamePhase('result');
          return;
        } else if (candle.low <= projection.stopLoss) {
          // SL hit
          clearInterval(interval);
          const pips = ((projection.stopLoss - projection.entry) * 10000).toFixed(1);
          setFinalPL(parseFloat(pips));
          setHitPrice(projection.stopLoss);
          setResult('loss');
          setGamePhase('result');
          return;
        }
      } else {
        // Short position
        if (candle.low <= projection.takeProfit) {
          // TP hit!
          clearInterval(interval);
          const pips = ((projection.entry - projection.takeProfit) * 10000).toFixed(1);
          setFinalPL(parseFloat(pips));
          setHitPrice(projection.takeProfit);
          setResult('win');
          setGamePhase('result');
          return;
        } else if (candle.high >= projection.stopLoss) {
          // SL hit
          clearInterval(interval);
          const pips = ((projection.entry - projection.stopLoss) * 10000).toFixed(1);
          setFinalPL(parseFloat(pips));
          setHitPrice(projection.stopLoss);
          setResult('loss');
          setGamePhase('result');
          return;
        }
      }

      currentCandle++;
    }, 300); // New candle every 300ms
  };

  const handleReset = () => {
    setGamePhase('analysis');
    setProjection(null);
    setDrawStart(null);
    setDrawEnd(null);
    setIsDrawing(false);
    setResult(null);
    setVisibleCandleCount(HISTORICAL_CANDLES);
    fetchHistoricalData(); // Load new data
  };

  if (loading) {
    return (
      <Card className="p-8">
        <div className="flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading market data...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-8">
        <div className="text-center text-red-600">
          <p className="font-semibold">Error loading data</p>
          <p className="text-sm">{error}</p>
          <Button onClick={fetchHistoricalData} className="mt-4">
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Game Controls */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">
              {gamePhase === 'analysis' && 'Analyze the Market'}
              {gamePhase === 'drawing' && 'Draw Your Projection'}
              {gamePhase === 'confirmed' && 'Projection Set'}
              {gamePhase === 'playing' && 'Market Playing...'}
              {gamePhase === 'result' && (result === 'win' ? '🎉 Trade Won!' : result === 'loss' ? '❌ Stop Loss Hit' : 'Trade Complete')}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              {gamePhase === 'analysis' && 'Study the historical candles and decide: bullish or bearish?'}
              {gamePhase === 'drawing' && 'Click and drag on the chart to set entry, TP, and SL'}
              {gamePhase === 'confirmed' && 'Review your projection and click Play to see the outcome'}
              {gamePhase === 'playing' && 'Watching the market unfold...'}
              {gamePhase === 'result' && `P/L: ${finalPL > 0 ? '+' : ''}${finalPL} pips`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {gamePhase === 'analysis' && (
              <Button
                onClick={handleProjectionClick}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Target className="w-4 h-4 mr-2" />
                Start Projection
              </Button>
            )}

            {gamePhase === 'drawing' && (
              <>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setPositionType('long')}
                    variant={positionType === 'long' ? 'default' : 'outline'}
                    className={positionType === 'long' ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Long
                  </Button>
                  <Button
                    onClick={() => setPositionType('short')}
                    variant={positionType === 'short' ? 'default' : 'outline'}
                    className={positionType === 'short' ? 'bg-red-600 hover:bg-red-700' : ''}
                  >
                    <TrendingDown className="w-4 h-4 mr-2" />
                    Short
                  </Button>
                </div>
                {drawStart && drawEnd && (
                  <Button
                    onClick={handleConfirmProjection}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Confirm Projection
                  </Button>
                )}
              </>
            )}

            {gamePhase === 'confirmed' && (
              <Button
                onClick={handlePlayMarket}
                className="bg-green-600 hover:bg-green-700"
              >
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
                Play Market
              </Button>
            )}

            {gamePhase === 'result' && (
              <Button
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                New Challenge
              </Button>
            )}
          </div>
        </div>

        {/* Projection Details */}
        {projection && (
          <div className="mt-4 p-4 bg-slate-100 rounded-lg">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Type</p>
                <p className="font-bold text-gray-900 uppercase">{projection.type}</p>
              </div>
              <div>
                <p className="text-gray-600">Entry</p>
                <p className="font-bold text-gray-900">{projection.entry.toFixed(5)}</p>
              </div>
              <div>
                <p className="text-gray-600">Take Profit</p>
                <p className="font-bold text-green-600">{projection.takeProfit.toFixed(5)}</p>
              </div>
              <div>
                <p className="text-gray-600">Stop Loss</p>
                <p className="font-bold text-red-600">{projection.stopLoss.toFixed(5)}</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Chart */}
      <Card className="p-4">
        <div className="relative">
          <div ref={chartContainerRef} className="w-full" />

          {/* Transparent overlay for drawing */}
          {gamePhase === 'drawing' && (
            <div
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="absolute top-0 left-0 w-full h-[500px] cursor-crosshair"
              style={{ zIndex: 10 }}
            >
              {/* Projection visualization */}
              {drawStart && drawEnd && (
                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                  {/* Calculate box dimensions */}
                  {(() => {
                    const y1 = drawStart.y;
                    const y2 = drawEnd.y;
                    const minY = Math.min(y1, y2);
                    const maxY = Math.max(y1, y2);
                    const height = maxY - minY;

                    // For long: green above entry, red below
                    // For short: red above entry, green below
                    const entryY = y1;
                    const profitY = positionType === 'long' ? minY : maxY;
                    const lossY = positionType === 'long' ? maxY : minY;

                    return (
                      <>
                        {/* Profit zone (green) */}
                        <rect
                          x="0"
                          y={Math.min(entryY, profitY)}
                          width="100%"
                          height={Math.abs(profitY - entryY)}
                          fill="rgba(16, 185, 129, 0.15)"
                          stroke="rgba(16, 185, 129, 0.5)"
                          strokeWidth="2"
                        />

                        {/* Loss zone (red) */}
                        <rect
                          x="0"
                          y={Math.min(entryY, lossY)}
                          width="100%"
                          height={Math.abs(lossY - entryY)}
                          fill="rgba(239, 68, 68, 0.15)"
                          stroke="rgba(239, 68, 68, 0.5)"
                          strokeWidth="2"
                        />

                        {/* Entry line (white) */}
                        <line
                          x1="0"
                          y1={entryY}
                          x2="100%"
                          y2={entryY}
                          stroke="white"
                          strokeWidth="2"
                          strokeDasharray="5,5"
                        />

                        {/* Take Profit line (green) */}
                        <line
                          x1="0"
                          y1={profitY}
                          x2="100%"
                          y2={profitY}
                          stroke="#10b981"
                          strokeWidth="3"
                        />

                        {/* Stop Loss line (red) */}
                        <line
                          x1="0"
                          y1={lossY}
                          x2="100%"
                          y2={lossY}
                          stroke="#ef4444"
                          strokeWidth="3"
                        />

                        {/* Price labels */}
                        <text x="10" y={entryY - 5} fill="white" fontSize="12" fontWeight="bold">
                          Entry: {drawStart.price.toFixed(5)}
                        </text>
                        <text x="10" y={profitY - 5} fill="#10b981" fontSize="12" fontWeight="bold">
                          TP: {(positionType === 'long' ? Math.max(drawStart.price, drawEnd.price) : Math.min(drawStart.price, drawEnd.price)).toFixed(5)}
                        </text>
                        <text x="10" y={lossY + 15} fill="#ef4444" fontSize="12" fontWeight="bold">
                          SL: {(positionType === 'long' ? Math.min(drawStart.price, drawEnd.price) : Math.max(drawStart.price, drawEnd.price)).toFixed(5)}
                        </text>
                      </>
                    );
                  })()}
                </svg>
              )}
            </div>
          )}
        </div>

        {gamePhase === 'drawing' && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <strong>How to draw:</strong> Click and drag on the chart. Starting point = Entry, drag up/down to set TP and SL.
              {drawStart && drawEnd && (
                <span className="block mt-2 font-semibold">
                  Risk/Reward: {((Math.abs(drawEnd.price - drawStart.price) / Math.abs(drawStart.price - drawEnd.price)) || 1).toFixed(2)}:1
                </span>
              )}
            </p>
          </div>
        )}
      </Card>

      {/* Result Card */}
      {gamePhase === 'result' && result && (
        <Card className={`p-8 ${result === 'win' ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'} border-2`}>
          <div className="text-center">
            {result === 'win' ? (
              <Trophy className="w-16 h-16 text-green-600 mx-auto mb-4" />
            ) : (
              <XCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
            )}
            <h3 className={`text-3xl font-bold ${result === 'win' ? 'text-green-900' : 'text-red-900'}`}>
              {result === 'win' ? 'Take Profit Hit! 🎉' : 'Stop Loss Hit ❌'}
            </h3>
            <p className={`text-xl mt-2 ${result === 'win' ? 'text-green-700' : 'text-red-700'}`}>
              {finalPL > 0 ? '+' : ''}{finalPL} pips
            </p>
            <p className="text-sm text-gray-600 mt-4">
              Price hit: {hitPrice.toFixed(5)}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

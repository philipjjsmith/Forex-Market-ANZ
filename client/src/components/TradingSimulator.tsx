import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, PlayCircle, RotateCcw, DollarSign } from "lucide-react";
import TradingChartWidget, { TradingChartHandle, Position } from "@/components/TradingChartWidget";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

type GamePhase = "entry" | "position-setup" | "playing" | "complete";

export default function TradingSimulator() {
  const [allCandles, setAllCandles] = useState<Candle[]>([]);
  const [visibleCandles, setVisibleCandles] = useState<Candle[]>([]);
  const [gamePhase, setGamePhase] = useState<GamePhase>("entry");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPL, setCurrentPL] = useState<number>(0);

  // Position state
  const [position, setPosition] = useState<Position>({
    entryPrice: 0,
    entryTime: 0,
    type: null,
    stopLoss: undefined,
    takeProfit: undefined,
  });

  // UI state for SL/TP inputs
  const [stopLossInput, setStopLossInput] = useState<string>("");
  const [takeProfitInput, setTakeProfitInput] = useState<string>("");
  const [useStopLoss, setUseStopLoss] = useState(false);
  const [useTakeProfit, setUseTakeProfit] = useState(false);
  const [positionSize] = useState(10000); // $10,000 position size
  const [finalPL, setFinalPL] = useState<number>(0);
  const [hitStopLoss, setHitStopLoss] = useState(false);
  const [hitTakeProfit, setHitTakeProfit] = useState(false);

  const chartRef = useRef<TradingChartHandle>(null);
  const INITIAL_CANDLES = 60; // Show first 60% of data
  const FOREX_PAIR = "EUR-USD";

  // Fetch historical data on mount
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

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch historical data");
      }

      if (!data.data.candles || data.data.candles.length === 0) {
        throw new Error("No historical data available");
      }

      setAllCandles(data.data.candles);
      setVisibleCandles(data.data.candles.slice(0, INITIAL_CANDLES));
      setLoading(false);
    } catch (err: any) {
      console.error("Error fetching historical data:", err);
      setError(err.message || "Failed to load historical data");
      setLoading(false);
    }
  };

  const handleEntryClick = (price: number, time: number) => {
    if (gamePhase !== "entry") return;

    // Set entry point
    setPosition((prev) => ({
      ...prev,
      entryPrice: price,
      entryTime: time,
    }));

    // Suggest default SL/TP (2% away)
    const slDefault = (price * 0.98).toFixed(5);
    const tpDefault = (price * 1.02).toFixed(5);
    setStopLossInput(slDefault);
    setTakeProfitInput(tpDefault);

    setGamePhase("position-setup");
  };

  const handlePositionType = (type: "long" | "short") => {
    setPosition((prev) => ({ ...prev, type }));

    // Adjust SL/TP suggestions based on position type
    if (type === "long") {
      const slDefault = (position.entryPrice * 0.98).toFixed(5);
      const tpDefault = (position.entryPrice * 1.02).toFixed(5);
      setStopLossInput(slDefault);
      setTakeProfitInput(tpDefault);
    } else {
      const slDefault = (position.entryPrice * 1.02).toFixed(5);
      const tpDefault = (position.entryPrice * 0.98).toFixed(5);
      setStopLossInput(slDefault);
      setTakeProfitInput(tpDefault);
    }
  };

  const handleConfirmPosition = () => {
    if (!position.type) {
      alert("Please select Long or Short!");
      return;
    }

    // Apply SL/TP if enabled
    const updatedPosition: Position = {
      ...position,
      stopLoss: useStopLoss ? parseFloat(stopLossInput) : undefined,
      takeProfit: useTakeProfit ? parseFloat(takeProfitInput) : undefined,
    };

    setPosition(updatedPosition);
    setGamePhase("playing");
    setIsPlaying(true);
    playbackAnimation();
  };

  const calculatePL = (currentPrice: number): number => {
    if (!position.type || !position.entryPrice) return 0;

    const priceDiff = position.type === "long"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

    // Calculate P/L in USD (using position size and pip value)
    // For EUR/USD, 1 pip = 0.0001, and $10 per pip for a standard lot ($10,000)
    const pips = priceDiff * 10000;
    const pl = pips * (positionSize / 10000); // Scaled to position size

    return pl;
  };

  const playbackAnimation = () => {
    let currentIndex = INITIAL_CANDLES;
    let positionClosed = false;

    const interval = setInterval(() => {
      if (positionClosed || currentIndex >= allCandles.length) {
        clearInterval(interval);
        setIsPlaying(false);
        setGamePhase("complete");
        return;
      }

      const currentCandle = allCandles[currentIndex];
      const currentPrice = currentCandle.close;

      // Check SL/TP
      if (position.stopLoss && !positionClosed) {
        const hitSL = position.type === "long"
          ? currentCandle.low <= position.stopLoss
          : currentCandle.high >= position.stopLoss;

        if (hitSL) {
          const pl = calculatePL(position.stopLoss);
          setCurrentPL(pl);
          setFinalPL(pl);
          setHitStopLoss(true);
          positionClosed = true;
          setVisibleCandles(allCandles.slice(0, currentIndex + 1));
          clearInterval(interval);
          setIsPlaying(false);
          setGamePhase("complete");
          return;
        }
      }

      if (position.takeProfit && !positionClosed) {
        const hitTP = position.type === "long"
          ? currentCandle.high >= position.takeProfit
          : currentCandle.low <= position.takeProfit;

        if (hitTP) {
          const pl = calculatePL(position.takeProfit);
          setCurrentPL(pl);
          setFinalPL(pl);
          setHitTakeProfit(true);
          positionClosed = true;
          setVisibleCandles(allCandles.slice(0, currentIndex + 1));
          clearInterval(interval);
          setIsPlaying(false);
          setGamePhase("complete");
          return;
        }
      }

      // Update P/L
      const pl = calculatePL(currentPrice);
      setCurrentPL(pl);

      setVisibleCandles(allCandles.slice(0, currentIndex + 1));
      currentIndex++;

      // If reached end without hitting SL/TP
      if (currentIndex >= allCandles.length) {
        setFinalPL(pl);
      }
    }, 200); // Show one new candle every 200ms
  };

  const handleReset = () => {
    setVisibleCandles(allCandles.slice(0, INITIAL_CANDLES));
    setPosition({
      entryPrice: 0,
      entryTime: 0,
      type: null,
      stopLoss: undefined,
      takeProfit: undefined,
    });
    setCurrentPL(0);
    setFinalPL(0);
    setIsPlaying(false);
    setGamePhase("entry");
    setUseStopLoss(false);
    setUseTakeProfit(false);
    setHitStopLoss(false);
    setHitTakeProfit(false);
    setStopLossInput("");
    setTakeProfitInput("");
    if (chartRef.current) {
      chartRef.current.clearPosition();
    }
  };

  if (loading) {
    return (
      <Card className="max-w-5xl mx-auto mt-8">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading historical data...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="max-w-5xl mx-auto mt-8 border-red-200">
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-red-600 font-semibold mb-2">Error Loading Data</p>
              <p className="text-gray-600 mb-4">{error}</p>
              <Button onClick={fetchHistoricalData}>Try Again</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-5xl mx-auto mt-8">
      <CardHeader>
        <CardTitle className="text-2xl">Market Projection Challenge: {FOREX_PAIR.replace("-", "/")}</CardTitle>
        <CardDescription>
          {gamePhase === "entry" && "Click on the chart to place your entry point"}
          {gamePhase === "position-setup" && "Choose Long or Short, set optional Stop Loss and Take Profit"}
          {gamePhase === "playing" && "Watch your position play out..."}
          {gamePhase === "complete" && "Challenge complete! See your results below"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chart */}
        <TradingChartWidget
          ref={chartRef}
          candles={visibleCandles}
          height={500}
          position={position}
          currentPL={gamePhase === "playing" || gamePhase === "complete" ? currentPL : undefined}
          onEntryClick={handleEntryClick}
        />

        {/* Entry Phase Instructions */}
        {gamePhase === "entry" && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">📈 How to Play:</h3>
            <ol className="text-sm text-blue-800 space-y-1">
              <li>1. <strong>Click on the chart</strong> where you want to enter a position</li>
              <li>2. <strong>Choose</strong> Long (bullish) or Short (bearish)</li>
              <li>3. <strong>Optionally set</strong> Stop Loss and Take Profit levels</li>
              <li>4. <strong>Watch</strong> the market play out and track your P/L in real-time!</li>
            </ol>
          </div>
        )}

        {/* Position Setup Phase */}
        {gamePhase === "position-setup" && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-900 text-center">
                ✓ Entry placed at {position.entryPrice.toFixed(5)}! Now configure your position:
              </p>
            </div>

            {/* Long/Short Buttons */}
            <div className="text-center">
              <p className="font-semibold text-gray-700 mb-3">Select Position Type:</p>
              <div className="flex gap-4 justify-center">
                <Button
                  size="lg"
                  variant={position.type === "long" ? "default" : "outline"}
                  className={`${
                    position.type === "long"
                      ? "bg-green-600 hover:bg-green-700"
                      : "border-green-600 text-green-600 hover:bg-green-50"
                  }`}
                  onClick={() => handlePositionType("long")}
                >
                  <TrendingUp className="w-5 h-5 mr-2" />
                  Long (Buy)
                </Button>
                <Button
                  size="lg"
                  variant={position.type === "short" ? "default" : "outline"}
                  className={`${
                    position.type === "short"
                      ? "bg-red-600 hover:bg-red-700"
                      : "border-red-600 text-red-600 hover:bg-red-50"
                  }`}
                  onClick={() => handlePositionType("short")}
                >
                  <TrendingDown className="w-5 h-5 mr-2" />
                  Short (Sell)
                </Button>
              </div>
            </div>

            {/* Optional SL/TP */}
            {position.type && (
              <div className="grid md:grid-cols-2 gap-4">
                {/* Stop Loss */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="font-semibold">Stop Loss (Optional)</Label>
                    <input
                      type="checkbox"
                      checked={useStopLoss}
                      onChange={(e) => setUseStopLoss(e.target.checked)}
                      className="w-5 h-5"
                    />
                  </div>
                  {useStopLoss && (
                    <div>
                      <Input
                        type="number"
                        step="0.00001"
                        value={stopLossInput}
                        onChange={(e) => setStopLossInput(e.target.value)}
                        placeholder="Enter stop loss price"
                        className="mb-2"
                      />
                      <p className="text-xs text-gray-500">
                        Suggested: {position.type === "long" ? "Below" : "Above"} entry price
                      </p>
                    </div>
                  )}
                </div>

                {/* Take Profit */}
                <div className="bg-white border-2 border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Label className="font-semibold">Take Profit (Optional)</Label>
                    <input
                      type="checkbox"
                      checked={useTakeProfit}
                      onChange={(e) => setUseTakeProfit(e.target.checked)}
                      className="w-5 h-5"
                    />
                  </div>
                  {useTakeProfit && (
                    <div>
                      <Input
                        type="number"
                        step="0.00001"
                        value={takeProfitInput}
                        onChange={(e) => setTakeProfitInput(e.target.value)}
                        placeholder="Enter take profit price"
                        className="mb-2"
                      />
                      <p className="text-xs text-gray-500">
                        Suggested: {position.type === "long" ? "Above" : "Below"} entry price
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Confirm Button */}
            {position.type && (
              <div className="text-center">
                <Button
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleConfirmPosition}
                >
                  <PlayCircle className="w-5 h-5 mr-2" />
                  Confirm & Play Market
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Playing State */}
        {gamePhase === "playing" && isPlaying && (
          <div className="text-center">
            <p className="text-blue-600 font-semibold animate-pulse">
              Playing market movements... Watch your P/L!
            </p>
          </div>
        )}

        {/* Results */}
        {gamePhase === "complete" && (
          <div className="space-y-4">
            <div className={`border-2 rounded-lg p-6 text-center ${
              finalPL >= 0 ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"
            }`}>
              <h3 className="text-xl font-bold mb-2">
                {finalPL >= 0 ? "🎉 Profitable Trade!" : "📉 Loss Trade"}
              </h3>

              <div className={`text-4xl font-bold mb-4 ${
                finalPL >= 0 ? "text-green-700" : "text-red-700"
              }`}>
                {finalPL >= 0 ? "+" : ""}{finalPL.toFixed(2)} USD
              </div>

              <div className="space-y-2 text-sm text-gray-700">
                <p>Position Type: <strong>{position.type === "long" ? "Long (Buy)" : "Short (Sell)"}</strong></p>
                <p>Entry Price: <strong>{position.entryPrice.toFixed(5)}</strong></p>
                <p>Final Price: <strong>{visibleCandles[visibleCandles.length - 1].close.toFixed(5)}</strong></p>

                {hitStopLoss && (
                  <p className="text-red-600 font-semibold">❌ Stop Loss Hit at {position.stopLoss?.toFixed(5)}</p>
                )}
                {hitTakeProfit && (
                  <p className="text-green-600 font-semibold">✅ Take Profit Hit at {position.takeProfit?.toFixed(5)}</p>
                )}
                {!hitStopLoss && !hitTakeProfit && (
                  <p className="text-blue-600">📊 Position closed at market end</p>
                )}

                <p className="mt-4">
                  Market moved from {allCandles[INITIAL_CANDLES - 1].close.toFixed(5)} to{" "}
                  {visibleCandles[visibleCandles.length - 1].close.toFixed(5)}
                </p>
              </div>

              <Button onClick={handleReset} size="lg" className="mt-6">
                <RotateCcw className="w-5 h-5 mr-2" />
                Try Another Challenge
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

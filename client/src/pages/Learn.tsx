import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GraduationCap, TrendingUp, TrendingDown, PlayCircle, ArrowLeft } from "lucide-react";
import ProjectionTradingGame from "@/components/ProjectionTradingGame";

export default function Learn() {
  const [showSimulator, setShowSimulator] = useState(false);
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Back Button */}
        <button
          onClick={() => setLocation('/')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back to Dashboard</span>
        </button>

        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/15 mb-4">
            <GraduationCap className="w-8 h-8 text-primary" />
          </div>
          <h1 className="type-display text-foreground">Learn Forex Trading</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Master the art of identifying market trends through interactive challenges
          </p>
        </div>

        {/* Educational Cards */}
        <div className="grid md:grid-cols-2 gap-6 mt-8">
          {/* Bullish Trends */}
          <Card className="border-2 border-market-green/30 hover:border-market-green/60 transition-colors">
            <CardHeader>
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-market-green" />
                <CardTitle className="text-2xl">Bullish Trends</CardTitle>
              </div>
              <CardDescription>Learn to identify upward market movements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground">
                A <strong>bullish trend</strong> occurs when prices are consistently rising,
                forming higher highs and higher lows.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-market-green font-bold">✓</span>
                  <span>Higher highs: Each peak is higher than the previous</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-market-green font-bold">✓</span>
                  <span>Higher lows: Each valley is higher than the previous</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-market-green font-bold">✓</span>
                  <span>Upward trendline: Connect the lows with an ascending line</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Bearish Trends */}
          <Card className="border-2 border-market-red/30 hover:border-market-red/60 transition-colors">
            <CardHeader>
              <div className="flex items-center gap-3">
                <TrendingDown className="w-8 h-8 text-market-red" />
                <CardTitle className="text-2xl">Bearish Trends</CardTitle>
              </div>
              <CardDescription>Learn to identify downward market movements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-foreground">
                A <strong>bearish trend</strong> occurs when prices are consistently falling,
                forming lower highs and lower lows.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-market-red font-bold">✓</span>
                  <span>Lower highs: Each peak is lower than the previous</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-market-red font-bold">✓</span>
                  <span>Lower lows: Each valley is lower than the previous</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-market-red font-bold">✓</span>
                  <span>Downward trendline: Connect the highs with a descending line</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* Practice Section */}
        <Card className="mt-8 border-2 border-primary/40">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Ready to Practice?</CardTitle>
            <CardDescription className="text-base">
              Test your skills with our interactive trading simulator
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <p className="text-center text-muted-foreground max-w-2xl">
              We'll show you a real historical chart. You'll identify the trend,
              make your prediction, and watch the market play out to see if you were right!
            </p>
            <Button size="lg" className="mt-4" onClick={() => setShowSimulator(true)}>
              <PlayCircle className="w-5 h-5 mr-2" />
              Start Challenge
            </Button>
          </CardContent>
        </Card>

        {/* Trading Simulator */}
        {showSimulator && <ProjectionTradingGame />}
      </div>
    </div>
  );
}

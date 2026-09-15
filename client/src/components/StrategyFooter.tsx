import { Target } from 'lucide-react';

export function StrategyFooter() {
  return (
    <footer className="mt-12 border-t border-border bg-card py-8">
      <div className="container mx-auto px-4">
        <div className="text-center space-y-3">
          {/* Strategy Badge */}
          <div className="flex items-center justify-center gap-2 mb-2">
            <Target className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-medium text-muted-foreground">
              Trading Strategy & Analysis
            </h3>
          </div>

          {/* Developer Credit */}
          <p className="text-xl font-semibold text-indigo-400">
            Developed by Philip Smith
          </p>

          {/* Methodology */}
          <p className="text-sm text-subtle-foreground">
            Based on ICT (Inner Circle Trader) 3-Timeframe Methodology
          </p>

          {/* Version & Copyright */}
          <div className="pt-2 border-t border-card-border mt-4">
            <p className="text-xs text-subtle-foreground">
              Version 3.1.0 • © 2025 All Rights Reserved
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

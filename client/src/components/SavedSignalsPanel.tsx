import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SignalCard from "./SignalCard";
import { useState, useEffect } from "react";

interface SavedSignal {
  id: string;
  type: 'LONG' | 'SHORT';
  symbol: string;
  entry: number;
  stop: number;
  stopLimitPrice?: number;
  targets: number[];
  confidence: number;
  rationale: string;
  timestamp: string;
  orderType: string;
}

export default function SavedSignalsPanel() {
  const [savedSignals, setSavedSignals] = useState<SavedSignal[]>([]);

  useEffect(() => {
    loadSavedSignals();
    
    // Listen for storage changes
    const handleStorageChange = () => {
      loadSavedSignals();
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const loadSavedSignals = () => {
    const saved = JSON.parse(localStorage.getItem('savedSignals') || '[]');
    setSavedSignals(saved);
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all saved signals?')) {
      localStorage.setItem('savedSignals', '[]');
      setSavedSignals([]);
      console.log('All saved signals cleared');
    }
  };

  const handleSignalSaveToggle = () => {
    // Reload saved signals when a signal is unsaved
    loadSavedSignals();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Saved Signals</h2>
        {savedSignals.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearAll}
            data-testid="button-clear-saved"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        )}
      </div>

      {savedSignals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Star className="w-16 h-16 text-muted-foreground opacity-50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Saved Signals</h3>
            <p className="text-sm text-muted-foreground text-center">
              Click the star icon on any signal to save it for later reference
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {savedSignals.map((signal) => (
            <SignalCard
              key={signal.id}
              {...signal}
              onSaveToggle={handleSignalSaveToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

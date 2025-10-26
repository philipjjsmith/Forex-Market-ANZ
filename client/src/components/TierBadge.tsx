import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TierBadgeProps {
  tier: 'HIGH' | 'MEDIUM';
  confidence: number;
  tradeLive?: boolean;
  positionSizePercent?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  showTooltip?: boolean;
}

/**
 * TierBadge Component
 *
 * Displays signal quality using a "Signal Bars" visual system (like cell phone signal strength).
 * - HIGH tier (85-120 pts): 5 bars, Blue to Cyan gradient, Live trading enabled
 * - MEDIUM tier (70-84 pts): 3 bars, Slate Gray, Paper trading only
 *
 * Accessibility: Icon-based system (not color-dependent), colorblind-friendly
 */
export function TierBadge({
  tier,
  confidence,
  tradeLive = false,
  positionSizePercent = 0,
  size = 'md',
  showLabel = true,
  showTooltip = true,
}: TierBadgeProps) {

  // Configuration based on tier
  const config = tier === 'HIGH' ? {
    bars: 5,
    label: 'HIGH QUALITY',
    bgColor: 'bg-gradient-to-r from-blue-500 to-cyan-500',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-500',
    barColors: [
      'bg-blue-400',
      'bg-blue-500',
      'bg-blue-600',
      'bg-cyan-500',
      'bg-cyan-600',
    ],
    icon: '🔵',
    description: 'Premium signal with 85-120 points',
    tradingStatus: 'Live Trading Enabled',
    riskLevel: '1% Account Risk',
  } : {
    bars: 3,
    label: 'MEDIUM QUALITY',
    bgColor: 'bg-gradient-to-r from-slate-400 to-slate-500',
    textColor: 'text-slate-600',
    borderColor: 'border-slate-500',
    barColors: [
      'bg-slate-400',
      'bg-slate-500',
      'bg-slate-600',
    ],
    icon: '⚪',
    description: 'Standard signal with 70-84 points',
    tradingStatus: 'Paper Trading Only',
    riskLevel: '0% Account Risk (Practice)',
  };

  // Size configurations
  const sizeConfig = {
    sm: {
      barWidth: 'w-1',
      barGap: 'gap-0.5',
      barHeights: tier === 'HIGH'
        ? ['h-2', 'h-3', 'h-4', 'h-5', 'h-6']
        : ['h-3', 'h-4', 'h-5'],
      fontSize: 'text-xs',
      padding: 'px-2 py-1',
      iconSize: 12,
    },
    md: {
      barWidth: 'w-1.5',
      barGap: 'gap-1',
      barHeights: tier === 'HIGH'
        ? ['h-3', 'h-4', 'h-5', 'h-6', 'h-7']
        : ['h-4', 'h-5', 'h-6'],
      fontSize: 'text-sm',
      padding: 'px-3 py-1.5',
      iconSize: 16,
    },
    lg: {
      barWidth: 'w-2',
      barGap: 'gap-1.5',
      barHeights: tier === 'HIGH'
        ? ['h-4', 'h-5', 'h-6', 'h-7', 'h-8']
        : ['h-5', 'h-6', 'h-7'],
      fontSize: 'text-base',
      padding: 'px-4 py-2',
      iconSize: 20,
    },
  };

  const sizing = sizeConfig[size];

  // Tooltip content
  const tooltipContent = (
    <div className="space-y-2 max-w-xs">
      <div className="font-semibold flex items-center gap-2">
        <span className="text-lg">{config.icon}</span>
        <span>{config.label}</span>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-300">Confidence Score:</span>
          <span className="font-mono font-semibold">{confidence} points</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-300">Quality Range:</span>
          <span className="font-mono">{config.description}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-300">Trading Mode:</span>
          <span className={tier === 'HIGH' ? 'text-green-400' : 'text-yellow-400'}>
            {config.tradingStatus}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-300">Risk Per Trade:</span>
          <span className="font-mono font-semibold">
            {positionSizePercent}% {tier === 'MEDIUM' && '(Paper)'}
          </span>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-600 text-xs text-slate-300">
        {tier === 'HIGH' ? (
          <p>
            <strong>HIGH signals</strong> meet strict criteria (85+ points) and are approved for
            live trading with 1% account risk per trade.
          </p>
        ) : (
          <p>
            <strong>MEDIUM signals</strong> show promise (70-84 points) but should only be
            paper traded until they prove consistency.
          </p>
        )}
      </div>
    </div>
  );

  // Badge component
  const badge = (
    <div className={`
      inline-flex items-center gap-2 rounded-full border-2
      ${config.borderColor} ${sizing.padding}
      bg-white dark:bg-slate-900
      transition-all hover:shadow-lg
    `}>
      {/* Signal Bars */}
      <div className={`flex items-end ${sizing.barGap}`}>
        {Array.from({ length: config.bars }).map((_, i) => (
          <div
            key={i}
            className={`
              ${sizing.barWidth}
              ${sizing.barHeights[i]}
              ${config.barColors[i]}
              rounded-t-sm
              transition-all duration-300
              hover:scale-110
            `}
          />
        ))}
      </div>

      {/* Label */}
      {showLabel && (
        <span className={`
          ${sizing.fontSize}
          ${config.textColor}
          font-semibold
          tracking-wide
        `}>
          {config.label}
        </span>
      )}

      {/* Info Icon (only visible when tooltip enabled) */}
      {showTooltip && (
        <Info className={`${config.textColor} opacity-60`} size={sizing.iconSize} />
      )}
    </div>
  );

  // Return with or without tooltip
  if (showTooltip) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            {badge}
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="bg-slate-800 border-slate-700 text-white p-4"
          >
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

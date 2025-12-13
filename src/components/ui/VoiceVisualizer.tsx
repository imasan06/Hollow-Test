import { cn } from '@/lib/utils';
import { VoiceState } from '@/ble/bleManager';

interface VoiceVisualizerProps {
  state: VoiceState;
  duration?: number;
  className?: string;
}

export function VoiceVisualizer({ state, duration = 0, className }: VoiceVisualizerProps) {
  const isActive = state === 'listening';
  const isProcessing = state === 'processing';

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {/* Main visualization circle */}
      <div className="relative">
        {/* Outer glow ring */}
        <div
          className={cn(
            'absolute inset-0 rounded-full transition-all duration-500',
            isActive && 'glow-primary animate-pulse-glow',
            isProcessing && 'glow-primary animate-spin-slow'
          )}
          style={{
            width: isActive ? 180 : 160,
            height: isActive ? 180 : 160,
            left: isActive ? -10 : 0,
            top: isActive ? -10 : 0,
          }}
        />

        {/* Main circle */}
        <div
          className={cn(
            'relative flex h-40 w-40 items-center justify-center rounded-full border-2 transition-all duration-300',
            state === 'idle' && 'border-muted bg-muted/50',
            isActive && 'border-primary bg-primary/10',
            isProcessing && 'border-primary bg-primary/5',
            state === 'responding' && 'border-success bg-success/10'
          )}
        >
          {/* Inner content */}
          <div className="flex flex-col items-center gap-2">
            {state === 'idle' && (
              <span className="text-muted-foreground text-sm font-medium">
                Ready
              </span>
            )}

            {isActive && (
              <>
                {/* Audio wave bars */}
                <div className="flex items-end gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-primary animate-wave"
                      style={{
                        height: `${16 + Math.random() * 24}px`,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-primary text-sm font-medium text-glow">
                  Listening...
                </span>
              </>
            )}

            {isProcessing && (
              <>
                <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <span className="text-primary text-sm font-medium">
                  Processing...
                </span>
              </>
            )}

            {state === 'responding' && (
              <span className="text-success text-sm font-medium text-glow">
                Responding
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Duration display */}
      {(isActive || isProcessing) && duration > 0 && (
        <div className="font-mono text-2xl text-primary tabular-nums">
          {duration.toFixed(1)}s
        </div>
      )}
    </div>
  );
}

import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: 'disconnected' | 'scanning' | 'connecting' | 'connected';
  className?: string;
}

const statusConfig = {
  disconnected: {
    color: 'bg-muted-foreground',
    label: 'Disconnected',
    pulse: false,
  },
  scanning: {
    color: 'bg-warning',
    label: 'Scanning...',
    pulse: true,
  },
  connecting: {
    color: 'bg-warning',
    label: 'Connecting...',
    pulse: true,
  },
  connected: {
    color: 'bg-success',
    label: 'Connected',
    pulse: false,
  },
};

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative">
        <div
          className={cn(
            'h-2.5 w-2.5 rounded-full',
            config.color,
            config.pulse && 'animate-pulse-glow'
          )}
        />
        {config.pulse && (
          <div
            className={cn(
              'absolute inset-0 h-2.5 w-2.5 rounded-full opacity-50',
              config.color,
              'animate-ping'
            )}
          />
        )}
      </div>
      <span className="text-sm font-medium text-muted-foreground">
        {config.label}
      </span>
    </div>
  );
}

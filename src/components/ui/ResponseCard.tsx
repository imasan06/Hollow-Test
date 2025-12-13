import { cn } from '@/lib/utils';
import { MessageSquare, AlertCircle } from 'lucide-react';

interface ResponseCardProps {
  response: string | null;
  error: string | null;
  className?: string;
}

export function ResponseCard({ response, error, className }: ResponseCardProps) {
  if (!response && !error) return null;

  return (
    <div
      className={cn(
        'w-full max-w-md rounded-lg border p-4 animate-fade-in',
        error ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-card',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 rounded-full p-1.5',
            error ? 'bg-destructive/20' : 'bg-primary/20'
          )}
        >
          {error ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <MessageSquare className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm leading-relaxed',
            error ? 'text-destructive' : 'text-foreground'
          )}>
            {error || response}
          </p>
        </div>
      </div>
    </div>
  );
}

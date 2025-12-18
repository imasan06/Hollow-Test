import { cn } from '@/lib/utils';
import { MessageSquare, User } from 'lucide-react';
import { ConversationMessage } from '@/storage/conversationStore';

interface ConversationHistoryProps {
  messages: ConversationMessage[];
  className?: string;
}

export function ConversationHistory({ messages, className }: ConversationHistoryProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className={cn('w-full max-w-md space-y-4', className)}>
      {messages.map((message, index) => (
        <div
          key={`${message.timestamp}-${index}`}
          className={cn(
            'w-full rounded-lg border p-4',
            message.role === 'user'
              ? 'border-border bg-muted/30'
              : 'border-border bg-card'
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 rounded-full p-1.5',
                message.role === 'user'
                  ? 'bg-muted'
                  : 'bg-primary/20'
              )}
            >
              {message.role === 'user' ? (
                <User className="h-4 w-4 text-muted-foreground" />
              ) : (
                <MessageSquare className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </p>
                <span className="text-xs text-muted-foreground">•</span>
                <p className="text-xs text-muted-foreground">
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <p className={cn(
                'text-sm leading-relaxed',
                message.role === 'user'
                  ? 'text-foreground italic'
                  : 'text-foreground'
              )}>
                {message.role === 'user' ? `"${message.text}"` : message.text}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

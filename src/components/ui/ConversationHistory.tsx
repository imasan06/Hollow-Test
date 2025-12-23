import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { MessageSquare, User, Trash2 } from 'lucide-react';
import { ConversationMessage } from '@/storage/conversationStore';
import { logger } from '@/utils/logger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConversationHistoryProps {
  messages: ConversationMessage[];
  className?: string;
  onMessageDeleted?: () => void;
}

export function ConversationHistory({ messages, className, onMessageDeleted }: ConversationHistoryProps) {
  const [selectedMessage, setSelectedMessage] = useState<ConversationMessage | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Note: Auto-scroll is handled by parent component (WatchApp) to avoid conflicts

  if (messages.length === 0) {
    return (
      <div className="w-full text-center py-8 px-4">
        <p className="text-sm text-muted-foreground italic">Empty chat history</p>
      </div>
    );
  }

  const handleLongPress = (message: ConversationMessage) => {
    setSelectedMessage(message);
    setIsDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedMessage) return;

    try {
      const { deleteMessage } = await import('@/storage/conversationStore');
      const success = await deleteMessage(selectedMessage.timestamp);
      
      if (success) {
        setIsDeleteDialogOpen(false);
        setSelectedMessage(null);
        // Small delay to ensure storage operation completes before notifying parent
        await new Promise(resolve => setTimeout(resolve, 100));
        onMessageDeleted?.();
      }
    } catch (error) {
      logger.error('Error deleting message', 'ConversationHistory', error instanceof Error ? error : new Error(String(error)));
    }
  };

  return (
    <>
      <div ref={containerRef} className={cn('w-full max-w-md space-y-4', className)}>
        {messages.map((message, index) => (
          <div
            key={`${message.timestamp}-${index}`}
            className={cn(
              'w-full rounded-lg border p-4 transition-colors',
              message.role === 'user'
                ? 'border-border bg-muted/30'
                : 'border-border bg-card',
              'active:bg-muted/50 cursor-pointer select-none'
            )}
            onContextMenu={(e) => {
              e.preventDefault();
              handleLongPress(message);
            }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              const target = e.currentTarget;
              const longPressTimer = setTimeout(() => {
                handleLongPress(message);
                // Vibrate if available
                if (navigator.vibrate) {
                  navigator.vibrate(50);
                }
              }, 500); // 500ms for long press

              const handleTouchEnd = () => {
                clearTimeout(longPressTimer);
                target.removeEventListener('touchend', handleTouchEnd);
                target.removeEventListener('touchmove', handleTouchEnd);
              };

              target.addEventListener('touchend', handleTouchEnd);
              target.addEventListener('touchmove', handleTouchEnd);
            }}
            onMouseDown={(e) => {
              if (e.button === 0) { // Left mouse button
                const target = e.currentTarget;
                const longPressTimer = setTimeout(() => {
                  handleLongPress(message);
                }, 500);

                const handleMouseUp = () => {
                  clearTimeout(longPressTimer);
                  target.removeEventListener('mouseup', handleMouseUp);
                  target.removeEventListener('mouseleave', handleMouseUp);
                };

                target.addEventListener('mouseup', handleMouseUp);
                target.addEventListener('mouseleave', handleMouseUp);
              }
            }}
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
                <p 
                  className={cn(
                    'text-sm leading-relaxed whitespace-pre-wrap break-words',
                  message.role === 'user'
                    ? 'text-foreground italic'
                    : 'text-foreground'
                  )}
                  style={{ 
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    // Ensure text is always rendered and not virtualized
                    contain: 'layout style paint'
                  }}
                >
                  {message.role === 'user' ? `"${message.text}"` : message.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this message? This action cannot be undone.
              {selectedMessage && (
                <div className="mt-2 p-2 bg-muted rounded text-xs">
                  {selectedMessage.role === 'user' ? (
                    <span className="italic">"{selectedMessage.text}"</span>
                  ) : (
                    <span>{selectedMessage.text}</span>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

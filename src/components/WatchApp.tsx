import { useEffect, useState, useRef } from 'react';
import { useBle } from '@/hooks/useBle';
import { Button } from '@/components/ui/button';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { VoiceVisualizer } from '@/components/ui/VoiceVisualizer';
import { ResponseCard } from '@/components/ui/ResponseCard';
import { ConversationHistory } from '@/components/ui/ConversationHistory';
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
import { Bluetooth, BluetoothOff, Watch, Wifi, Settings, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { APP_CONFIG } from '@/config/app.config';
import { getConversationHistory, ConversationMessage } from '@/storage/conversationStore';
import { logger } from '@/utils/logger';

export function WatchApp() {
  const navigate = useNavigate();
  const {
    connectionState,
    voiceState,
    lastResponse,
    lastTranscription,
    lastError,
    audioDuration,
    isProcessing,
    scan,
    disconnect,
    deviceName,
  } = useBle();
  
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isClearAllDialogOpen, setIsClearAllDialogOpen] = useState(false);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning' || connectionState === 'connecting';

  // Load conversation history (excluding current session messages)
  const loadHistory = async () => {
    try {
      const history = await getConversationHistory();
      // Filter out current session messages to avoid duplicates
      const filtered = history.filter((msg) => {
        // Exclude if it matches current transcription or response
        if (lastTranscription && msg.role === 'user' && msg.text === lastTranscription) {
          return false;
        }
        if (lastResponse && msg.role === 'assistant' && msg.text === lastResponse) {
          return false;
        }
        return true;
      });
      // Sort by timestamp (oldest first for display)
      const sorted = filtered.sort((a, b) => a.timestamp - b.timestamp);
      setConversationHistory(sorted);
    } catch (error) {
      logger.error('Failed to load conversation history', 'WatchApp', error instanceof Error ? error : new Error(String(error)));
    }
  };

  useEffect(() => {
    // Load on mount
    loadHistory();
    
    // Reload when new messages are added (check every 2 seconds)
    const interval = setInterval(() => {
      loadHistory();
    }, 2000);

    return () => clearInterval(interval);
  }, [lastResponse, lastTranscription]);

  // Auto-scroll to bottom when history changes
  useEffect(() => {
    if (historyScrollRef.current && conversationHistory.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        if (historyScrollRef.current) {
          historyScrollRef.current.scrollTop = historyScrollRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [conversationHistory]);

  // Handle message deletion
  const handleMessageDeleted = () => {
    loadHistory();
  };

  // Handle clear all history
  const handleClearAllHistory = async () => {
    try {
      const { clearConversationHistory } = await import('@/storage/conversationStore');
      await clearConversationHistory();
      setIsClearAllDialogOpen(false);
      loadHistory();
    } catch (error) {
      logger.error('Error clearing history', 'WatchApp', error instanceof Error ? error : new Error(String(error)));
    }
  };


  return (
    <div className="flex h-screen flex-col bg-background safe-area-top overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm safe-area-top">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Watch className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Hollow 0W</h1>
              {deviceName && (
                <p className="text-xs text-muted-foreground">{deviceName}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusIndicator status={connectionState} />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-1 flex flex-col items-center gap-4 p-6 min-h-0 w-full overflow-hidden ${conversationHistory.length === 0 ? 'justify-center' : ''}`}>
        {/* Current Session - Centered, No Scroll */}
        <div className={`flex flex-col items-center gap-6 w-full ${conversationHistory.length === 0 ? 'justify-center' : 'flex-shrink-0'}`}>
          {/* Voice Visualizer */}
          <VoiceVisualizer
            state={voiceState}
            duration={audioDuration}
          />

          {/* Transcription & Response Display */}
          {lastTranscription && (
            <div className="w-full max-w-md px-4">
              <p className="text-xs text-muted-foreground mb-1">You said:</p>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3 italic">
                "{lastTranscription}"
              </p>
            </div>
          )}
          <ResponseCard
            response={lastResponse}
            error={lastError}
          />

          {/* Connection Controls */}
          <div className="flex flex-col items-center gap-4">
          {!isConnected ? (
            <Button
              size="lg"
              onClick={scan}
              disabled={isScanning}
              className="min-w-[200px] gap-2"
            >
              {isScanning ? (
                <>
                  <Wifi className="h-5 w-5 animate-pulse" />
                  Scanning...
                </>
              ) : (
                <>
                  <Bluetooth className="h-5 w-5" />
                  Connect Watch
                </>
              )}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="secondary"
              onClick={disconnect}
              className="min-w-[200px] gap-2"
            >
              <BluetoothOff className="h-5 w-5" />
              Disconnect
            </Button>
          )}

          {/* Status Message */}
          <p className="text-center text-sm text-muted-foreground max-w-xs">
            {connectionState === 'disconnected' && (
              'Tap to scan for your Hollow watch'
            )}
            {connectionState === 'scanning' && (
              'Looking for Hollow 1W...'
            )}
            {connectionState === 'connecting' && (
              'Establishing secure connection...'
            )}
            {connectionState === 'connected' && voiceState === 'idle' && (
              'Connected. Speak into your watch to begin.'
            )}
            {voiceState === 'listening' && (
              'Receiving audio from watch...'
            )}
            {voiceState === 'processing' && (
              'Processing your voice command...'
            )}
            {voiceState === 'responding' && (
              'Sending response to watch...'
            )}
          </p>

          </div>
        </div>

        {/* Conversation History - Scrollable Container */}
        {conversationHistory.length > 0 && (
          <div className="w-full max-w-md flex-1 flex flex-col min-h-0 border-t border-border pt-4">
            <div className="mb-3 px-4 flex-shrink-0 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Conversation History</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {conversationHistory.length} message{conversationHistory.length !== 1 ? 's' : ''}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsClearAllDialogOpen(true)}
                className="text-destructive border-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0 whitespace-nowrap"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear All
              </Button>
            </div>
            <div 
              ref={historyScrollRef}
              className="flex-1 overflow-y-auto px-4 min-h-0"
            >
              <ConversationHistory 
                messages={conversationHistory} 
                onMessageDeleted={handleMessageDeleted}
              />
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 py-4">
        <div className="container flex items-center justify-center gap-2 px-4">
          <span className="text-xs text-muted-foreground">
            Hollow 0W Companion App
          </span>
          <span className="text-xs text-muted-foreground">•</span>
          <span className="text-xs text-primary font-mono">v1.0.0</span>
        </div>
      </footer>

      {/* Clear All History Dialog */}
      <AlertDialog open={isClearAllDialogOpen} onOpenChange={setIsClearAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All History?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all conversation history? This will permanently remove all {conversationHistory.length} message{conversationHistory.length !== 1 ? 's' : ''} and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAllHistory}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

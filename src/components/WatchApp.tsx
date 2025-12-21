import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { useBle } from '@/hooks/useBle';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Button } from '@/components/ui/button';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { VoiceVisualizer } from '@/components/ui/VoiceVisualizer';
import { ResponseCard } from '@/components/ui/ResponseCard';
import { Mic, Square } from 'lucide-react';
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


const ConversationHistory = lazy(() => import('@/components/ui/ConversationHistory').then(m => ({ default: m.ConversationHistory })));

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
  
  
  const {
    isRecording: isRecordingAudio,
    duration: recordingDuration,
    isProcessing: isProcessingAudio,
    lastTranscription: recordingTranscription,
    lastResponse: recordingResponse,
    error: recordingError,
    startRecording,
    stopRecording,
    processRecordedAudio,
  } = useAudioRecorder();
  
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [isClearAllDialogOpen, setIsClearAllDialogOpen] = useState(false);
  const wasRecordingRef = useRef(false);
  
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning' || connectionState === 'connecting';
  

  useEffect(() => {
    if (wasRecordingRef.current && !isRecordingAudio && !isProcessingAudio) {
     
      processRecordedAudio();
    }
    wasRecordingRef.current = isRecordingAudio;
  }, [isRecordingAudio, isProcessingAudio, processRecordedAudio]);

 
  const loadHistoryRef = useRef<Promise<void> | null>(null);
  const loadHistoryTimeoutRef = useRef<number | null>(null);
  
  const loadHistory = useCallback(async (force = false) => {
    
    if (force && loadHistoryTimeoutRef.current) {
      clearTimeout(loadHistoryTimeoutRef.current);
      loadHistoryTimeoutRef.current = null;
      loadHistoryRef.current = null;
    }

    
    if (!force && loadHistoryRef.current) {
      await loadHistoryRef.current;
      return;
    }

   
    const debounceTime = force ? 50 : 100;
    loadHistoryRef.current = new Promise((resolve) => {
      loadHistoryTimeoutRef.current = window.setTimeout(async () => {
        try {
          const history = await getConversationHistory();
         
          const sorted = history.sort((a, b) => a.timestamp - b.timestamp);
          setConversationHistory(sorted);
        } catch (error) {
          logger.error('Failed to load conversation history', 'WatchApp', error instanceof Error ? error : new Error(String(error)));
        } finally {
          loadHistoryRef.current = null;
          resolve();
        }
      }, debounceTime);
    });

    await loadHistoryRef.current;
  }, []);

 
  useEffect(() => {
    loadHistory();
    
    return () => {
      if (loadHistoryTimeoutRef.current) {
        clearTimeout(loadHistoryTimeoutRef.current);
      }
    };
  }, []); 

  
  useEffect(() => {
   
    const timeoutId = setTimeout(() => {
      loadHistory(false);
    }, 250);
    
    return () => clearTimeout(timeoutId);
  }, [lastResponse, lastTranscription, recordingResponse, recordingTranscription, loadHistory]);

  
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

 
  useEffect(() => {
    if (mainScrollRef.current && (conversationHistory.length > 0 || lastResponse || lastTranscription || recordingResponse || recordingTranscription)) {
      
      setTimeout(() => {
        if (mainScrollRef.current && !isUserScrollingRef.current) {
          const container = mainScrollRef.current;
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
          
          
          requestAnimationFrame(() => {
            if (container && !isUserScrollingRef.current) {
              const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
              if (wasNearBottom) {
                container.scrollTop = container.scrollHeight;
              }
            }
          });
        }
      }, 150); 
    }
  }, [conversationHistory, lastResponse, lastTranscription, recordingResponse, recordingTranscription]);

  
  const handleScroll = () => {
    if (mainScrollRef.current) {
      const container = mainScrollRef.current;
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
      
      
      isUserScrollingRef.current = !isNearBottom;
      
     
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      
      scrollTimeoutRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 1000);
    }
  };

  
  const handleMessageDeleted = () => {
   
    loadHistory(true);
  };

 
  const handleClearAllHistory = async () => {
    try {
      const { clearConversationHistory } = await import('@/storage/conversationStore');
      await clearConversationHistory();
      setIsClearAllDialogOpen(false);
      
      setConversationHistory([]);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      await loadHistory(true);
    } catch (error) {
      logger.error('Error clearing history', 'WatchApp', error instanceof Error ? error : new Error(String(error)));
      
      setConversationHistory([]);
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

      {/* Main Content - Single Scrollable Container */}
      <main 
        ref={mainScrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto w-full"
      >
        <div className="flex flex-col items-center gap-6 p-6 pb-8 max-w-2xl mx-auto">
          {/* Current Session Section */}
          <div className="flex flex-col items-center gap-6 w-full">
            {/* Voice Visualizer */}
            <VoiceVisualizer
              state={isRecordingAudio ? 'listening' : isProcessingAudio ? 'processing' : voiceState}
              duration={isRecordingAudio ? recordingDuration : audioDuration}
            />

            {/* Transcription & Response Display */}
            {(recordingTranscription || lastTranscription) && (
              <div className="w-full max-w-md px-4">
                <p className="text-xs text-muted-foreground mb-1">You said:</p>
                <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3 italic">
                  "{recordingTranscription || lastTranscription}"
                </p>
              </div>
            )}
            <ResponseCard
              response={recordingResponse || lastResponse}
              error={recordingError || lastError}
            />

            {/* Connection Controls */}
            <div className="flex flex-col items-center gap-4 w-full">
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

              {/* Voice Recorder Button for Testing */}
              <Button
                size="lg"
                variant={isRecordingAudio ? "destructive" : "outline"}
                onClick={isRecordingAudio ? stopRecording : startRecording}
                disabled={isProcessingAudio}
                className="min-w-[200px] gap-2"
              >
                {isProcessingAudio ? (
                  <>
                    <Square className="h-5 w-5 animate-pulse" />
                    Processing...
                  </>
                ) : isRecordingAudio ? (
                  <>
                    <Square className="h-5 w-5" />
                    Stop Recording ({recordingDuration.toFixed(1)}s)
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" />
                    Test Voice Recording
                  </>
                )}
              </Button>

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

          {/* Conversation History Section - Always visible */}
          <div className="w-full max-w-md border-t border-border pt-6 mt-4">
            <div className="mb-4 px-4 flex items-start justify-between gap-3">
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
            <div className="px-4">
              <Suspense fallback={<div className="text-center text-muted-foreground text-sm py-4">Loading history...</div>}>
                <ConversationHistory 
                  messages={conversationHistory} 
                  onMessageDeleted={handleMessageDeleted}
                />
              </Suspense>
            </div>
          </div>
        </div>
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

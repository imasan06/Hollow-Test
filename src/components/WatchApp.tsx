import { useState } from 'react';
import { useBle } from '@/hooks/useBle';
import { Button } from '@/components/ui/button';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { VoiceVisualizer } from '@/components/ui/VoiceVisualizer';
import { ResponseCard } from '@/components/ui/ResponseCard';
import { Bluetooth, BluetoothOff, Watch, Wifi, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { APP_CONFIG } from '@/config/app.config';

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
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning' || connectionState === 'connecting';


  return (
    <div className="flex min-h-screen flex-col bg-background safe-area-top">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm safe-area-top">
        <div className="container flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Watch className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Hollow 0W</h1>
              {APP_CONFIG.BLE_MOCK_MODE && (
                <Badge variant="outline" className="text-[10px] px-2 py-0.5">DEMO MODE</Badge>
              )}
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
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
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
    </div>
  );
}

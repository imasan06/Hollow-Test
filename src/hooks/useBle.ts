import { useState, useCallback, useEffect, useRef } from 'react';
import { bleManager, ConnectionState, VoiceState } from '@/ble/bleManager';
import { decodeImaAdpcm } from '@/audio/imaDecoder';
import { encodeWavBase64, getAudioDuration } from '@/audio/wavEncoder';
import { sendTranscription } from '@/api';
import { toast } from '@/hooks/use-toast';
import { APP_CONFIG } from '@/config/app.config';

export interface UseBleReturn {
  connectionState: ConnectionState;
  voiceState: VoiceState;
  lastResponse: string | null;
  lastTranscription: string | null;
  lastError: string | null;
  audioDuration: number;
  isProcessing: boolean;
  scan: () => Promise<void>;
  disconnect: () => Promise<void>;
  deviceName: string | null;
}

export function useBle(): UseBleReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  
  const isInitialized = useRef(false);
  const chunkCount = useRef(0);

  const processAudio = useCallback(
    async (adpcmData: Uint8Array, mode: 'VOICE' | 'SILENT') => {
      setIsProcessing(true);
      setVoiceState('processing');
  
      try {
        console.log('[Hook] Processing ADPCM buffer, size:', adpcmData.length);
  
        if (adpcmData.length === 0) {
          throw new Error('No audio data received');
        }
  
        // Decode ADPCM to PCM16
        const { samples } = decodeImaAdpcm(adpcmData);
        console.log('[Hook] Decoded to PCM samples:', samples.length);
  
        // Calculate duration
        const duration = getAudioDuration(samples.length);
        setAudioDuration(duration);
        console.log('[Hook] Audio duration:', duration.toFixed(2), 'seconds');
  
        // Encode to WAV base64
        const wavBase64 = encodeWavBase64(samples);
        console.log('[Hook] WAV base64 length:', wavBase64.length);

        // In demo/mock mode, skip network call to avoid CORS/backends
        const response = APP_CONFIG.BLE_MOCK_MODE
          ? { transcription: 'Demo audio (sine wave 440Hz)', text: 'Hi, this is a demo response.' }
          : (() => {
              toast({
                title: 'Processing...',
                description: 'Sending audio for transcription and AI response',
              });
              return null;
            })();

        const apiResponse = response ?? await sendTranscription({ audio: wavBase64 });
  
        if ((apiResponse as any).error) {
          throw new Error((apiResponse as any).error);
        }
  
        if (apiResponse.transcription) {
          setLastTranscription(apiResponse.transcription);
          console.log('[Hook] Transcription:', apiResponse.transcription);
        }
  
        setLastResponse(apiResponse.text);
        setVoiceState('responding');
  
        // Send LLM response to watch
        await bleManager.sendText(apiResponse.text);
  
        // Ya no hace falta clearAudioBuffer aquí, el manager ya reseteó su buffer
        toast({
          title: 'Done',
          description: 'Response sent to watch',
        });
      } catch (error) {
        console.error('[Hook] Audio processing failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Processing failed';
        setLastError(errorMessage);
        toast({
          title: 'Processing Error',
          description: errorMessage,
          variant: 'destructive',
        });
      } finally {
        setIsProcessing(false);
        setVoiceState('idle');
        chunkCount.current = 0;
      }
    },
    []
  );
  

  const initializeBle = useCallback(async () => {
    if (isInitialized.current) return;

    try {
      await bleManager.initialize({
        onConnectionStateChange: (state) => {
          setConnectionState(state);
          setDeviceName(bleManager.getDeviceName());
      
          if (state === 'connected') {
            toast({
              title: 'Connected',
              description: `Connected to ${bleManager.getDeviceName() || 'watch'}`,
            });
          } else if (state === 'disconnected') {
            setVoiceState('idle');
          }
        },
        onVoiceStateChange: (state) => {
          setVoiceState(state);
          chunkCount.current = 0;
        },
        onAudioData: (data) => {
          chunkCount.current++;
          // Update duration estimate during recording
          const estimatedSamples = chunkCount.current * data.length * 2;
          setAudioDuration(getAudioDuration(estimatedSamples));
        },
       
        onAudioComplete: (adpcmData, mode) => {
          console.log('[Hook] onAudioComplete called. Mode:', mode);
          processAudio(adpcmData, mode);
        },
        onTimeRequest: () => {
          console.log('[Hook] Time requested by watch');
          bleManager.sendTime();
        },
        onError: (error) => {
          setLastError(error);
          toast({
            title: 'Bluetooth Error',
            description: error,
            variant: 'destructive',
          });
        },
      });
      
      
      isInitialized.current = true;
    } catch (error) {
      console.error('[Hook] BLE initialization failed:', error);
    }
  }, [processAudio]);

  const scan = useCallback(async () => {
    await initializeBle();
    setLastError(null);
    await bleManager.scan();
  }, [initializeBle]);

  const disconnect = useCallback(async () => {
    await bleManager.disconnect();
    setLastResponse(null);
    setLastTranscription(null);
    setLastError(null);
    setAudioDuration(0);
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeBle();
    
    return () => {
      bleManager.disconnect();
    };
  }, [initializeBle]);

  return {
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
  };
}

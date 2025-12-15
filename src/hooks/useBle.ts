import { useState, useCallback, useEffect, useRef } from 'react';
import { bleManager, ConnectionState, VoiceState } from '@/ble/bleManager';
import { decodeImaAdpcm } from '@/audio/imaDecoder';
import { encodeWavBase64, getAudioDuration } from '@/audio/wavEncoder';
import { textToSpeechWavSimple } from '@/audio/textToSpeech';
import { sendTranscription } from '@/api';
import { toast } from '@/hooks/use-toast';
import { APP_CONFIG } from '@/config/app.config';
import { appendMessage } from '@/storage/conversationStore';
import { timeSyncService } from '@/services/timeSyncService';

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
  sendTextMessage: (text: string) => Promise<void>; // For testing AI without watch
  testWithAudio: (text: string) => Promise<void>; // Test with audio WAV (simulates real mode)
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
  
  // Session isolation: track active session to prevent mixing requests/responses
  const activeSessionId = useRef<string | null>(null);
  const isProcessingRequest = useRef(false); // Lock: only one inflight request at a time

  // Handle persona update from watch via BLE
  const handlePersonaUpdateFromWatch = useCallback(async (data: string) => {
    try {
      const { upsertPresetByName, setActivePreset } = await import('@/storage/settingsStore');
      
      // Try to parse as JSON first (SET_PERSONA_JSON format)
      let presetData: any;
      try {
        presetData = JSON.parse(data);
      } catch {
        // If not JSON, treat as legacy format (just persona text)
        presetData = {
          name: 'Watch Preset',
          persona: data,
          rules: '',
          baseRules: '',
        };
      }
      
      // Ensure name exists
      if (!presetData.name) {
        presetData.name = 'Watch Preset';
      }
      
      // Upsert preset by name
      const preset = await upsertPresetByName(presetData);
      
      // Set as active
      await setActivePreset(preset.id);
      
      console.log('[Hook] Persona updated from watch:', preset.name);
      
      toast({
        title: 'Persona Updated',
        description: `"${preset.name}" received from watch and set as active`,
      });
    } catch (error) {
      console.error('[Hook] Failed to update persona from watch:', error);
      toast({
        title: 'Error',
        description: 'Failed to update persona from watch',
        variant: 'destructive',
      });
    }
  }, []);

  const processAudio = useCallback(
    async (adpcmData: Uint8Array, mode: 'VOICE' | 'SILENT') => {
      // Session isolation: Check if another request is in progress
      if (isProcessingRequest.current) {
        console.warn('[Hook] ⚠ Another request is in progress, ignoring this audio');
        return;
      }

      // Generate new session ID for this request
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      activeSessionId.current = sessionId;
      isProcessingRequest.current = true;

      setIsProcessing(true);
      setVoiceState('processing');
  
      try {
        console.log(`[Hook] [${sessionId}] Processing ADPCM buffer, size:`, adpcmData.length);
  
        if (adpcmData.length === 0) {
          throw new Error('No audio data received');
        }
  
        // Decode ADPCM to PCM16
        const { samples } = decodeImaAdpcm(adpcmData);
        console.log(`[Hook] [${sessionId}] Decoded to PCM samples:`, samples.length);
  
        // Calculate duration
        const duration = getAudioDuration(samples.length);
        setAudioDuration(duration);
        console.log(`[Hook] [${sessionId}] Audio duration:`, duration.toFixed(2), 'seconds');
  
        // Encode to WAV base64
        const wavBase64 = encodeWavBase64(samples);
        console.log(`[Hook] [${sessionId}] WAV base64 length:`, wavBase64.length);

        // In demo/mock mode, skip network call to avoid CORS/backends
        let apiResponse: { transcription?: string; text: string; error?: string };
        
        if (APP_CONFIG.BLE_MOCK_MODE) {
          // Mock response - still save to conversation history
          // In mock mode, we still prepare context (for testing) but don't send it
          const { formatConversationContext } = await import('@/storage/conversationStore');
          const mockContext = await formatConversationContext();
          if (mockContext) {
            console.log(`[Hook] [${sessionId}] Mock mode: Context available but not sent (mock response)`);
            console.log(`[Hook] [${sessionId}] Mock mode: Context has ${mockContext.split('\n\n').length} previous messages`);
          }
          
          apiResponse = { 
            transcription: 'Demo audio (sine wave 440Hz)', 
            text: 'Hi, this is a demo response.' 
          };
          console.log(`[Hook] [${sessionId}] Mock mode: Using hardcoded response`);
        } else {
          toast({
            title: 'Processing...',
            description: 'Sending audio for transcription and AI response',
          });
          
          // Check if session is still active before sending (prevent stale requests)
          if (activeSessionId.current !== sessionId) {
            console.warn(`[Hook] [${sessionId}] Session changed, aborting request`);
            return;
          }
          
          apiResponse = await sendTranscription({ audio: wavBase64 });
        }
  
        // Check if session is still active before processing response
        if (activeSessionId.current !== sessionId) {
          console.warn(`[Hook] [${sessionId}] ⚠ Response received but session changed (stale response ignored)`);
          return;
        }
  
        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }
  
        // Save user transcription to conversation history
        if (apiResponse.transcription) {
          setLastTranscription(apiResponse.transcription);
          console.log(`[Hook] [${sessionId}] Transcription:`, apiResponse.transcription);
          
          // Save user message to conversation history
          await appendMessage({
            role: 'user',
            text: apiResponse.transcription,
            timestamp: Date.now(),
          });
        }
  
        setLastResponse(apiResponse.text);
        setVoiceState('responding');
        
        console.log(`[Hook] [${sessionId}] AI Response received:`, apiResponse.text);
        console.log(`[Hook] [${sessionId}] Response will be displayed in UI and sent to watch`);
  
        // Save AI response to conversation history
        if (apiResponse.text) {
          await appendMessage({
            role: 'assistant',
            text: apiResponse.text,
            timestamp: Date.now(),
          });
          console.log(`[Hook] [${sessionId}] AI response saved to conversation history`);
        }
  
        // Send LLM response to watch (only if session is still active)
        if (activeSessionId.current === sessionId) {
          await bleManager.sendAiText(apiResponse.text);
          console.log(`[Hook] [${sessionId}] Response sent to watch via BLE`);
        } else {
          console.warn(`[Hook] [${sessionId}] ⚠ Session changed, not sending response to watch`);
        }
  
        toast({
          title: 'Done',
          description: 'Response sent to watch',
        });
      } catch (error) {
        // Only show error if this is still the active session
        if (activeSessionId.current === sessionId) {
          console.error(`[Hook] [${sessionId}] Audio processing failed:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Processing failed';
          setLastError(errorMessage);
          toast({
            title: 'Processing Error',
            description: errorMessage,
            variant: 'destructive',
          });
        } else {
          console.warn(`[Hook] [${sessionId}] Error in stale session, ignoring`);
        }
      } finally {
        // Only reset if this is still the active session
        if (activeSessionId.current === sessionId) {
          setIsProcessing(false);
          setVoiceState('idle');
          isProcessingRequest.current = false;
        }
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
            // Start time sync service when connected
            timeSyncService.start();
            console.log('[Hook] TimeSyncService started');
            
            toast({
              title: 'Connected',
              description: `Connected to ${bleManager.getDeviceName() || 'watch'}`,
            });
          } else if (state === 'disconnected') {
            // Stop time sync service when disconnected
            timeSyncService.stop();
            console.log('[Hook] TimeSyncService stopped');
            
            // Reset session isolation
            activeSessionId.current = null;
            isProcessingRequest.current = false;
            
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
          console.log('[Hook] Time requested by watch (REQ_TIME)');
          // Delegate to TimeSyncService
          timeSyncService.handleTimeRequest();
        },
        onControlMessage: (command, data) => {
          console.log('[Hook] Control message received:', command, data);
          // Handle SET_PERSONA_JSON command from watch
          if ((command === 'SET_PERSONA_JSON' || command === 'SET_PERSONA') && data) {
            if (command === 'SET_PERSONA' && !data.startsWith('{')) {
              // Legacy format support (fallback)
              console.warn('[Hook] Legacy SET_PERSONA format received, consider using SET_PERSONA_JSON');
            }
            handlePersonaUpdateFromWatch(data);
          }
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
  }, [processAudio, handlePersonaUpdateFromWatch]);

  const scan = useCallback(async () => {
    await initializeBle();
    setLastError(null);
    await bleManager.scan();
  }, [initializeBle]);

  const disconnect = useCallback(async () => {
    // Stop time sync service
    timeSyncService.stop();
    
    // Reset session isolation
    activeSessionId.current = null;
    isProcessingRequest.current = false;
    
    await bleManager.disconnect();
    setLastResponse(null);
    setLastTranscription(null);
    setLastError(null);
    setAudioDuration(0);
  }, []);

  /**
   * Test AI by sending audio WAV base64 (simulates real mode exactly)
   * This creates a silent/minimal audio WAV and sends it to backend
   * The backend will transcribe it (might be empty/silent) and respond
   * This is the most reliable way to test because it uses the exact same flow as real mode
   */
  const testWithAudio = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a message',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    setVoiceState('processing');
    setLastError(null);

    try {
      console.log('[Hook] Testing with audio WAV (simulating real mode):', text);
      
      toast({
        title: 'Processing...',
        description: 'Sending audio to backend (test mode)',
      });

      // Generate real audio from text using Text-to-Speech
      // This creates audio that the backend can actually transcribe
      console.log('[Hook] Generating audio from text using TTS...');
      let wavBase64: string;
      
      try {
        // Try to generate audio using TTS
        // Note: This requires microphone permission to capture system audio
        wavBase64 = await textToSpeechWavSimple(text.trim());
        console.log('[Hook] Generated audio WAV from text, base64 length:', wavBase64.length);
      } catch (ttsError) {
        console.warn('[Hook] TTS failed (may need microphone permission), sending text directly instead:', ttsError);
        // Fallback: send text directly WITHOUT audio
        // The backend ignores 'text' field when 'audio' is present, so we skip audio entirely
        // This simulates the backend processing text directly (as if it was transcribed from audio)
        const apiResponse = await sendTranscription({ 
          text: text.trim() // Send only text, no audio
        });
        
        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }

        // Save user message to conversation history
        setLastTranscription(text.trim());
        await appendMessage({
          role: 'user',
          text: text.trim(),
          timestamp: Date.now(),
        });
        console.log('[Hook] User message saved to conversation history');

        // Set AI response
        setLastResponse(apiResponse.text);
        setVoiceState('responding');
        console.log('[Hook] AI Response received:', apiResponse.text);

        // Save AI response to conversation history
        if (apiResponse.text) {
          await appendMessage({
            role: 'assistant',
            text: apiResponse.text,
            timestamp: Date.now(),
          });
          console.log('[Hook] AI response saved to conversation history');
        }

        toast({
          title: 'Success',
          description: 'AI response received',
        });
        setIsProcessing(false);
        return;
      }

      // Send audio to backend (exact same format as real mode)
      // The backend will transcribe the audio and get the text we generated
      const apiResponse = await sendTranscription({ audio: wavBase64 });

      if (apiResponse.error) {
        throw new Error(apiResponse.error);
      }

      // Save user message to conversation history (using the text we wanted to test)
      setLastTranscription(text.trim());
      await appendMessage({
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      });
      console.log('[Hook] User message saved to conversation history');

      // Set AI response
      setLastResponse(apiResponse.text);
      setVoiceState('responding');
      console.log('[Hook] AI Response received:', apiResponse.text);

      // Save AI response to conversation history
      if (apiResponse.text) {
        await appendMessage({
          role: 'assistant',
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        console.log('[Hook] AI response saved to conversation history');
      }

      // Send response to watch if connected (for testWithAudio mode)
      if (connectionState === 'connected') {
        try {
          await bleManager.sendAiText(apiResponse.text);
          console.log('[Hook] Test response sent to watch via BLE');
        } catch (error) {
          console.warn('[Hook] Failed to send test response to watch:', error);
        }
      }

      toast({
        title: 'Success',
        description: 'AI response received',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get AI response';
      console.error('[Hook] Test with audio failed:', errorMessage);
      setLastError(errorMessage);
      setVoiceState('idle');
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Send text message directly to backend (for testing AI without watch)
   * This bypasses BLE and audio processing, sending text directly
   */
  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a message',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);
    setVoiceState('processing');
    setLastError(null);

    try {
      console.log('[Hook] Sending text message to backend:', text);
      
      toast({
        title: 'Processing...',
        description: 'Sending message to AI backend',
      });

      // Send text directly to backend (includes context automatically)
      const apiResponse = await sendTranscription({ text: text.trim() });

      if (apiResponse.error) {
        throw new Error(apiResponse.error);
      }

      // Save user message to conversation history
      setLastTranscription(text.trim());
      await appendMessage({
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      });
      console.log('[Hook] User message saved to conversation history');

      // Set AI response
      setLastResponse(apiResponse.text);
      setVoiceState('responding');
      console.log('[Hook] AI Response received:', apiResponse.text);

      // Save AI response to conversation history
      if (apiResponse.text) {
        await appendMessage({
          role: 'assistant',
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        console.log('[Hook] AI response saved to conversation history');
      }

      toast({
        title: 'Done',
        description: 'AI response received',
      });
    } catch (error) {
      console.error('[Hook] Text message failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setLastError(errorMessage);
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
      setVoiceState('idle');
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeBle();
    
    return () => {
      // Cleanup: stop time sync and disconnect
      timeSyncService.stop();
      bleManager.disconnect();
      activeSessionId.current = null;
      isProcessingRequest.current = false;
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
    sendTextMessage,
    testWithAudio,
  };
}

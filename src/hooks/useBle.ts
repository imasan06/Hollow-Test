import { useState, useCallback, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { bleManager, ConnectionState, VoiceState } from '@/ble/bleManager';
import { decodeImaAdpcm } from '@/audio/imaDecoder';
import { encodeWavBase64, getAudioDuration, validateWavFormat } from '@/audio/wavEncoder';
import { textToSpeechWavSimple } from '@/audio/textToSpeech';
import { sendTranscription } from '@/api';
import { toast } from '@/hooks/use-toast';
import { APP_CONFIG } from '@/config/app.config';
import { appendMessage, formatConversationContext } from '@/storage/conversationStore';
import { timeSyncService } from '@/services/timeSyncService';
import { backgroundService } from '@/services/backgroundService';
import { logger } from '@/utils/logger';

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
  sendTextMessage: (text: string) => Promise<void>;
  testWithAudio: (text: string) => Promise<void>;
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


  const activeSessionId = useRef<string | null>(null);
  const isProcessingRequest = useRef(false);

  const handlePersonaUpdateFromWatch = useCallback(async (data: string) => {
    try {
      const { upsertPresetByName, setActivePreset } = await import('@/storage/settingsStore');


      let presetData: any;
      try {
        presetData = JSON.parse(data);
      } catch {

        presetData = {
          name: 'Watch Preset',
          persona: data,
          rules: '',
          baseRules: '',
        };
      }


      if (!presetData.name) {
        presetData.name = 'Watch Preset';
      }


      const preset = await upsertPresetByName(presetData);


      await setActivePreset(preset.id);

      logger.debug(`Persona updated from watch: ${preset.name}`, 'Hook');

      toast({
        title: 'Persona Updated',
        description: `"${preset.name}" received from watch and set as active`,
      });
    } catch (error) {
      logger.error('Failed to update persona from watch', 'Hook', error instanceof Error ? error : new Error(String(error)));
      toast({
        title: 'Error',
        description: 'Failed to update persona from watch',
        variant: 'destructive',
      });
    }
  }, []);

  const processAudio = useCallback(
    async (adpcmData: Uint8Array, mode: 'VOICE' | 'SILENT') => {

      if (isProcessingRequest.current) {
        logger.warn('Another request is in progress, ignoring this audio', 'Hook');
        return;
      }

      // TIMING: Start of audio processing pipeline
      const pipelineStart = performance.now();
      const timing = {
        capture: pipelineStart, // Audio received from BLE
        audioProcessing: 0,    // ADPCM decode + WAV encode
        transcription: 0,      // Transcription API call
        contextFetch: 0,        // Context preparation
        chatRequest: 0,         // Chat API call
        responseSave: 0,        // Saving response to storage
        bleSend: 0,             // Sending to watch via BLE
        total: 0,               // Total pipeline time
      };

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      activeSessionId.current = sessionId;
      isProcessingRequest.current = true;

      setIsProcessing(true);
      setVoiceState('processing');

      try {
        logger.info(`[TIMING] Audio capture received: ${adpcmData.length} bytes`, 'Hook');

        if (adpcmData.length === 0) {
          throw new Error('No audio data received');
        }


        // Check if in background for performance optimizations
        const isBackground = document.visibilityState === 'hidden' || (typeof window !== 'undefined' && !document.hasFocus());
        
        // TIMING: Audio processing (decode + encode)
        const audioProcessingStart = performance.now();
        const { samples } = decodeImaAdpcm(adpcmData);
        const wavBase64 = encodeWavBase64(samples);
        timing.audioProcessing = performance.now() - audioProcessingStart;
        
        const duration = getAudioDuration(samples.length);
        setAudioDuration(duration);
        
        logger.info(`[TIMING] Audio processing (decode+encode): ${timing.audioProcessing.toFixed(2)}ms`, 'Hook');

        const validation = validateWavFormat(wavBase64);
        if (!validation.valid) {
          logger.error(`WAV validation failed: ${validation.error}`, 'Hook');
          throw new Error(`Invalid WAV format: ${validation.error}`);
        }
        
        // Only log validation details in foreground or dev mode
        if (!isBackground || import.meta.env.DEV) {
          logger.debug(`WAV validated: ${validation.sampleRate}Hz, ${validation.channels} channel(s)`, 'Hook');
        }

        // Skip detailed audio quality checks in background for performance
        // Only log if in development mode
        if (import.meta.env.DEV && samples.length > 0) {
          const wavHeader = wavBase64.substring(0, 20);
          if (!wavHeader.startsWith('UklGRi')) {
            logger.warn("WAV header doesn't start with 'UklGRi' - format may be incorrect", 'Hook');
          }
        }


        let apiResponse: { transcription?: string; text: string; error?: string };

        if (APP_CONFIG.BLE_MOCK_MODE) {

          const { formatConversationContext } = await import('@/storage/conversationStore');
          const mockContext = await formatConversationContext();
          if (mockContext) {
            logger.debug(`Mock mode: Context available but not sent (mock response)`, 'Hook');
          }

          apiResponse = {
            transcription: 'Demo audio (sine wave 440Hz)',
            text: 'Hi, this is a demo response.'
          };
        } else {
          // OPTIMIZATION: Move toast to after critical path (non-blocking)
          // Toast is now shown asynchronously to not block audio processing

          if (activeSessionId.current !== sessionId) {
            logger.warn('Session changed, aborting request', 'Hook');
            return;
          }

          // OPTIMIZATION: Pre-fetch context in parallel with transcription API call
          // This saves ~50-100ms by not waiting for transcription to complete first
          const contextStart = performance.now();
          const contextPromise = formatConversationContext(true);

          // TIMING: Transcription API call (runs in parallel with context fetch)
          const transcriptionStart = performance.now();
          const transcriptionResult = await sendTranscription({ audio: wavBase64 });
          timing.transcription = performance.now() - transcriptionStart;
          
          if (!transcriptionResult.transcription) {
            throw new Error('No transcription received');
          }

          // Now await the context that was fetching in parallel
          const conversationContext = await contextPromise;
          timing.contextFetch = performance.now() - contextStart;
          
          logger.info(`[TIMING] Transcription API: ${timing.transcription.toFixed(2)}ms`, 'Hook');
          logger.info(`[TIMING] Context fetch (parallel): ${timing.contextFetch.toFixed(2)}ms`, 'Hook');

          // OPTIMIZATION: Update state and save message in parallel with chat request
          // This avoids blocking the chat API call
          setLastTranscription(transcriptionResult.transcription);
          
          // Start message save (fire-and-forget, don't await)
          const messageSavePromise = appendMessage({
            role: 'user',
            text: transcriptionResult.transcription,
            timestamp: Date.now(),
          });

          // TIMING: Chat API call (runs in parallel with message save)
          const chatStart = performance.now();
          apiResponse = await sendTranscription({ 
            text: transcriptionResult.transcription,
            context: conversationContext || undefined,
          });
          timing.chatRequest = performance.now() - chatStart;
          
          // Await message save to complete (should be done by now)
          await messageSavePromise;
          
          logger.info(`[TIMING] Chat API request: ${timing.chatRequest.toFixed(2)}ms`, 'Hook');
        }


        if (activeSessionId.current !== sessionId) {
          logger.warn('Response received but session changed (stale response ignored)', 'Hook');
          return;
        }

        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }

        setLastResponse(apiResponse.text);
        setVoiceState('responding');

        // OPTIMIZATION: Run response save and BLE send in parallel (~50-100ms savings)
        // Both operations are independent and can run concurrently
        const saveStart = performance.now();
        const bleStart = performance.now();
        
        const operations: Promise<void>[] = [];
        
        // Save response to storage (fire in parallel)
        if (apiResponse.text) {
          operations.push(
            appendMessage({
              role: 'assistant',
              text: apiResponse.text,
              timestamp: Date.now(),
            }).then(() => {
              timing.responseSave = performance.now() - saveStart;
            })
          );
        }

        // Send to watch via BLE (fire in parallel)
        if (activeSessionId.current === sessionId && apiResponse.text) {
          operations.push(
            bleManager.sendAiText(apiResponse.text).then(() => {
              timing.bleSend = performance.now() - bleStart;
            })
          );
        }
        
        // Wait for both operations to complete
        await Promise.all(operations);
        
        logger.info(`[TIMING] Response save: ${timing.responseSave.toFixed(2)}ms, BLE send: ${timing.bleSend.toFixed(2)}ms (parallel)`, 'Hook');

        // TIMING: Calculate total and log summary
        timing.total = performance.now() - pipelineStart;
        logger.info(
          `[TIMING SUMMARY] Total: ${timing.total.toFixed(2)}ms | ` +
          `Audio: ${timing.audioProcessing.toFixed(2)}ms | ` +
          `Transcription: ${timing.transcription.toFixed(2)}ms | ` +
          `Context: ${timing.contextFetch.toFixed(2)}ms | ` +
          `Chat: ${timing.chatRequest.toFixed(2)}ms | ` +
          `Save: ${timing.responseSave.toFixed(2)}ms | ` +
          `BLE: ${timing.bleSend.toFixed(2)}ms`,
          'Hook'
        );

        toast({
          title: 'Done',
          description: 'Response sent to watch',
        });
      } catch (error) {

        if (activeSessionId.current === sessionId) {
          logger.error('Audio processing failed', 'Hook', error instanceof Error ? error : new Error(String(error)));
          const errorMessage = error instanceof Error ? error.message : 'Processing failed';
          setLastError(errorMessage);
          toast({
            title: 'Processing Error',
            description: errorMessage,
            variant: 'destructive',
          });
        } else {
          logger.warn('Error in stale session, ignoring', 'Hook');
        }
      } finally {

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


  // Listener para eventos del servicio nativo de background (alta prioridad)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleNativeEvent = (event: CustomEvent) => {
      try {
        const eventName = event.detail?.name || event.type;
        const eventData = event.detail?.data || {};

        logger.debug(`Native background event received: ${eventName}`, 'Hook');

        switch (eventName) {
          case 'bleConnectionStateChanged':
            const connected = eventData.value === true;
            setConnectionState(connected ? 'connected' : 'disconnected');
            if (connected) {
              timeSyncService.start();
            }
            break;

          case 'bleAudioData':
            // Procesar audio recibido del servicio nativo (alta prioridad)
            if (eventData.data) {
              try {
                // Convertir base64 a Uint8Array
                const binaryString = atob(eventData.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                // Procesar audio directamente (evita depender del WebView limitado)
                processAudio(bytes, 'VOICE');
              } catch (error) {
                logger.error('Error processing native audio data', 'Hook', error instanceof Error ? error : new Error(String(error)));
              }
            }
            break;

          case 'bleError':
            const errorMsg = eventData.error || 'Unknown BLE error';
            setLastError(errorMsg);
            logger.error('BLE error from native service', 'Hook', new Error(errorMsg));
            break;
        }
      } catch (error) {
        logger.error('Error handling native event', 'Hook', error instanceof Error ? error : new Error(String(error)));
      }
    };

    // Escuchar eventos de Capacitor (funciona incluso en background)
    window.addEventListener('bleConnectionStateChanged', handleNativeEvent as EventListener);
    window.addEventListener('bleAudioData', handleNativeEvent as EventListener);
    window.addEventListener('bleError', handleNativeEvent as EventListener);

    return () => {
      window.removeEventListener('bleConnectionStateChanged', handleNativeEvent as EventListener);
      window.removeEventListener('bleAudioData', handleNativeEvent as EventListener);
      window.removeEventListener('bleError', handleNativeEvent as EventListener);
    };
  }, [processAudio]);

  const initializeBle = useCallback(async () => {
    if (isInitialized.current) return;

    try {
      await bleManager.initialize({
        onConnectionStateChange: async (state) => {
          setConnectionState(state);
          setDeviceName(bleManager.getDeviceName());

          if (state === 'connected') {
            timeSyncService.start();
            logger.debug('TimeSyncService started', 'Hook');

            // El Foreground Service ya se inició al arrancar la app, solo verificamos que esté activo
            if (backgroundService.getIsEnabled()) {
              logger.debug('Foreground Service ya está activo', 'Hook');
            } else {
              logger.warn('⚠️ Foreground Service no está activo, intentando iniciarlo...', 'Hook');
              try {
                await backgroundService.enable();
                logger.info('Foreground Service iniciado después de conectar', 'Hook');
              } catch (error) {
                logger.error('Error al habilitar servicio de background', 'Hook', error instanceof Error ? error : new Error(String(error)));
                toast({
                  title: 'Advertencia',
                  description: 'El servicio de background no pudo iniciarse. La conexión puede perderse en segundo plano.',
                  variant: 'destructive',
                });
              }
            }

            // Conectar el dispositivo BLE al servicio en segundo plano nativo
            // Solo si no estamos en modo mock y tenemos un deviceId válido (dirección MAC)
            if (!APP_CONFIG.BLE_MOCK_MODE) {
              const deviceId = bleManager.getDeviceId();
              if (deviceId && deviceId.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)) {
                try {
                  logger.debug(`Connecting BLE device to native service: ${deviceId}`, 'Hook');
                  await backgroundService.connectBleDevice(deviceId);
                  logger.info(`✅ BLE device connected to native background service: ${deviceId}`, 'Hook');
                } catch (error) {
                  logger.warn('Failed to connect BLE device to native background service', 'Hook', error instanceof Error ? error : new Error(String(error)));
                }
              } else {
                logger.debug(`Skipping native BLE connection - invalid deviceId format: ${deviceId}`, 'Hook');
              }
            } else {
              logger.debug('Skipping native BLE connection - mock mode enabled', 'Hook');
            }

            toast({
              title: 'Connected',
              description: `Connected to ${bleManager.getDeviceName() || 'watch'}`,
            });
          } else if (state === 'disconnected') {
            timeSyncService.stop();
            logger.debug('TimeSyncService stopped', 'Hook');

            // Desconectar el dispositivo BLE del servicio en segundo plano
            try {
              await backgroundService.disconnectBleDevice();
              logger.debug('BLE device disconnected from native background service', 'Hook');
            } catch (error) {
              logger.warn('Failed to disconnect BLE device from native background service', 'Hook');
            }

            try {
              await backgroundService.disable();
              logger.debug('Background mode disabled', 'Hook');
            } catch (error) {
              logger.warn('Failed to disable background mode', 'Hook');
            }


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

          const estimatedSamples = chunkCount.current * data.length * 2;
          setAudioDuration(getAudioDuration(estimatedSamples));
        },

        onAudioComplete: (adpcmData, mode) => {
          logger.debug(`onAudioComplete called. Mode: ${mode}`, 'Hook');
          processAudio(adpcmData, mode);
        },
        onTimeRequest: () => {
          logger.debug('Time requested by watch (REQ_TIME)', 'Hook');

          timeSyncService.handleTimeRequest();
        },
        onControlMessage: (command, data) => {
          logger.debug(`Control message received: ${command}`, 'Hook');

          if ((command === 'SET_PERSONA_JSON' || command === 'SET_PERSONA') && data) {
            if (command === 'SET_PERSONA' && !data.startsWith('{')) {
              logger.warn('Legacy SET_PERSONA format received, consider using SET_PERSONA_JSON', 'Hook');
            }
            handlePersonaUpdateFromWatch(data);
          }
        },
        onError: (error) => {
          setLastError(error);

          if (!error.toLowerCase().includes('cancelled') && !error.toLowerCase().includes('cancel')) {
            toast({
              title: 'Bluetooth Error',
              description: error,
              variant: 'destructive',
            });
          }
        },
      });


      isInitialized.current = true;
    } catch (error) {
      logger.error('BLE initialization failed', 'Hook', error instanceof Error ? error : new Error(String(error)));
    }
  }, [processAudio, handlePersonaUpdateFromWatch]);

  const scan = useCallback(async () => {
    await initializeBle();
    setLastError(null);
    await bleManager.scan();
  }, [initializeBle]);

  const disconnect = useCallback(async () => {

    timeSyncService.stop();


    activeSessionId.current = null;
    isProcessingRequest.current = false;

    await bleManager.disconnect();
    setLastResponse(null);
    setLastTranscription(null);
    setLastError(null);
    setAudioDuration(0);
  }, []);


  useEffect(() => {
    if (lastError && (lastError.toLowerCase().includes('cancelled') || lastError.toLowerCase().includes('cancel'))) {
      const timer = setTimeout(() => {
        setLastError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [lastError]);


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
      logger.debug(`Testing with audio WAV (simulating real mode): ${text}`, 'Hook');

      toast({
        title: 'Processing...',
        description: 'Sending audio to backend (test mode)',
      });


      logger.debug('Generating audio from text using TTS', 'Hook');
      let wavBase64: string;

      try {

        wavBase64 = await textToSpeechWavSimple(text.trim());
        logger.debug(`Generated audio WAV from text, base64 length: ${wavBase64.length}`, 'Hook');
      } catch (ttsError) {
        logger.warn('TTS failed (may need microphone permission), sending text directly instead', 'Hook');

        const apiResponse = await sendTranscription({
          text: text.trim()
        });

        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }


        setLastTranscription(text.trim());
        await appendMessage({
          role: 'user',
          text: text.trim(),
          timestamp: Date.now(),
        });
        logger.debug('User message saved to conversation history', 'Hook');


        setLastResponse(apiResponse.text);
        setVoiceState('responding');
        logger.debug(`AI Response received: ${apiResponse.text?.substring(0, 100)}`, 'Hook');


        if (apiResponse.text) {
          await appendMessage({
            role: 'assistant',
            text: apiResponse.text,
            timestamp: Date.now(),
          });
          logger.debug('AI response saved to conversation history', 'Hook');
        }

        toast({
          title: 'Success',
          description: 'AI response received',
        });
        setIsProcessing(false);
        return;
      }


      const apiResponse = await sendTranscription({ audio: wavBase64 });

      if (apiResponse.error) {
        throw new Error(apiResponse.error);
      }


      setLastTranscription(text.trim());
      await appendMessage({
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      });
        logger.debug('User message saved to conversation history', 'Hook');


      setLastResponse(apiResponse.text);
      setVoiceState('responding');
        logger.debug(`AI Response received: ${apiResponse.text?.substring(0, 100)}`, 'Hook');


      if (apiResponse.text) {
        await appendMessage({
          role: 'assistant',
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        logger.debug('AI response saved to conversation history', 'Hook');
      }


      if (connectionState === 'connected') {
        try {
          await bleManager.sendAiText(apiResponse.text);
          logger.debug('Test response sent to watch via BLE', 'Hook');
        } catch (error) {
          logger.warn('Failed to send test response to watch', 'Hook');
        }
      }

      toast({
        title: 'Success',
        description: 'AI response received',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get AI response';
      logger.error('Test with audio failed', 'Hook', new Error(errorMessage));
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
      logger.debug(`Sending text message to backend: ${text}`, 'Hook');

      toast({
        title: 'Processing...',
        description: 'Sending message to AI backend',
      });


      const apiResponse = await sendTranscription({ text: text.trim() });

      if (apiResponse.error) {
        throw new Error(apiResponse.error);
      }


      setLastTranscription(text.trim());
      await appendMessage({
        role: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      });
        logger.debug('User message saved to conversation history', 'Hook');


      setLastResponse(apiResponse.text);
      setVoiceState('responding');
        logger.debug(`AI Response received: ${apiResponse.text?.substring(0, 100)}`, 'Hook');


      if (apiResponse.text) {
        await appendMessage({
          role: 'assistant',
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        logger.debug('AI response saved to conversation history', 'Hook');
      }

      toast({
        title: 'Done',
        description: 'AI response received',
      });
    } catch (error) {
      logger.error('Text message failed', 'Hook', error instanceof Error ? error : new Error(String(error)));
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

  useEffect(() => {
    initializeBle();

    return () => {

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

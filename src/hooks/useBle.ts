import { useState, useCallback, useEffect, useRef } from 'react';
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


      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      activeSessionId.current = sessionId;
      isProcessingRequest.current = true;

      setIsProcessing(true);
      setVoiceState('processing');

      try {
        logger.debug(`Processing ADPCM buffer, size: ${adpcmData.length}`, 'Hook');

        if (adpcmData.length === 0) {
          throw new Error('No audio data received');
        }


        const decodeStart = performance.now();
        const { samples } = decodeImaAdpcm(adpcmData);
        const decodeTime = performance.now() - decodeStart;
        logger.debug(`Decoded to PCM samples: ${samples.length} (${decodeTime.toFixed(2)}ms)`, 'Hook');


        const duration = getAudioDuration(samples.length);
        setAudioDuration(duration);
        logger.debug(`Audio duration: ${duration.toFixed(2)} seconds`, 'Hook');

        const encodeStart = performance.now();
        const wavBase64 = encodeWavBase64(samples);
        const encodeTime = performance.now() - encodeStart;
        logger.debug(`WAV base64 length: ${wavBase64.length} (${encodeTime.toFixed(2)}ms)`, 'Hook');

        const validation = validateWavFormat(wavBase64);
        if (!validation.valid) {
          logger.error(`WAV validation failed: ${validation.error}`, 'Hook');
          throw new Error(`Invalid WAV format: ${validation.error}`);
        }
        logger.debug(`WAV validated: ${validation.sampleRate}Hz, ${validation.channels} channel(s)`, 'Hook');


        const wavHeader = wavBase64.substring(0, 20);
        logger.debug(`WAV header (base64): ${wavHeader}`, 'Hook');
        if (!wavHeader.startsWith('UklGRi')) {
          logger.warn("WAV header doesn't start with 'UklGRi' - format may be incorrect", 'Hook');
        }


        if (samples.length > 0) {
          const maxSample = Math.max(...Array.from(samples).map(Math.abs));
          const avgSample = Math.abs(Array.from(samples).reduce((a, b) => a + Math.abs(b), 0) / samples.length);
          logger.debug(`Audio quality - Max: ${maxSample}, Avg: ${avgSample.toFixed(0)}`, 'Hook');
        }


        let apiResponse: { transcription?: string; text: string; error?: string };

        if (APP_CONFIG.BLE_MOCK_MODE) {

          const { formatConversationContext } = await import('@/storage/conversationStore');
          const mockContext = await formatConversationContext();
          if (mockContext) {
            logger.debug(`Mock mode: Context available but not sent (mock response)`, 'Hook');
            logger.debug(`Mock mode: Context has ${mockContext.split('\n\n').length} previous messages`, 'Hook');
          }

          apiResponse = {
            transcription: 'Demo audio (sine wave 440Hz)',
            text: 'Hi, this is a demo response.'
          };
          logger.debug('Mock mode: Using hardcoded response', 'Hook');
        } else {
          toast({
            title: 'Processing...',
            description: 'Sending audio for transcription and AI response',
          });


          if (activeSessionId.current !== sessionId) {
            logger.warn('Session changed, aborting request', 'Hook');
            return;
          }

          const transcriptionResult = await sendTranscription({ audio: wavBase64 });
          
          if (!transcriptionResult.transcription) {
            throw new Error('No transcription received');
          }

          setLastTranscription(transcriptionResult.transcription);
          logger.debug(`Transcription: ${transcriptionResult.transcription}`, 'Hook');

          await appendMessage({
            role: 'user',
            text: transcriptionResult.transcription,
            timestamp: Date.now(),
          });
          logger.debug('User message saved to conversation history', 'Hook');

          await new Promise(resolve => setTimeout(resolve, 50));

          const conversationContext = await formatConversationContext();
          logger.debug(`Context for AI request: ${conversationContext ? `${conversationContext.length} chars` : 'empty'}`, 'Hook');
          
          if (conversationContext) {
            const contextLines = conversationContext.split('\n\n');
            const lastContextLine = contextLines[contextLines.length - 1];
            logger.debug(`Last context line: ${lastContextLine.substring(0, 100)}...`, 'Hook');
            
            if (!lastContextLine.includes(transcriptionResult.transcription.substring(0, 20))) {
              logger.warn('Current user message not found in context!', 'Hook');
            }
          }

          apiResponse = await sendTranscription({ 
            text: transcriptionResult.transcription,
            context: conversationContext || undefined,
          });
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

        logger.debug(`AI Response received: ${apiResponse.text?.substring(0, 100)}`, 'Hook');


        if (apiResponse.text) {
          await appendMessage({
            role: 'assistant',
            text: apiResponse.text,
            timestamp: Date.now(),
          });
          logger.debug('AI response saved to conversation history', 'Hook');
        }


        if (activeSessionId.current === sessionId) {
          await bleManager.sendAiText(apiResponse.text);
          logger.debug('Response sent to watch via BLE', 'Hook');
        } else {
          logger.warn('Session changed, not sending response to watch', 'Hook');
        }

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

            toast({
              title: 'Connected',
              description: `Connected to ${bleManager.getDeviceName() || 'watch'}`,
            });
          } else if (state === 'disconnected') {
            timeSyncService.stop();
            logger.debug('TimeSyncService stopped', 'Hook');

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

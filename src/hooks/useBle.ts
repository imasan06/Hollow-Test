import { useState, useCallback, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { bleManager, ConnectionState, VoiceState } from "@/ble/bleManager";
import { decodeImaAdpcm } from "@/audio/imaDecoder";
import {
  encodeWavBase64,
  getAudioDuration,
  validateWavFormat,
} from "@/audio/wavEncoder";
import { textToSpeechWavSimple } from "@/audio/textToSpeech";
import { sendTranscription } from "@/api";
import { toast } from "@/hooks/use-toast";
import { APP_CONFIG } from "@/config/app.config";
import {
  appendMessage,
  formatConversationContext,
} from "@/storage/conversationStore";
import { timeSyncService } from "@/services/timeSyncService";
import { backgroundService, BackgroundServiceNative } from "@/services/backgroundService";
import type { BleEventData } from "@/services/backgroundService";
import { logger } from "@/utils/logger";

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
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [lastTranscription, setLastTranscription] = useState<string | null>(
    null
  );
  const [lastError, setLastError] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const isInitialized = useRef(false);
  const chunkCount = useRef(0);

  const activeSessionId = useRef<string | null>(null);
  const isProcessingRequest = useRef(false);

  const lastAudioProcessedTime = useRef<number>(0);
  const AUDIO_DEDUP_WINDOW_MS = 2000;

  const processingTimeoutRef = useRef<number | null>(null);
  const MAX_PROCESSING_TIME_MS = 180000;

  const handlePersonaUpdateFromWatch = useCallback(async (data: string) => {
    try {
      const { upsertPresetByName, setActivePreset } = await import(
        "@/storage/settingsStore"
      );

      let presetData: any;
      try {
        presetData = JSON.parse(data);
      } catch {
        presetData = {
          name: "Watch Preset",
          persona: data,
          rules: "",
          baseRules: "",
        };
      }

      if (!presetData.name) {
        presetData.name = "Watch Preset";
      }

      const preset = await upsertPresetByName(presetData);

      await setActivePreset(preset.id);

      logger.debug(`Persona updated from watch: ${preset.name}`, "Hook");

      toast({
        title: "Persona Updated",
        description: `"${preset.name}" received from watch and set as active`,
      });
    } catch (error) {
      logger.error(
        "Failed to update persona from watch",
        "Hook",
        error instanceof Error ? error : new Error(String(error))
      );
      toast({
        title: "Error",
        description: "Failed to update persona from watch",
        variant: "destructive",
      });
    }
  }, []);

  const processAudio = useCallback(
    async (adpcmData: Uint8Array, mode: "VOICE" | "SILENT") => {
      const now = Date.now();

      // Check if in background for different handling
      const isBackground = document.visibilityState === 'hidden' || (typeof window !== 'undefined' && !document.hasFocus());
      
      if (isProcessingRequest.current) {
        const timeSinceStart = now - lastAudioProcessedTime.current;
        logger.warn(
          `Another request is in progress (${timeSinceStart}ms ago), ignoring this audio`,
          "Hook"
        );

        // In background: Be more lenient - allow new requests after 30s to prevent blocking
        // In foreground: Only reset after max timeout (3min)
        const timeoutThreshold = isBackground ? 30000 : MAX_PROCESSING_TIME_MS;
        
        if (timeSinceStart > timeoutThreshold) {
          logger.error(
            `Processing flag stuck for too long (${timeSinceStart}ms) - forcing reset`,
            "Hook"
          );
          isProcessingRequest.current = false;
          setIsProcessing(false);
          setVoiceState("idle");
          if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
          }
          // Continue processing this audio after reset
        } else {
          // In background: Log but allow processing if reasonable time has passed (10s)
          // This prevents permanent blocking in background where requests can queue
          if (isBackground && timeSinceStart > 10000) {
            logger.warn(
              `Background: Previous request taking long (${timeSinceStart}ms), allowing new request`,
              "Hook"
            );
            // Don't block - allow this audio to be processed
            // The deduplication window will prevent true duplicates
          } else {
            return;
          }
        }
      }

      // Check for duplicate audio (prevent processing same audio twice)
      const timeSinceLastAudio = now - lastAudioProcessedTime.current;
      if (
        timeSinceLastAudio < AUDIO_DEDUP_WINDOW_MS &&
        lastAudioProcessedTime.current > 0
      ) {
        logger.debug(
          `Skipping duplicate audio (${timeSinceLastAudio}ms since last)`,
          "Hook"
        );
        return;
      }
      
      // In background: Update lastAudioProcessedTime immediately to prevent duplicates
      // This ensures we don't process the same audio chunk multiple times
      lastAudioProcessedTime.current = now;

      lastAudioProcessedTime.current = now;

      const pipelineStart = performance.now();
      const timing = {
        capture: pipelineStart,
        audioProcessing: 0,
        transcription: 0,
        contextFetch: 0,
        chatRequest: 0,
        responseSave: 0,
        bleSend: 0,
        total: 0,
      };

      const sessionId = `session_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      activeSessionId.current = sessionId;
      isProcessingRequest.current = true;

      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      processingTimeoutRef.current = window.setTimeout(() => {
        if (
          isProcessingRequest.current &&
          activeSessionId.current === sessionId
        ) {
          logger.warn(
            "Processing timeout - auto-resetting processing flag",
            "Hook"
          );
          isProcessingRequest.current = false;
          setIsProcessing(false);
          setVoiceState("idle");
        }
        processingTimeoutRef.current = null;
      }, MAX_PROCESSING_TIME_MS);

      setIsProcessing(true);
      setVoiceState("processing");

      try {
        logger.info(
          `[TIMING] Audio capture received: ${adpcmData.length} bytes`,
          "Hook"
        );

        if (adpcmData.length === 0) {
          throw new Error("No audio data received");
        }

        const isBackground =
          document.visibilityState === "hidden" ||
          (typeof window !== "undefined" && !document.hasFocus());

        const audioProcessingStart = performance.now();
        const { samples } = decodeImaAdpcm(adpcmData);
        const wavBase64 = encodeWavBase64(samples);
        timing.audioProcessing = performance.now() - audioProcessingStart;

        const duration = getAudioDuration(samples.length);
        setAudioDuration(duration);

        if (import.meta.env.DEV) {
          const validation = validateWavFormat(wavBase64);
          if (!validation.valid) {
            logger.error(`WAV validation failed: ${validation.error}`, "Hook");
            throw new Error(`Invalid WAV format: ${validation.error}`);
          }
          logger.debug(
            `WAV validated: ${validation.sampleRate}Hz, ${validation.channels} channel(s)`,
            "Hook"
          );
        }

        let apiResponse: {
          transcription?: string;
          text: string;
          error?: string;
        };

        if (APP_CONFIG.BLE_MOCK_MODE) {
          const { formatConversationContext } = await import(
            "@/storage/conversationStore"
          );
          const mockContext = await formatConversationContext();
          if (mockContext) {
            logger.debug(
              `Mock mode: Context available but not sent (mock response)`,
              "Hook"
            );
          }

          apiResponse = {
            transcription: "Demo audio (sine wave 440Hz)",
            text: "Hi, this is a demo response.",
          };
        } else {
          if (activeSessionId.current !== sessionId) {
            logger.warn("Session changed, aborting request", "Hook");
            return;
          }

          const apiStart = performance.now();

          const conversationContext = await formatConversationContext(true);
          timing.contextFetch = performance.now() - apiStart;

          const apiCallStart = performance.now();
          apiResponse = await sendTranscription({
            audio: wavBase64,
            context: conversationContext || undefined,
          });
          timing.transcription = performance.now() - apiCallStart;
          timing.chatRequest = timing.transcription;

          if (!apiResponse.transcription) {
            throw new Error("Backend did not return transcription");
          }

          logger.info(
            `[TIMING] Context fetch: ${timing.contextFetch.toFixed(2)}ms`,
            "Hook"
          );
          logger.info(
            `[TIMING] Backend API (transcription + chat): ${timing.transcription.toFixed(
              2
            )}ms`,
            "Hook"
          );

          setLastTranscription(apiResponse.transcription);

          await appendMessage({
            role: "user",
            text: apiResponse.transcription,
            timestamp: Date.now(),
          });

          logger.debug("User message saved to conversation history", "Hook");
        }

        if (activeSessionId.current !== sessionId) {
          logger.warn(
            "Response received but session changed (stale response ignored)",
            "Hook"
          );
          return;
        }

        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }

        setLastResponse(apiResponse.text);
        setVoiceState("responding");

        const saveStart = performance.now();
        const bleStart = performance.now();

        const operations: Promise<void>[] = [];

        if (apiResponse.text) {
          operations.push(
            appendMessage({
              role: "assistant",
              text: apiResponse.text,
              timestamp: Date.now(),
            }).then(() => {
              timing.responseSave = performance.now() - saveStart;
            })
          );
        }

        if (activeSessionId.current === sessionId && apiResponse.text) {
          operations.push(
            bleManager
              .sendAiText(apiResponse.text)
              .then(() => {
                timing.bleSend = performance.now() - bleStart;
              })
              .catch((error) => {
                timing.bleSend = performance.now() - bleStart;
                const errorMsg =
                  error instanceof Error ? error.message : String(error);
                if (
                  errorMsg.includes("Not connected") ||
                  errorMsg.includes("disconnect") ||
                  errorMsg.includes("failed")
                ) {
                  logger.warn(
                    "Failed to send response to watch (device may have disconnected)",
                    "Hook"
                  );
                } else {
                  logger.error(
                    "Failed to send response to watch",
                    "Hook",
                    error instanceof Error ? error : new Error(String(error))
                  );
                }
              })
          );
        }

        await Promise.all(operations);

        logger.info(
          `[TIMING] Response save: ${timing.responseSave.toFixed(
            2
          )}ms, BLE send: ${timing.bleSend.toFixed(2)}ms (parallel)`,
          "Hook"
        );

        timing.total = performance.now() - pipelineStart;
        logger.info(
          `[TIMING SUMMARY] Total: ${timing.total.toFixed(2)}ms | ` +
            `Audio: ${timing.audioProcessing.toFixed(2)}ms | ` +
            `Transcription: ${timing.transcription.toFixed(2)}ms | ` +
            `Context: ${timing.contextFetch.toFixed(2)}ms | ` +
            `Chat: ${timing.chatRequest.toFixed(2)}ms | ` +
            `Save: ${timing.responseSave.toFixed(2)}ms | ` +
            `BLE: ${timing.bleSend.toFixed(2)}ms`,
          "Hook"
        );

        toast({
          title: "Done",
          description: "Response sent to watch",
        });
      } catch (error) {
        if (activeSessionId.current === sessionId) {
          logger.error(
            "Audio processing failed",
            "Hook",
            error instanceof Error ? error : new Error(String(error))
          );
          const errorMessage =
            error instanceof Error ? error.message : "Processing failed";
          setLastError(errorMessage);
          toast({
            title: "Processing Error",
            description: errorMessage,
            variant: "destructive",
          });
        } else {
          logger.warn("Error in stale session, ignoring", "Hook");
        }
      } finally {
        if (processingTimeoutRef.current) {
          clearTimeout(processingTimeoutRef.current);
          processingTimeoutRef.current = null;
        }

        if (activeSessionId.current === sessionId) {
          setIsProcessing(false);
          setVoiceState("idle");
        }

        isProcessingRequest.current = false;
        chunkCount.current = 0;
      }
    },
    []
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Store listener remove functions for cleanup
    const listenerRemovers: Array<{ remove: () => Promise<void> }> = [];

    const setupNativeListeners = async () => {
      try {
        logger.debug("Setting up native BackgroundService event listeners via Capacitor addListener", "Hook");

        // Handler for connection state changes
        const handleConnectionState = (eventData: BleEventData) => {
          try {
            logger.debug(`Native bleConnectionStateChanged event received`, "Hook");
            const connected = eventData.value === true;
            setConnectionState(connected ? "connected" : "disconnected");
            if (connected) {
              timeSyncService.start();
            }
          } catch (error) {
            logger.error(
              "Error handling connection state event",
              "Hook",
              error instanceof Error ? error : new Error(String(error))
            );
          }
        };

        // Handler for audio data
        const handleAudioData = (eventData: BleEventData) => {
          try {
            if (eventData.data) {
              logger.debug(
                `Received bleAudioData event: ${eventData.data.length} chars (base64)`,
                "Hook"
              );

              const binaryString = atob(eventData.data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              logger.debug(
                `Converted to ${bytes.length} bytes, calling processAudio`,
                "Hook"
              );

              processAudio(bytes, "VOICE");
            } else {
              logger.warn(
                "bleAudioData event received but data is missing",
                "Hook"
              );
            }
          } catch (error) {
            logger.error(
              "Error processing native audio data",
              "Hook",
              error instanceof Error ? error : new Error(String(error))
            );

            isProcessingRequest.current = false;
            setIsProcessing(false);
            setVoiceState("idle");
          }
        };

        // Handler for errors
        const handleError = (eventData: BleEventData) => {
          try {
            const errorMsg = eventData.error || "Unknown BLE error";
            setLastError(errorMsg);
            logger.error(
              "BLE error from native service",
              "Hook",
              new Error(errorMsg)
            );
          } catch (error) {
            logger.error(
              "Error handling BLE error event",
              "Hook",
              error instanceof Error ? error : new Error(String(error))
            );
          }
        };

        // Register listeners using Capacitor's addListener API
        // This properly connects to the notifyListeners calls in the native plugin
        if (BackgroundServiceNative && typeof BackgroundServiceNative.addListener === 'function') {
          const connectionListener = await BackgroundServiceNative.addListener(
            "bleConnectionStateChanged",
            handleConnectionState
          );
          listenerRemovers.push(connectionListener);
          logger.debug("Registered bleConnectionStateChanged listener via Capacitor", "Hook");

          const audioListener = await BackgroundServiceNative.addListener(
            "bleAudioData",
            handleAudioData
          );
          listenerRemovers.push(audioListener);
          logger.debug("Registered bleAudioData listener via Capacitor", "Hook");

          const errorListener = await BackgroundServiceNative.addListener(
            "bleError",
            handleError
          );
          listenerRemovers.push(errorListener);
          logger.debug("Registered bleError listener via Capacitor", "Hook");

          logger.info("All BackgroundService event listeners registered successfully", "Hook");
        } else {
          logger.warn("BackgroundServiceNative.addListener not available, falling back to window events", "Hook");
          
          // Fallback to window events for web or if plugin not available
          const handleNativeEvent = (event: Event) => {
            const customEvent = event as CustomEvent;
            const eventName = customEvent.detail?.name || customEvent.type;
            const eventData = customEvent.detail || {};

            switch (eventName) {
              case "bleConnectionStateChanged":
                handleConnectionState(eventData);
                break;
              case "bleAudioData":
                handleAudioData(eventData);
                break;
              case "bleError":
                handleError(eventData);
                break;
            }
          };

          window.addEventListener("bleConnectionStateChanged", handleNativeEvent);
          window.addEventListener("bleAudioData", handleNativeEvent);
          window.addEventListener("bleError", handleNativeEvent);
        }
      } catch (error) {
        logger.error(
          "Error setting up native listeners",
          "Hook",
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };

    setupNativeListeners();

    return () => {
      // Cleanup: remove all registered listeners
      listenerRemovers.forEach(async (listener) => {
        try {
          await listener.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
      });

      // Also remove window event listeners if they were used as fallback
      const noop = () => {};
      window.removeEventListener("bleConnectionStateChanged", noop);
      window.removeEventListener("bleAudioData", noop);
      window.removeEventListener("bleError", noop);
    };
  }, [processAudio]);

  const initializeBle = useCallback(async () => {
    if (isInitialized.current) return;

    try {
      await bleManager.initialize({
        onConnectionStateChange: async (state) => {
          setConnectionState(state);
          setDeviceName(bleManager.getDeviceName());

          if (state === "connected") {
            timeSyncService.start();
            logger.debug("TimeSyncService started", "Hook");

            if (backgroundService.getIsEnabled()) {
              logger.debug("Foreground Service ya está activo", "Hook");
            } else {
              logger.warn(
                "⚠️ Foreground Service no está activo, intentando iniciarlo...",
                "Hook"
              );
              try {
                await backgroundService.enable();
                logger.info(
                  "Foreground Service iniciado después de conectar",
                  "Hook"
                );
              } catch (error) {
                logger.error(
                  "Error al habilitar servicio de background",
                  "Hook",
                  error instanceof Error ? error : new Error(String(error))
                );
                toast({
                  title: "Advertencia",
                  description:
                    "El servicio de background no pudo iniciarse. La conexión puede perderse en segundo plano.",
                  variant: "destructive",
                });
              }
            }

            if (!APP_CONFIG.BLE_MOCK_MODE) {
              const deviceId = bleManager.getDeviceId();
              if (
                deviceId &&
                deviceId.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)
              ) {
                try {
                  logger.debug(
                    `Connecting BLE device to native service: ${deviceId}`,
                    "Hook"
                  );
                  await backgroundService.connectBleDevice(deviceId);
                  logger.info(
                    `✅ BLE device connected to native background service: ${deviceId}`,
                    "Hook"
                  );
                } catch (error) {
                  logger.warn(
                    `Failed to connect BLE device to native background service: ${error instanceof Error ? error.message : String(error)}`,
                    "Hook"
                  );
                }
              } else {
                logger.debug(
                  `Skipping native BLE connection - invalid deviceId format: ${deviceId}`,
                  "Hook"
                );
              }
            } else {
              logger.debug(
                "Skipping native BLE connection - mock mode enabled",
                "Hook"
              );
            }

            toast({
              title: "Connected",
              description: `Connected to ${
                bleManager.getDeviceName() || "watch"
              }`,
            });
          } else if (state === "disconnected") {
            timeSyncService.stop();
            logger.debug("TimeSyncService stopped", "Hook");

            try {
              await backgroundService.disconnectBleDevice();
              logger.debug(
                "BLE device disconnected from native background service",
                "Hook"
              );
            } catch (error) {
              logger.warn(
                "Failed to disconnect BLE device from native background service",
                "Hook"
              );
            }

            try {
              await backgroundService.disable();
              logger.debug("Background mode disabled", "Hook");
            } catch (error) {
              logger.warn("Failed to disable background mode", "Hook");
            }

            activeSessionId.current = null;
            isProcessingRequest.current = false;

            if (processingTimeoutRef.current) {
              clearTimeout(processingTimeoutRef.current);
              processingTimeoutRef.current = null;
            }

            setVoiceState("idle");
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
          logger.debug(`onAudioComplete called. Mode: ${mode}`, "Hook");
          processAudio(adpcmData, mode);
        },
        onTimeRequest: () => {
          logger.debug("Time requested by watch (REQ_TIME)", "Hook");

          timeSyncService.handleTimeRequest();
        },
        onControlMessage: (command, data) => {
          logger.debug(`Control message received: ${command}`, "Hook");

          if (
            (command === "SET_PERSONA_JSON" || command === "SET_PERSONA") &&
            data
          ) {
            if (command === "SET_PERSONA" && !data.startsWith("{")) {
              logger.warn(
                "Legacy SET_PERSONA format received, consider using SET_PERSONA_JSON",
                "Hook"
              );
            }
            handlePersonaUpdateFromWatch(data);
          }
        },
        onError: (error) => {
          setLastError(error);

          if (
            !error.toLowerCase().includes("cancelled") &&
            !error.toLowerCase().includes("cancel")
          ) {
            toast({
              title: "Bluetooth Error",
              description: error,
              variant: "destructive",
            });
          }
        },
      });

      isInitialized.current = true;
    } catch (error) {
      logger.error(
        "BLE initialization failed",
        "Hook",
        error instanceof Error ? error : new Error(String(error))
      );
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
    if (
      lastError &&
      (lastError.toLowerCase().includes("cancelled") ||
        lastError.toLowerCase().includes("cancel"))
    ) {
      const timer = setTimeout(() => {
        setLastError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [lastError]);

  const testWithAudio = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setVoiceState("processing");
    setLastError(null);

    try {
      logger.debug(
        `Testing with audio WAV (simulating real mode): ${text}`,
        "Hook"
      );

      toast({
        title: "Processing...",
        description: "Sending audio to backend (test mode)",
      });

      logger.debug("Generating audio from text using TTS", "Hook");
      let wavBase64: string;

      try {
        wavBase64 = await textToSpeechWavSimple(text.trim());
        logger.debug(
          `Generated audio WAV from text, base64 length: ${wavBase64.length}`,
          "Hook"
        );
      } catch (ttsError) {
        logger.warn(
          "TTS failed (may need microphone permission), sending text directly instead",
          "Hook"
        );

        const apiResponse = await sendTranscription({
          text: text.trim(),
        });

        if (apiResponse.error) {
          throw new Error(apiResponse.error);
        }

        setLastTranscription(text.trim());
        await appendMessage({
          role: "user",
          text: text.trim(),
          timestamp: Date.now(),
        });
        logger.debug("User message saved to conversation history", "Hook");

        setLastResponse(apiResponse.text);
        setVoiceState("responding");
        logger.debug(
          `AI Response received: ${apiResponse.text?.substring(0, 100)}`,
          "Hook"
        );

        if (apiResponse.text) {
          await appendMessage({
            role: "assistant",
            text: apiResponse.text,
            timestamp: Date.now(),
          });
          logger.debug("AI response saved to conversation history", "Hook");
        }

        toast({
          title: "Success",
          description: "AI response received",
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
        role: "user",
        text: text.trim(),
        timestamp: Date.now(),
      });
      logger.debug("User message saved to conversation history", "Hook");

      setLastResponse(apiResponse.text);
      setVoiceState("responding");
      logger.debug(
        `AI Response received: ${apiResponse.text?.substring(0, 100)}`,
        "Hook"
      );

      if (apiResponse.text) {
        await appendMessage({
          role: "assistant",
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        logger.debug("AI response saved to conversation history", "Hook");
      }

      if (connectionState === "connected") {
        try {
          await bleManager.sendAiText(apiResponse.text);
          logger.debug("Test response sent to watch via BLE", "Hook");
        } catch (error) {
          logger.warn("Failed to send test response to watch", "Hook");
        }
      }

      toast({
        title: "Success",
        description: "AI response received",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to get AI response";
      logger.error("Test with audio failed", "Hook", new Error(errorMessage));
      setLastError(errorMessage);
      setVoiceState("idle");
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Please enter a message",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setVoiceState("processing");
    setLastError(null);

    try {
      logger.debug(`Sending text message to backend: ${text}`, "Hook");

      toast({
        title: "Processing...",
        description: "Sending message to AI backend",
      });

      const apiResponse = await sendTranscription({ text: text.trim() });

      if (apiResponse.error) {
        throw new Error(apiResponse.error);
      }

      setLastTranscription(text.trim());
      await appendMessage({
        role: "user",
        text: text.trim(),
        timestamp: Date.now(),
      });
      logger.debug("User message saved to conversation history", "Hook");

      setLastResponse(apiResponse.text);
      setVoiceState("responding");
      logger.debug(
        `AI Response received: ${apiResponse.text?.substring(0, 100)}`,
        "Hook"
      );

      if (apiResponse.text) {
        await appendMessage({
          role: "assistant",
          text: apiResponse.text,
          timestamp: Date.now(),
        });
        logger.debug("AI response saved to conversation history", "Hook");
      }

      toast({
        title: "Done",
        description: "AI response received",
      });
    } catch (error) {
      logger.error(
        "Text message failed",
        "Hook",
        error instanceof Error ? error : new Error(String(error))
      );
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send message";
      setLastError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setVoiceState("idle");
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

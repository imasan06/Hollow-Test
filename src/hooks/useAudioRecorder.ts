import { useState, useRef, useCallback } from "react";
import {
  encodeWavBase64,
  getAudioDuration,
  validateWavFormat,
} from "@/audio/wavEncoder";
import { sendTranscription } from "@/api";
import {
  appendMessage,
  formatConversationContext,
} from "@/storage/conversationStore";
import { logger } from "@/utils/logger";
import { Capacitor } from "@capacitor/core";
import { backgroundService, BackgroundServiceNative } from "@/services/backgroundService";
import { APP_CONFIG } from "@/config/app.config";
import { toast } from "@/hooks/use-toast";

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE;
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  isProcessing: boolean;
  lastTranscription: string | null;
  lastResponse: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  processRecordedAudio: () => Promise<void>;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastTranscription, setLastTranscription] = useState<string | null>(
    null
  );
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordedAudioRef = useRef<string | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setLastTranscription(null);
      setLastResponse(null);
      audioChunksRef.current = [];
      recordedAudioRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: NUM_CHANNELS,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const destination = audioContext.createMediaStreamDestination();

      const mediaRecorder = new MediaRecorder(destination.stream, {
        mimeType: "audio/webm",
        audioBitsPerSecond: SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE,
      });

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        source.disconnect();
        destination.disconnect();
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }
      };

      source.connect(destination);
      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);

      durationIntervalRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 0.1);
      }, 100);

      logger.debug("Recording started", "AudioRecorder");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to start recording";
      logger.error(
        "Failed to start recording",
        "AudioRecorder",
        err instanceof Error ? err : new Error(String(err))
      );
      setError(errorMessage);
      toast({
        title: "Recording Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (durationIntervalRef.current !== null) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      logger.debug("Recording stopped", "AudioRecorder");
    }
  }, [isRecording]);

  const convertBlobToWav = useCallback(
    async (audioBlob: Blob): Promise<string> => {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        let sourceSampleRate = audioBuffer.sampleRate;
        let samples: Float32Array;

        if (sourceSampleRate !== SAMPLE_RATE) {
          logger.debug(
            `Resampling from ${sourceSampleRate}Hz to ${SAMPLE_RATE}Hz`,
            "AudioRecorder"
          );

          const ratio = sourceSampleRate / SAMPLE_RATE;
          const newLength = Math.round(audioBuffer.length / ratio);
          samples = new Float32Array(newLength);

          for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(
              srcIndexFloor + 1,
              audioBuffer.length - 1
            );
            const t = srcIndex - srcIndexFloor;
            samples[i] =
              audioBuffer.getChannelData(0)[srcIndexFloor] * (1 - t) +
              audioBuffer.getChannelData(0)[srcIndexCeil] * t;
          }
        } else {
          samples = audioBuffer.getChannelData(0);
        }

        if (audioBuffer.numberOfChannels > 1) {
          const mono = new Float32Array(samples.length);
          for (let i = 0; i < samples.length; i++) {
            let sum = 0;
            for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
              sum += audioBuffer.getChannelData(ch)[i];
            }
            mono[i] = sum / audioBuffer.numberOfChannels;
          }
          samples = mono;
        }

        const int16Samples = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const wavBase64 = encodeWavBase64(int16Samples);

        const validation = validateWavFormat(wavBase64);
        if (!validation.valid) {
          throw new Error(`Invalid WAV format: ${validation.error}`);
        }

        logger.debug(
          `Audio converted: ${samples.length} samples, ${getAudioDuration(
            int16Samples.length
          ).toFixed(2)}s`,
          "AudioRecorder"
        );

        await audioContext.close();
        return wavBase64;
      } catch (err) {
        logger.error(
          "Failed to convert audio to WAV",
          "AudioRecorder",
          err instanceof Error ? err : new Error(String(err))
        );
        throw err;
      }
    },
    []
  );

  const processRecordedAudio = useCallback(async () => {
    if (audioChunksRef.current.length === 0) {
      setError("No audio recorded");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: "audio/webm",
      });

      logger.debug(
        `Processing recorded audio: ${audioBlob.size} bytes`,
        "AudioRecorder"
      );

      const wavBase64 = await convertBlobToWav(audioBlob);
      recordedAudioRef.current = wavBase64;

      // Use native processing on Android
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
        logger.debug("Using native audio processing", "AudioRecorder");
        
        // ⚠️ PROBLEMA: Los listeners aquí están duplicando el guardado de mensajes
        // ✅ SOLUCIÓN: Remover los listeners de aquí porque ya existen en useBle.ts
        // Los listeners en useBle.ts manejarán bleAudioProcessed, bleTranscription, y bleAudioError
        
        // ✅ FIX 1: Obtener el contexto ANTES de enviar a procesamiento nativo
        const { formatConversationContext } = await import(
          "@/storage/conversationStore"
        );
        const conversationContext = await formatConversationContext(false);
        
        logger.debug(
          `Context for native processing: ${conversationContext ? conversationContext.length : 0} chars`,
          "AudioRecorder"
        );

        // ✅ FIX 2: Process natively with context
        const result = await backgroundService.processAudioNative(
          wavBase64,
          conversationContext || "" // Pasar string vacío en lugar de undefined
        );
        
        if (!result.success) {
          throw new Error("Native processing failed");
        }

        // ✅ FIX 3: NO configurar listeners aquí - ya existen en useBle.ts
        // Los listeners en useBle.ts manejarán bleAudioProcessed, bleTranscription, y bleAudioError
        
        logger.debug("Native processing initiated with context", "AudioRecorder");
        // Don't set isProcessing to false here - wait for the result events
        return;
      }

      // Fallback to JavaScript processing (web or if native fails)
      logger.debug("Using JavaScript audio processing", "AudioRecorder");

      // ✅ FIX 4: Asegurar contexto en procesamiento JS
      const context = await formatConversationContext(false);
      logger.debug(
        `Context for AI request: ${context ? `${context.length} chars` : "empty"}`,
        "AudioRecorder"
      );

      const chatResponse = await sendTranscription({
        audio: wavBase64,
        context: context || "", // Pasar string vacío en lugar de undefined
      });

      if (chatResponse.error) {
        throw new Error(chatResponse.error);
      }

      const transcription = chatResponse.transcription || "";
      if (!transcription) {
        throw new Error("Backend did not return transcription");
      }

      setLastTranscription(transcription);
      logger.debug(`Backend transcription: ${transcription}`, "AudioRecorder");

      await appendMessage({
        role: "user",
        text: transcription,
        timestamp: Date.now(),
      });
      logger.debug(
        "User message saved to conversation history",
        "AudioRecorder"
      );

      const aiResponse = chatResponse.text || "";
      setLastResponse(aiResponse);

      if (aiResponse) {
        await appendMessage({
          role: "assistant",
          text: aiResponse,
          timestamp: Date.now(),
        });
        logger.debug(
          "AI response saved to conversation history",
          "AudioRecorder"
        );
      }

      logger.debug("Transcription completed", "AudioRecorder");
      toast({
        title: "Transcription Complete",
        description: "Audio processed successfully",
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to process audio";
      logger.error(
        "Failed to process recorded audio",
        "AudioRecorder",
        err instanceof Error ? err : new Error(String(err))
      );
      setError(errorMessage);
      toast({
        title: "Processing Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [convertBlobToWav]);

  return {
    isRecording,
    duration,
    isProcessing,
    lastTranscription,
    lastResponse,
    error,
    startRecording,
    stopRecording,
    processRecordedAudio,
  };
}

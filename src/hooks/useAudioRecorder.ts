import { useState, useRef, useCallback } from 'react';
import { encodeWavBase64, getAudioDuration, validateWavFormat } from '@/audio/wavEncoder';
import { sendTranscription, transcribeWithDeepgram } from '@/api';
import { appendMessage, formatConversationContext } from '@/storage/conversationStore';
import { logger } from '@/utils/logger';
import { APP_CONFIG } from '@/config/app.config';
import { toast } from '@/hooks/use-toast';

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE; // 16000 Hz
const NUM_CHANNELS = 1; // Mono
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
  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
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

      // Create AudioContext with target sample rate
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const destination = audioContext.createMediaStreamDestination();

      // Create MediaRecorder with the destination stream
      const mediaRecorder = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm',
        audioBitsPerSecond: SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE, // 256000 for 16kHz mono 16-bit
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
      mediaRecorder.start(100); // Collect data every 100ms

      setIsRecording(true);
      setDuration(0);

      // Update duration every 100ms
      durationIntervalRef.current = window.setInterval(() => {
        setDuration((prev) => prev + 0.1);
      }, 100);

      logger.debug('Recording started', 'AudioRecorder');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording';
      logger.error('Failed to start recording', 'AudioRecorder', err instanceof Error ? err : new Error(String(err)));
      setError(errorMessage);
      toast({
        title: 'Recording Error',
        description: errorMessage,
        variant: 'destructive',
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

      logger.debug('Recording stopped', 'AudioRecorder');
    }
  }, [isRecording]);

  const convertBlobToWav = useCallback(async (audioBlob: Blob): Promise<string> => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Resample if needed
      let sourceSampleRate = audioBuffer.sampleRate;
      let samples: Float32Array;

      if (sourceSampleRate !== SAMPLE_RATE) {
        logger.debug(`Resampling from ${sourceSampleRate}Hz to ${SAMPLE_RATE}Hz`, 'AudioRecorder');
        
        const ratio = sourceSampleRate / SAMPLE_RATE;
        const newLength = Math.round(audioBuffer.length / ratio);
        samples = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
          const srcIndex = i * ratio;
          const srcIndexFloor = Math.floor(srcIndex);
          const srcIndexCeil = Math.min(srcIndexFloor + 1, audioBuffer.length - 1);
          const t = srcIndex - srcIndexFloor;
          samples[i] = audioBuffer.getChannelData(0)[srcIndexFloor] * (1 - t) + audioBuffer.getChannelData(0)[srcIndexCeil] * t;
        }
      } else {
        samples = audioBuffer.getChannelData(0);
      }

      // Convert to mono if needed
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

      // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
      const int16Samples = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const wavBase64 = encodeWavBase64(int16Samples);

      // Validate format
      const validation = validateWavFormat(wavBase64);
      if (!validation.valid) {
        throw new Error(`Invalid WAV format: ${validation.error}`);
      }

      logger.debug(`Audio converted: ${samples.length} samples, ${getAudioDuration(int16Samples.length).toFixed(2)}s`, 'AudioRecorder');
      
      await audioContext.close();
      return wavBase64;
    } catch (err) {
      logger.error('Failed to convert audio to WAV', 'AudioRecorder', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }, []);

  const processRecordedAudio = useCallback(async () => {
    if (audioChunksRef.current.length === 0) {
      setError('No audio recorded');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Combine all audio chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      
      logger.debug(`Processing recorded audio: ${audioBlob.size} bytes`, 'AudioRecorder');

      // Convert to WAV base64
      const wavBase64 = await convertBlobToWav(audioBlob);
      recordedAudioRef.current = wavBase64;

      logger.debug('Sending audio to Deepgram for fast transcription...', 'AudioRecorder');

      // Step 1: Transcribe audio using Deepgram (very fast, ~100-300ms)
      const transcription = await transcribeWithDeepgram(wavBase64);

      if (!transcription) {
        throw new Error('Deepgram transcription returned empty result');
      }

      setLastTranscription(transcription);
      logger.debug(`Deepgram transcription: ${transcription}`, 'AudioRecorder');

        // Step 2: Save user message to conversation store
        await appendMessage({
          role: 'user',
          text: transcription,
          timestamp: Date.now(),
        });
        logger.debug('User message saved to conversation history', 'AudioRecorder');

        // Small delay to ensure persistence
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Step 3: Get conversation context AFTER saving the user message
        const context = await formatConversationContext();
        logger.debug(`Context for AI request: ${context ? `${context.length} chars` : 'empty'}`, 'AudioRecorder');

        // Step 4: Send to chat with context
        const chatResponse = await sendTranscription({
          text: transcription,
          context: context || undefined,
        });

        if (chatResponse.error) {
          throw new Error(chatResponse.error);
        }

        const aiResponse = chatResponse.text || '';
        setLastResponse(aiResponse);

        // Step 5: Save AI response to conversation store
        if (aiResponse) {
          await appendMessage({
            role: 'assistant',
            text: aiResponse,
            timestamp: Date.now(),
          });
          logger.debug('AI response saved to conversation history', 'AudioRecorder');
        }

        logger.debug('Transcription completed', 'AudioRecorder');
        toast({
          title: 'Transcription Complete',
          description: 'Audio processed successfully',
        });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process audio';
      logger.error('Failed to process recorded audio', 'AudioRecorder', err instanceof Error ? err : new Error(String(err)));
      setError(errorMessage);
      toast({
        title: 'Processing Error',
        description: errorMessage,
        variant: 'destructive',
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


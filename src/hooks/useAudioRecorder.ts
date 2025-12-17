
import { useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { encodeWavBase64, validateWavFormat } from '@/audio/wavEncoder';
import { logger } from '@/utils/logger';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ wavBase64: string; duration: number } | null>;
  cancelRecording: () => void;
  error: string | null;
}

const SAMPLE_RATE = 16000;


function audioBufferToPCM16(audioBuffer: AudioBuffer): Int16Array {
  const length = audioBuffer.length;
  const numChannels = audioBuffer.numberOfChannels;
  const pcm16 = new Int16Array(length * numChannels);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      pcm16[i * numChannels + ch] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
  }

  if (numChannels > 1) {
    const mono = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += pcm16[i * numChannels + ch];
      }
      mono[i] = Math.round(sum / numChannels);
    }
    return mono;
  }

  return pcm16;
}


export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      audioChunksRef.current = [];
      setDuration(0);


      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;


      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg')
          ? 'audio/ogg'
          : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 256000,
      });

      mediaRecorderRef.current = mediaRecorder;


      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };


      mediaRecorder.start(100);
      setIsRecording(true);
      startTimeRef.current = Date.now();


      durationIntervalRef.current = window.setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          setDuration(elapsed);
        }
      }, 100);

      logger.debug('Started recording', 'AudioRecorder');
    } catch (err: any) {
      logger.error('Failed to start recording', 'AudioRecorder', err instanceof Error ? err : new Error(String(err)));


      let errorMessage = 'Failed to start recording. ';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage += 'Please grant microphone permission in your device settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage += 'No microphone found on this device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage += 'Microphone is being used by another app.';
      } else {
        errorMessage += err.message || 'Please grant microphone permission.';
      }

      setError(errorMessage);
      setIsRecording(false);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<{ wavBase64: string; duration: number } | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !isRecording) {
        resolve(null);
        return;
      }


      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      const finalDuration = duration;

      mediaRecorderRef.current.onstop = async () => {
        try {

          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }


          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          logger.debug(`Recording stopped, blob size: ${audioBlob.size}`, 'AudioRecorder');


          const wavBase64 = await convertBlobToWav(audioBlob);

          setIsRecording(false);
          setDuration(0);
          startTimeRef.current = null;

          logger.debug(`Converted to WAV, base64 length: ${wavBase64.length}`, 'AudioRecorder');
          resolve({ wavBase64, duration: finalDuration });
        } catch (err: any) {
          logger.error('Failed to process recording', 'AudioRecorder', err instanceof Error ? err : new Error(String(err)));
          setError(err.message || 'Failed to process recording');
          setIsRecording(false);
          resolve(null);
        }
      };

      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    });
  }, [isRecording, duration]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    audioChunksRef.current = [];
    setIsRecording(false);
    setDuration(0);
    setError(null);
    startTimeRef.current = null;
    logger.debug('Recording cancelled', 'AudioRecorder');
  }, []);

  return {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    error,
  };
}


async function convertBlobToWav(audioBlob: Blob): Promise<string> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  logger.debug(`Decoded audio: ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels} channels, ${audioBuffer.length} samples`, 'AudioRecorder');

  let samples: Int16Array;
  if (Math.abs(audioBuffer.sampleRate - SAMPLE_RATE) > 1) {
    logger.debug(`Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`, 'AudioRecorder');
    samples = resampleAudioBuffer(audioBuffer, SAMPLE_RATE);
  } else {
    samples = audioBufferToPCM16(audioBuffer);
  }

  if (audioBuffer.numberOfChannels > 1) {
    logger.debug(`Converting ${audioBuffer.numberOfChannels} channels to mono`, 'AudioRecorder');
    const mono = new Int16Array(samples.length / audioBuffer.numberOfChannels);
    for (let i = 0; i < mono.length; i++) {
      let sum = 0;
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        sum += samples[i * audioBuffer.numberOfChannels + ch];
      }
      mono[i] = Math.round(sum / audioBuffer.numberOfChannels);
    }
    samples = mono;
  }

  if (samples.length === 0) {
    throw new Error('No audio samples after conversion');
  }

  logger.debug(`Final audio: ${samples.length} samples at ${SAMPLE_RATE}Hz mono (${(samples.length / SAMPLE_RATE).toFixed(2)}s)`, 'AudioRecorder');

  const wavBase64 = encodeWavBase64(samples);

  const validation = validateWavFormat(wavBase64);
  if (!validation.valid) {
    logger.error(`WAV validation failed: ${validation.error}`, 'AudioRecorder');
    throw new Error(`Invalid WAV format: ${validation.error}`);
  }

  logger.debug(`WAV encoded and validated: ${wavBase64.length} bytes base64, ${validation.sampleRate}Hz, ${validation.channels} channel(s)`, 'AudioRecorder');

  return wavBase64;
}


function resampleAudioBuffer(audioBuffer: AudioBuffer, targetSampleRate: number): Int16Array {
  const sourceSampleRate = audioBuffer.sampleRate;
  const ratio = sourceSampleRate / targetSampleRate;
  const sourceLength = audioBuffer.length;
  const targetLength = Math.floor(sourceLength / ratio);
  const numChannels = audioBuffer.numberOfChannels;
  const target = new Int16Array(targetLength * numChannels);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < targetLength; i++) {
      const sourceIndex = i * ratio;
      const sourceIndexFloor = Math.floor(sourceIndex);
      const sourceIndexCeil = Math.min(sourceIndexFloor + 1, sourceLength - 1);
      const t = sourceIndex - sourceIndexFloor;

      const sample = channelData[sourceIndexFloor] * (1 - t) + channelData[sourceIndexCeil] * t;
      const clamped = Math.max(-1, Math.min(1, sample));
      target[i * numChannels + ch] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }
  }

  if (numChannels > 1) {
    const mono = new Int16Array(targetLength);
    for (let i = 0; i < targetLength; i++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += target[i * numChannels + ch];
      }
      mono[i] = Math.round(sum / numChannels);
    }
    return mono;
  }

  return target;
}



import { useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { encodeWavBase64 } from '@/audio/wavEncoder';
import { logger } from '@/utils/logger';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ wavBase64: string; duration: number } | null>;
  cancelRecording: () => void;
  error: string | null;
}

const SAMPLE_RATE = 8000;


function audioBufferToPCM16(audioBuffer: AudioBuffer): Int16Array {
  const length = audioBuffer.length;
  const pcm16 = new Int16Array(length);
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < length; i++) {

    const sample = Math.max(-1, Math.min(1, channelData[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
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
        audioBitsPerSecond: 16000,
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
  // Create AudioContext
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });


  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);


  let samples: Int16Array;
  if (audioBuffer.sampleRate !== SAMPLE_RATE) {
    logger.debug(`Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`, 'AudioRecorder');
    samples = resampleAudioBuffer(audioBuffer, SAMPLE_RATE);
  } else {
    samples = audioBufferToPCM16(audioBuffer);
  }


  return encodeWavBase64(samples);
}


function resampleAudioBuffer(audioBuffer: AudioBuffer, targetSampleRate: number): Int16Array {
  const sourceSampleRate = audioBuffer.sampleRate;
  const ratio = sourceSampleRate / targetSampleRate;
  const sourceLength = audioBuffer.length;
  const targetLength = Math.floor(sourceLength / ratio);
  const target = new Int16Array(targetLength);
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const sourceIndexFloor = Math.floor(sourceIndex);
    const sourceIndexCeil = Math.min(sourceIndexFloor + 1, sourceLength - 1);
    const t = sourceIndex - sourceIndexFloor;


    const sample = channelData[sourceIndexFloor] * (1 - t) + channelData[sourceIndexCeil] * t;
    target[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }

  return target;
}


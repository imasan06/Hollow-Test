/**
 * Audio Recorder Hook
 * 
 * Records audio from the device microphone and converts it to WAV base64
 * for transcription. Works on both web and mobile (Capacitor).
 */

import { useState, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { encodeWavBase64 } from '@/audio/wavEncoder';

export interface UseAudioRecorderReturn {
  isRecording: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ wavBase64: string; duration: number } | null>;
  cancelRecording: () => void;
  error: string | null;
}

const SAMPLE_RATE = 8000; // 8kHz to match watch audio format

/**
 * Convert AudioBuffer to Int16Array (PCM16)
 */
function audioBufferToPCM16(audioBuffer: AudioBuffer): Int16Array {
  const length = audioBuffer.length;
  const pcm16 = new Int16Array(length);
  const channelData = audioBuffer.getChannelData(0); // Use first channel

  for (let i = 0; i < length; i++) {
    // Convert float32 (-1.0 to 1.0) to int16 (-32768 to 32767)
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }

  return pcm16;
}

/**
 * Record audio using MediaRecorder API (web and mobile)
 */
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

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      streamRef.current = stream;

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/ogg')
        ? 'audio/ogg'
        : 'audio/webm'; // Fallback

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000, // 16kbps for 8kHz audio
      });

      mediaRecorderRef.current = mediaRecorder;

      // Collect audio chunks
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      startTimeRef.current = Date.now();

      // Update duration every 100ms
      durationIntervalRef.current = window.setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          setDuration(elapsed);
        }
      }, 100);

      console.log('[AudioRecorder] Started recording');
    } catch (err: any) {
      console.error('[AudioRecorder] Failed to start recording:', err);
      
      // Provide more helpful error messages
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

      // Clear duration interval
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      const finalDuration = duration;

      mediaRecorderRef.current.onstop = async () => {
        try {
          // Stop all tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
          }

          // Combine audio chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          console.log('[AudioRecorder] Recording stopped, blob size:', audioBlob.size);

          // Convert to WAV
          const wavBase64 = await convertBlobToWav(audioBlob);
          
          setIsRecording(false);
          setDuration(0);
          startTimeRef.current = null;

          console.log('[AudioRecorder] Converted to WAV, base64 length:', wavBase64.length);
          resolve({ wavBase64, duration: finalDuration });
        } catch (err: any) {
          console.error('[AudioRecorder] Failed to process recording:', err);
          setError(err.message || 'Failed to process recording');
          setIsRecording(false);
          resolve(null);
        }
      };

      // Stop recording
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
    console.log('[AudioRecorder] Recording cancelled');
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

/**
 * Convert audio Blob (webm/ogg) to WAV base64
 */
async function convertBlobToWav(audioBlob: Blob): Promise<string> {
  // Create AudioContext
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });

  // Decode audio
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // Resample to 8kHz if needed
  let samples: Int16Array;
  if (audioBuffer.sampleRate !== SAMPLE_RATE) {
    console.log(`[AudioRecorder] Resampling from ${audioBuffer.sampleRate}Hz to ${SAMPLE_RATE}Hz`);
    samples = resampleAudioBuffer(audioBuffer, SAMPLE_RATE);
  } else {
    samples = audioBufferToPCM16(audioBuffer);
  }

  // Encode to WAV base64
  return encodeWavBase64(samples);
}

/**
 * Resample AudioBuffer to target sample rate
 */
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

    // Linear interpolation
    const sample = channelData[sourceIndexFloor] * (1 - t) + channelData[sourceIndexCeil] * t;
    target[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }

  return target;
}


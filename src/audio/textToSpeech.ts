/**
 * Text-to-Speech Audio Generator
 * 
 * Generates audio WAV from text using Web Speech API (SpeechSynthesis)
 * This allows testing by creating real audio that can be transcribed by the backend
 */

import { APP_CONFIG } from '@/config/app.config';
import { encodeWavBase64 } from './wavEncoder';

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE; // 8000 Hz

/**
 * Generate audio WAV base64 from text using Web Speech API
 * Uses MediaRecorder to capture system audio while SpeechSynthesis speaks
 * 
 * @param text - Text to convert to speech
 * @returns Promise resolving to WAV base64 string
 */
export async function textToSpeechWavSimple(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Check if SpeechSynthesis is available
    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis not available'));
      return;
    }

    console.log('[TTS] Generating audio from text:', text);

    // Request microphone permission and capture system audio
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        // Create MediaRecorder to capture audio
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm') 
            ? 'audio/webm' 
            : 'audio/ogg',
        });

        const audioChunks: Blob[] = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());

            // Combine all chunks
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            
            // Convert to WAV
            const wavBase64 = await convertAudioBlobToWav(audioBlob);
            
            console.log('[TTS] Generated audio WAV, base64 length:', wavBase64.length);
            resolve(wavBase64);
          } catch (error) {
            console.error('[TTS] Error converting audio:', error);
            stream.getTracks().forEach(track => track.stop());
            reject(error);
          }
        };

        mediaRecorder.onerror = (event) => {
          console.error('[TTS] MediaRecorder error:', event);
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('Failed to record audio'));
        };

        // Create SpeechSynthesis utterance
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES'; // Spanish
        utterance.rate = 0.9; // Slightly slower for better transcription
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
          console.log('[TTS] Speech started, starting recording...');
          mediaRecorder.start();
        };

        utterance.onend = () => {
          console.log('[TTS] Speech ended, stopping recording...');
          setTimeout(() => {
            mediaRecorder.stop();
          }, 500); // Small delay to capture final audio
        };

        utterance.onerror = (event) => {
          console.error('[TTS] Speech synthesis error:', event);
          mediaRecorder.stop();
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('Speech synthesis failed'));
        };

        // Start speaking (this will trigger onstart and start recording)
        speechSynthesis.speak(utterance);
      })
      .catch((error) => {
        console.error('[TTS] Failed to get user media:', error);
        reject(new Error('Microphone permission denied or not available'));
      });
  });
}

/**
 * Convert audio blob (WebM/Ogg) to WAV base64
 */
async function convertAudioBlobToWav(audioBlob: Blob): Promise<string> {
  // Create AudioContext
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });

  try {
    // Read blob as ArrayBuffer
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // Decode audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Get first channel (mono)
    const samples = audioBuffer.getChannelData(0);
    
    // Resample if needed (audioBuffer might be at different sample rate)
    let resampledSamples: Float32Array;
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      // Simple resampling (linear interpolation)
      const ratio = audioBuffer.sampleRate / SAMPLE_RATE;
      const newLength = Math.floor(samples.length / ratio);
      resampledSamples = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const index = Math.floor(srcIndex);
        const fraction = srcIndex - index;
        if (index + 1 < samples.length) {
          resampledSamples[i] = samples[index] * (1 - fraction) + samples[index + 1] * fraction;
        } else {
          resampledSamples[i] = samples[index];
        }
      }
    } else {
      resampledSamples = samples;
    }
    
    // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
    const int16Samples = new Int16Array(resampledSamples.length);
    for (let i = 0; i < resampledSamples.length; i++) {
      const sample = Math.max(-1, Math.min(1, resampledSamples[i]));
      int16Samples[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    
    // Encode to WAV base64
    const wavBase64 = encodeWavBase64(int16Samples);
    
    audioContext.close();
    return wavBase64;
  } catch (error) {
    audioContext.close();
    throw error;
  }
}


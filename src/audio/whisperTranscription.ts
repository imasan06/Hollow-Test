/**
 * External Speech-to-Text using OpenAI Whisper API
 * 
 * Provides high-quality audio transcription for cases where
 * Web Speech API is not available (e.g., Android native).
 * 
 * Requires OPENAI_API_KEY environment variable.
 */

import { Capacitor } from '@capacitor/core';

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';

/**
 * Get OpenAI API key from environment or config
 */
function getOpenAiApiKey(): string | null {
  // Try environment variable first (for web)
  if (typeof process !== 'undefined' && process.env) {
    const key = process.env.REACT_APP_OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (key) return key;
  }
  
  // Try window config (for runtime configuration)
  if (typeof window !== 'undefined' && (window as any).OPENAI_API_KEY) {
    return (window as any).OPENAI_API_KEY;
  }
  
  return null;
}

/**
 * Convert base64 WAV to Blob
 */
function base64ToBlob(base64: string, mimeType: string = 'audio/wav'): Blob {
  // Remove data URL prefix if present
  const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
  
  // Convert base64 to binary
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Transcribe audio using OpenAI Whisper API
 * 
 * @param wavBase64 - Base64 encoded WAV audio
 * @returns Promise resolving to transcribed text
 */
export async function transcribeWithWhisper(wavBase64: string): Promise<string> {
  const apiKey = getOpenAiApiKey();
  
  if (!apiKey) {
    throw new Error(
      'OpenAI API key not found. Please set REACT_APP_OPENAI_API_KEY or VITE_OPENAI_API_KEY environment variable, ' +
      'or set window.OPENAI_API_KEY at runtime.'
    );
  }
  
  console.log('[Whisper] Starting transcription...');
  console.log('[Whisper] Audio base64 length:', wavBase64.length);
  
  try {
    // Convert base64 to Blob
    const audioBlob = base64ToBlob(wavBase64, 'audio/wav');
    console.log('[Whisper] Audio blob size:', audioBlob.size, 'bytes');
    
    // Use fetch for both web and native (Capacitor WebView supports fetch)
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', WHISPER_MODEL);
    formData.append('language', 'en'); // Optional: specify language for better accuracy
    
    const platform = Capacitor.isNativePlatform() ? 'native' : 'web';
    console.log(`[Whisper] Using fetch API (platform: ${platform})`);
    
    const response = await fetch(WHISPER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        // Don't set Content-Type - browser/WebView will set it with boundary for FormData
      },
      body: formData,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }
    
    const data = await response.json();
    const transcript = data.text || '';
    console.log('[Whisper] ✅ Transcription successful:', transcript);
    return transcript;
  } catch (error: any) {
    console.error('[Whisper] Transcription failed:', error);
    throw new Error(`Whisper transcription failed: ${error.message}`);
  }
}

/**
 * Convert Blob to base64
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if Whisper API is available (has API key)
 */
export function isWhisperAvailable(): boolean {
  return getOpenAiApiKey() !== null;
}


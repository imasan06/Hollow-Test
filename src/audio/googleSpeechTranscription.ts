/**
 * Free Speech-to-Text using Google Cloud Speech-to-Text API
 * 
 * Provides FREE transcription (60 minutes/month free tier)
 * Perfect alternative to paid Whisper API.
 * 
 * Requires GOOGLE_CLOUD_API_KEY environment variable.
 * Get your API key from: https://console.cloud.google.com/apis/credentials
 */

import { Capacitor } from '@capacitor/core';

const GOOGLE_SPEECH_API_URL = 'https://speech.googleapis.com/v1/speech:recognize';

/**
 * Get Google Cloud API key from environment or config
 */
function getGoogleCloudApiKey(): string | null {
  // Try environment variable first (for web)
  if (typeof process !== 'undefined' && process.env) {
    const key = process.env.REACT_APP_GOOGLE_CLOUD_API_KEY || process.env.VITE_GOOGLE_CLOUD_API_KEY;
    if (key) return key;
  }
  
  // Try window config (for runtime configuration)
  if (typeof window !== 'undefined' && (window as any).GOOGLE_CLOUD_API_KEY) {
    return (window as any).GOOGLE_CLOUD_API_KEY;
  }
  
  return null;
}

/**
 * Convert base64 WAV to base64 for Google Speech API
 * Google Speech API expects base64 without data URL prefix
 */
function prepareBase64ForGoogle(base64: string): string {
  // Remove data URL prefix if present
  return base64.includes(',') ? base64.split(',')[1] : base64;
}

/**
 * Transcribe audio using Google Cloud Speech-to-Text API (FREE)
 * 
 * @param wavBase64 - Base64 encoded WAV audio
 * @returns Promise resolving to transcribed text
 */
export async function transcribeWithGoogleSpeech(wavBase64: string): Promise<string> {
  const apiKey = getGoogleCloudApiKey();
  
  if (!apiKey) {
    throw new Error(
      'Google Cloud API key not found. Please set REACT_APP_GOOGLE_CLOUD_API_KEY or VITE_GOOGLE_CLOUD_API_KEY environment variable, ' +
      'or set window.GOOGLE_CLOUD_API_KEY at runtime.'
    );
  }
  
  console.log('[GoogleSpeech] Starting transcription (FREE tier)...');
  console.log('[GoogleSpeech] Audio base64 length:', wavBase64.length);
  
  try {
    // Prepare base64 (remove data URL prefix)
    const audioBase64 = prepareBase64ForGoogle(wavBase64);
    
    // Google Speech API request format
    const requestBody = {
      config: {
        encoding: 'LINEAR16', // WAV format
        sampleRateHertz: 8000, // 8kHz - matches watch audio
        languageCode: 'es-ES', // Spanish (change to 'en-US' for English)
        alternativeLanguageCodes: ['en-US', 'es-ES'], // Support both Spanish and English
        enableAutomaticPunctuation: true,
        model: 'latest_long', // Best for longer audio
      },
      audio: {
        content: audioBase64,
      },
    };
    
    const platform = Capacitor.isNativePlatform() ? 'native' : 'web';
    console.log(`[GoogleSpeech] Using fetch API (platform: ${platform})`);
    
    const url = `${GOOGLE_SPEECH_API_URL}?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Google Speech API returns results in this format:
    // { results: [{ alternatives: [{ transcript: "...", confidence: 0.95 }] }] }
    if (!data.results || data.results.length === 0) {
      throw new Error('No transcription results returned');
    }
    
    // Get the best alternative from the first result
    const firstResult = data.results[0];
    if (!firstResult.alternatives || firstResult.alternatives.length === 0) {
      throw new Error('No transcription alternatives returned');
    }
    
    const transcript = firstResult.alternatives[0].transcript || '';
    const confidence = firstResult.alternatives[0].confidence || 0;
    
    console.log(`[GoogleSpeech] ✅ Transcription successful (confidence: ${(confidence * 100).toFixed(1)}%):`, transcript);
    return transcript;
  } catch (error: any) {
    console.error('[GoogleSpeech] Transcription failed:', error);
    throw new Error(`Google Speech transcription failed: ${error.message}`);
  }
}

/**
 * Check if Google Cloud Speech API is available (has API key)
 */
export function isGoogleSpeechAvailable(): boolean {
  return getGoogleCloudApiKey() !== null;
}


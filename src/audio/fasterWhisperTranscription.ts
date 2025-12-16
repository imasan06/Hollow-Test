/**
 * Faster-Whisper Transcription Service
 * 
 * Uses faster-whisper running on a backend server for high-quality,
 * fast transcription. Faster-whisper is 4x faster than OpenAI Whisper
 * and can run on your own server (free, no API costs).
 * 
 * Setup options:
 * 1. Deploy speaches (OpenAI-compatible server): https://github.com/ggerganov/speaches
 * 2. Deploy whisper-fastapi: https://github.com/ahmetoner/whisper-asr-webservice
 * 3. Create custom endpoint in your backend using faster-whisper
 */

const FASTER_WHISPER_ENDPOINT = import.meta.env.VITE_FASTER_WHISPER_ENDPOINT || '';

/**
 * Check if faster-whisper endpoint is configured
 */
export function isFasterWhisperAvailable(): boolean {
  return !!FASTER_WHISPER_ENDPOINT && FASTER_WHISPER_ENDPOINT.trim() !== '';
}

/**
 * Transcribe audio using faster-whisper backend endpoint
 * 
 * Expected endpoint format (OpenAI-compatible):
 * POST /v1/audio/transcriptions
 * Content-Type: multipart/form-data
 * Body: { file: <audio_file>, model: "whisper-1", language: "es" }
 * 
 * Response: { text: "transcribed text" }
 */
export async function transcribeWithFasterWhisper(wavBase64: string): Promise<string> {
  if (!isFasterWhisperAvailable()) {
    throw new Error('Faster-Whisper endpoint not configured. Set VITE_FASTER_WHISPER_ENDPOINT in .env');
  }

  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    const isNative = Capacitor.isNativePlatform();
    const startTime = performance.now();

    // Convert base64 to binary
    const binaryString = atob(wavBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const url = `${FASTER_WHISPER_ENDPOINT}/v1/audio/transcriptions`;

    // Try fetch first (works on web and may work on native if no CORS)
    // If fetch fails on native, fall back to CapacitorHttp with base64 JSON
    try {
      const audioBlob = new Blob([bytes], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'es');

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - browser will set it with boundary
      });

      const elapsed = performance.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[FasterWhisper] Server error:', response.status, errorText);
        throw new Error(`Faster-Whisper transcription failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.text) {
        console.error('[FasterWhisper] Invalid response format:', result);
        throw new Error('Faster-Whisper returned invalid response format');
      }

      console.log(`[FasterWhisper] ✅ Transcription successful (${elapsed.toFixed(0)}ms):`, result.text);
      return result.text.trim();

    } catch (fetchError: any) {
      // If fetch fails (e.g., CORS on native), try CapacitorHttp with base64 JSON
      if (isNative) {
        console.log('[FasterWhisper] Fetch failed, trying CapacitorHttp with base64 JSON...');
        
        try {
          const response = await CapacitorHttp.request({
            method: 'POST',
            url: url,
            headers: {
              'Content-Type': 'application/json',
            },
            data: {
              audio: wavBase64,
              model: 'whisper-1',
              language: 'es',
              format: 'base64',
            },
            connectTimeout: 30000,
            readTimeout: 60000,
          });

          const elapsed = performance.now() - startTime;

          if (response.status !== 200) {
            console.error('[FasterWhisper] Server error:', response.status, response.data);
            throw new Error(`Faster-Whisper transcription failed: ${response.status}`);
          }

          const result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
          
          if (!result.text) {
            console.error('[FasterWhisper] Invalid response format:', result);
            throw new Error('Faster-Whisper returned invalid response format');
          }

          console.log(`[FasterWhisper] ✅ Transcription successful via CapacitorHttp (${elapsed.toFixed(0)}ms):`, result.text);
          return result.text.trim();
        } catch (nativeError: any) {
          console.error('[FasterWhisper] Both fetch and CapacitorHttp failed');
          throw new Error(`Faster-Whisper transcription failed: ${fetchError.message}. Native fallback also failed: ${nativeError.message}`);
        }
      } else {
        // On web, if fetch fails, just throw the error
        throw fetchError;
      }
    }

  } catch (error: any) {
    console.error('[FasterWhisper] ❌ Transcription failed:', error);
    throw error;
  }
}

/**
 * Alternative: Custom endpoint format (if not OpenAI-compatible)
 * 
 * If your faster-whisper endpoint uses a different format, you can
 * customize this function to match your API.
 */
export async function transcribeWithFasterWhisperCustom(
  wavBase64: string,
  endpoint: string,
  customHeaders?: Record<string, string>
): Promise<string> {
  try {
    // Convert base64 to Blob
    const binaryString = atob(wavBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/wav' });

    // Create FormData
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.wav');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: customHeaders,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom Faster-Whisper endpoint failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Adjust based on your endpoint's response format
    // Common formats: { text: "..." }, { transcript: "..." }, { transcription: "..." }
    const transcript = result.text || result.transcript || result.transcription || result.result;
    
    if (!transcript) {
      throw new Error('Custom Faster-Whisper endpoint returned invalid response format');
    }

    return transcript.trim();

  } catch (error: any) {
    console.error('[FasterWhisper] ❌ Custom endpoint transcription failed:', error);
    throw error;
  }
}


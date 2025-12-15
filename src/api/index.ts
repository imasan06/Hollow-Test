/**
 * Backend API wrapper for Hollow 0W
 * 
 * Handles communication with the LLM backend service.
 * Audio is sent to backend for transcription and LLM processing.
 * Includes conversation context from previous messages.
 */

import { formatConversationContext } from '@/storage/conversationStore';
import { getActivePreset } from '@/storage/settingsStore';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Hollow backend endpoint
const API_ENDPOINT = 'https://hollow-backend.fly.dev';


export interface TranscribeRequest {
  audio?: string; // WAV base64
  text?: string;  // Already transcribed text
  rules?: string;
  baserules?: string;
  persona?: string;
  context?: string; // Conversation history context
}

export interface TranscribeResponse {
  text: string;
  transcription?: string;
  error?: string;
}

/**
 * Send audio or text to backend for transcription and LLM processing
 * Automatically includes conversation context from previous messages
 * 
 * @param request - Request with audio (WAV base64) or text
 * @returns Promise resolving to LLM response text
 */
export async function sendTranscription(request: TranscribeRequest): Promise<TranscribeResponse> {
  // Fetch conversation context (last 12 turns)
  const context = await formatConversationContext();
  
  // Load active persona preset from storage
  const activePreset = await getActivePreset();
  const persona = request.persona || activePreset.persona;
  const rules = request.rules || activePreset.rules || undefined;
  const baserules = request.baserules || activePreset.baseRules || undefined;
  
  // Log which preset is being used
  console.log(`[API] Using persona preset: "${activePreset.name}" (id: ${activePreset.id})`);
  
  // Build request with context (only include defined fields)
  // IMPORTANT: Backend might only accept 'audio', not 'text' directly
  // If backend doesn't accept 'text', we need to simulate what happens after audio transcription
  const requestWithContext: any = {};
  
  // For audio requests (real mode): send audio + context (exact format backend expects)
  // IMPORTANT: Backend expects audio to be transcribed, then uses transcription as input
  if (request.audio) {
    requestWithContext.audio = request.audio;
    
    // Log audio details for debugging
    console.log('[API] Audio details:', {
      base64Length: request.audio.length,
      estimatedBytes: Math.floor(request.audio.length * 0.75), // Base64 is ~33% larger
      startsWith: request.audio.substring(0, 20),
    });
    
    // If text is also provided (testing mode), include it
    // This allows testing: audio will be transcribed as empty, but text provides the input
    if (request.text) {
      requestWithContext.text = request.text;
      // Also add text to context as latest USER message (simulating post-transcription)
      if (context) {
        requestWithContext.context = context + '\n\nUSER: ' + request.text;
      } else {
        requestWithContext.context = 'USER: ' + request.text;
      }
    } else {
      // Normal audio mode: just include context as-is
      // Backend should transcribe audio and use transcription as the user input
      if (context) {
        requestWithContext.context = context;
      }
      // NOTE: Backend should extract transcription from audio and add it to context
      // If backend doesn't do this automatically, we may need to handle it differently
    }
  } 
  // For text requests (testing): 
  // IMPORTANT: Backend may expect text in different format
  // Try multiple formats to ensure compatibility
  else if (request.text) {
    const trimmedText = request.text.trim();
    
    // Strategy 1: Send text field directly (most common)
    requestWithContext.text = trimmedText;
    
    // Strategy 2: Also add to context as USER message (some backends expect this)
    if (context) {
      requestWithContext.context = context + '\n\nUSER: ' + trimmedText;
    } else {
      requestWithContext.context = 'USER: ' + trimmedText;
    }
    
    // Strategy 3: Some backends expect 'input' or 'message' field instead of 'text'
    // Uncomment if backend doesn't recognize 'text':
    // requestWithContext.input = trimmedText;
    // requestWithContext.message = trimmedText;
    
    console.log('[API] Text-only mode: Sending text field and context');
    console.log('[API] Text value:', trimmedText);
    console.log('[API] Request keys:', Object.keys(requestWithContext));
  }
  
  // Add persona and rules (loaded from storage or provided in request)
  if (persona) {
    requestWithContext.persona = persona;
  }
  if (rules) {
    requestWithContext.rules = rules;
  }
  if (baserules) {
    requestWithContext.baserules = baserules;
  }
  
  // Log the exact format being sent (for debugging)
  console.log('[API] Request format (matching real mode):', {
    hasAudio: !!requestWithContext.audio,
    hasText: !!requestWithContext.text,
    hasContext: !!requestWithContext.context,
    contextLength: requestWithContext.context?.length || 0,
    allKeys: Object.keys(requestWithContext),
  });
  
  // Debug: Verify text is included
  console.log('[API] Request payload debug:', {
    hasText: !!requestWithContext.text,
    textValue: requestWithContext.text,
    textType: typeof requestWithContext.text,
    allKeys: Object.keys(requestWithContext),
  });

  const logContent = request.text 
    ? `text: ${request.text.substring(0, 100)}...`
    : `audio: ${request.audio?.substring(0, 50)}...`;
  console.log('[API] Sending to backend:', logContent);
  
  if (context) {
    const contextLines = context.split('\n\n').length;
    console.log(`[API] Including conversation context: ${contextLines} previous messages`);
  } else {
    console.log('[API] No conversation history available (first message)');
  }
  
  try {
    const url = `${API_ENDPOINT}/transcribe`;
    const isNative = Capacitor.isNativePlatform();
    const origin = typeof window !== 'undefined' ? window.location.origin : 'N/A';
    const requestStart = performance.now();
    
    console.log('[API] Request URL:', url);
    console.log('[API] Environment:', {
      isNative: isNative,
      origin: origin,
      platform: Capacitor.getPlatform()
    });
    
    // ✅ CRITICAL: En Android/iOS SIEMPRE usar CapacitorHttp (bypasses CORS)
    // Incluso si window.location es localhost, en nativo debemos usar CapacitorHttp
    if (isNative) {
      console.log('[API] Native platform detected - using CapacitorHttp (bypasses CORS)');
      
      try {
        const nativeResponse = await CapacitorHttp.request({
          method: 'POST',
          url: url,
          headers: {
            'Content-Type': 'application/json',
          },
          data: requestWithContext,
          // Add timeout to prevent hanging requests
          connectTimeout: 30000, // 30 seconds
          readTimeout: 60000,    // 60 seconds for AI processing
        });

        const requestTime = performance.now() - requestStart;
        console.log('[API] CapacitorHttp response status:', nativeResponse.status, `(${requestTime.toFixed(2)}ms)`);
        
        if (nativeResponse.status >= 400) {
          const errorData = typeof nativeResponse.data === 'string' 
            ? JSON.parse(nativeResponse.data) 
            : nativeResponse.data;
          console.error('[API] Server error:', nativeResponse.status, errorData);
          throw new Error(`Server error: ${nativeResponse.status} - ${errorData?.error || 'Unknown error'}`);
        }

        // res.data puede venir como objeto o string
        const data = typeof nativeResponse.data === 'string' 
          ? JSON.parse(nativeResponse.data) 
          : nativeResponse.data;
        
        console.log('[API] CapacitorHttp response data keys:', Object.keys(data));
        console.log('[API] Response data:', {
          hasText: !!data.text,
          hasAnswer: !!data.answer,
          hasTranscription: !!data.transcription,
          hasError: !!data.error,
          transcription: data.transcription?.substring(0, 100),
          error: data.error,
        });
        
        // Normalize response: backend may return "answer" or "text"
        const normalizedData: TranscribeResponse = {
          text: data.text || data.answer || data.response || '',
          transcription: data.transcription,
          error: data.error,
        };
        
        // Log transcription if available (critical for debugging)
        if (data.transcription) {
          console.log('[API] ✅ Transcription received:', data.transcription);
        } else {
          console.warn('[API] ⚠️ No transcription in response - backend may not have transcribed audio');
        }
        
        console.log('[API] Received response:', normalizedData.text?.substring(0, 100) + '...');
        
        return normalizedData;
      } catch (nativeError: any) {
        console.error('[API] CapacitorHttp failed:', nativeError);
        // En nativo, NO debemos caer a fetch (tendría CORS)
        // Si CapacitorHttp falla, es un error real
        throw new Error(`Native HTTP request failed: ${nativeError?.message || 'Unknown error'}. This should not happen in production.`);
      }
    }
    
    // 🌐 En web browser: fetch normal (aquí sí puede haber CORS, pero es esperado)
    console.log('[API] Web browser detected - using fetch (CORS may apply)');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestWithContext),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    const requestTime = performance.now() - requestStart;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Server error:', response.status, errorText, `(${requestTime.toFixed(2)}ms)`);
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[API] Request completed successfully', `(${requestTime.toFixed(2)}ms)`);
    
    // Normalize response: backend may return "answer" or "text"
    const normalizedData: TranscribeResponse = {
      text: data.text || data.answer || data.response || '',
      transcription: data.transcription,
      error: data.error,
    };
    
    console.log('[API] Received response:', normalizedData.text?.substring(0, 100) + '...');
    
    return normalizedData;
  } catch (error) {
    console.error('[API] Request failed:', error);
    throw error;
  }
}

/**
 * Health check for the API
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const url = `${API_ENDPOINT}/health`;
    
    // En nativo: usar CapacitorHttp (bypasses CORS)
    if (Capacitor.isNativePlatform()) {
      try {
        const response = await CapacitorHttp.request({
          method: 'GET',
          url: url,
        });
        return response.status >= 200 && response.status < 300;
      } catch (error) {
        console.error('[API] Health check failed (native):', error);
        return false;
      }
    }
    
    // En web: usar fetch
    const response = await fetch(url, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    console.error('[API] Health check failed:', error);
    return false;
  }
}

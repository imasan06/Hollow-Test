/**
 * Backend API wrapper for Hollow 0W
 * 
 * Handles communication with the LLM backend service.
 * Audio is transcribed locally before sending to backend.
 * Backend expects: POST /transcribe with { user_id, transcript, persona, rules }
 * Header: X-User-Token: <user_id>
 */

import { formatConversationContext } from '@/storage/conversationStore';
import { getActivePreset } from '@/storage/settingsStore';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { transcribeWithWebSpeech } from '@/audio/speechRecognition';

// Hollow backend endpoint
const API_ENDPOINT = 'https://hollow-backend.fly.dev';
const USER_ID_STORAGE_KEY = 'hollow_user_id';


export interface TranscribeRequest {
  audio?: string; // WAV base64 (will be transcribed locally)
  text?: string;  // Already transcribed text
  rules?: string;
  baserules?: string;
  persona?: string;
  context?: string; // Conversation history context (for compatibility, but backend doesn't use it)
}

export interface TranscribeResponse {
  text: string; // Backend returns "answer" field, mapped to text
  transcription?: string; // Local transcription of audio
  error?: string;
}

/**
 * Get or generate a persistent user_id
 * Uses Capacitor Preferences to store the user_id across app sessions
 */
async function getUserId(): Promise<string> {
  try {
    const { value } = await Preferences.get({ key: USER_ID_STORAGE_KEY });
    
    if (value) {
      console.log('[API] Using existing user_id:', value);
      return value;
    }
    
    // Generate new user_id (UUID-like format)
    const newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await Preferences.set({ key: USER_ID_STORAGE_KEY, value: newUserId });
    console.log('[API] Generated new user_id:', newUserId);
    
    return newUserId;
  } catch (error) {
    console.error('[API] Error getting user_id:', error);
    // Fallback: generate a temporary user_id (not persisted)
    const fallbackUserId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.warn('[API] Using fallback user_id (not persisted):', fallbackUserId);
    return fallbackUserId;
  }
}

/**
 * Send audio or text to backend for LLM processing
 * Audio is transcribed locally using Web Speech API before sending to backend
 * Backend expects: POST /transcribe with { user_id, transcript, persona, rules }
 * Header: X-User-Token: <user_id>
 * 
 * @param request - Request with audio (WAV base64) or text
 * @returns Promise resolving to LLM response text
 */
export async function sendTranscription(request: TranscribeRequest): Promise<TranscribeResponse> {
  // Get or generate user_id
  const user_id = await getUserId();
  
  // Load active persona preset from storage
  const activePreset = await getActivePreset();
  const persona = request.persona || activePreset.persona || '';
  const rules = request.rules || activePreset.rules || '';
  
  // Log which preset is being used
  console.log(`[API] Using persona preset: "${activePreset.name}" (id: ${activePreset.id})`);
  
  let transcript = '';
  let localTranscription = '';
  
  // For audio requests: transcribe locally first
  if (request.audio) {
    console.log('[API] Audio provided, transcribing locally with Web Speech API...');
    console.log('[API] Audio base64 length:', request.audio.length);
    
    try {
      localTranscription = await transcribeWithWebSpeech(request.audio);
      transcript = localTranscription;
      console.log('[API] ✅ Local transcription successful:', transcript);
    } catch (error: any) {
      console.error('[API] ❌ Local transcription failed:', error);
      throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
  } 
  // For text requests: use text directly as transcript
  else if (request.text) {
    transcript = request.text.trim();
    console.log('[API] Using provided text as transcript:', transcript);
  } else {
    throw new Error('Either audio or text must be provided');
  }
  
  // Build backend request payload
  // Backend ONLY accepts: { user_id, transcript, persona, rules }
  // DO NOT send any extra fields (text, input, message, context) - backend will ignore transcript if extra fields are present
  const backendPayload = {
    user_id: user_id,
    transcript: transcript,
    persona: persona,
    rules: rules,
  };
  
  // Log final JSON payload being sent to backend
  console.log('[API] ========== FINAL BACKEND PAYLOAD ==========');
  console.log('[API] Endpoint: POST /transcribe');
  console.log('[API] Header X-User-Token:', user_id);
  console.log('[API] Payload JSON:', JSON.stringify(backendPayload, null, 2));
  console.log('[API] Payload fields:');
  console.log('[API]   - user_id:', backendPayload.user_id);
  console.log('[API]   - transcript:', backendPayload.transcript);
  console.log('[API]   - persona:', backendPayload.persona.substring(0, 100) + (backendPayload.persona.length > 100 ? '...' : ''));
  console.log('[API]   - rules:', backendPayload.rules || '(empty)');
  console.log('[API] ===========================================');
  
  try {
    const url = `${API_ENDPOINT}/transcribe`;
    const isNative = Capacitor.isNativePlatform();
    const requestStart = performance.now();
    
    // ✅ CRITICAL: En Android/iOS SIEMPRE usar CapacitorHttp (bypasses CORS)
    if (isNative) {
      console.log('[API] Native platform detected - using CapacitorHttp (bypasses CORS)');
      
      try {
        const nativeResponse = await CapacitorHttp.request({
          method: 'POST',
          url: url,
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': user_id,
          },
          data: backendPayload,
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
          
          console.error('[API] ========== SERVER ERROR ==========');
          console.error('[API] Status:', nativeResponse.status);
          console.error('[API] Error response type:', typeof nativeResponse.data);
          console.error('[API] Error response raw:', nativeResponse.data);
          console.error('[API] Error response keys:', errorData ? Object.keys(errorData) : 'no data');
          console.error('[API] Full error response:', JSON.stringify(errorData, null, 2));
          console.error('[API] Request URL:', url);
          console.error('[API] Request method: POST');
          console.error('[API] Request headers:', { 'Content-Type': 'application/json', 'X-User-Token': user_id });
          console.error('[API] Request payload:', JSON.stringify(backendPayload, null, 2));
          console.error('[API] ===================================');
          
          const errorMessage = errorData?.error || errorData?.message || (typeof errorData === 'string' ? errorData : JSON.stringify(errorData)) || 'Unknown error';
          throw new Error(`Server error: ${nativeResponse.status} - ${errorMessage}`);
        }

        // res.data puede venir como objeto o string
        const data = typeof nativeResponse.data === 'string' 
          ? JSON.parse(nativeResponse.data) 
          : nativeResponse.data;
        
        console.log('[API] ========== RESPONSE FROM BACKEND ==========');
        console.log('[API] Status:', nativeResponse.status);
        console.log('[API] Response data keys:', Object.keys(data));
        console.log('[API] Full response structure:', JSON.stringify(data, null, 2));
        
        // Backend returns { answer: string } (no transcription field, since we transcribed locally)
        const answer = data.answer ?? data.text ?? data.response ?? '';
        
        const normalizedData: TranscribeResponse = {
          text: answer,
          transcription: localTranscription, // Use local transcription if available
          error: data.error,
        };
        
        // Log final response
        if (normalizedData.text) {
          console.log('[API] ✅ Final response text:', normalizedData.text.substring(0, 200) + (normalizedData.text.length > 200 ? '...' : ''));
        } else {
          console.warn('[API] ⚠️ No response text - backend returned empty response');
        }
        
        if (normalizedData.error) {
          console.error('[API] ❌ Backend error:', normalizedData.error);
        }
        
        if (localTranscription) {
          console.log('[API] ✅ Local transcription (used as transcript):', localTranscription);
        }
        
        console.log('[API] ============================================');
        
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
        'X-User-Token': user_id,
      },
      body: JSON.stringify(backendPayload),
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
    
    // Backend returns { answer: string }
    const answer = data.answer ?? data.text ?? data.response ?? '';
    
    const normalizedData: TranscribeResponse = {
      text: answer,
      transcription: localTranscription, // Use local transcription if available
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

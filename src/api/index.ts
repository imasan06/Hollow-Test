import { formatConversationContext } from '@/storage/conversationStore';
import { getActivePreset } from '@/storage/settingsStore';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || 'https://hollow-backend.fly.dev';
const USER_ID_STORAGE_KEY = 'hollow_user_id';

// Deepgram transcription is now handled by the backend
// API key and URL removed - backend handles Deepgram integration

// OPTIMIZATION: Cache frequently accessed values to reduce Preferences calls (~50-100ms savings)
let cachedUserId: string | null = null;
let cachedBackendToken: string | null = null;
let cachedActivePreset: { id: string; name: string; persona: string; rules: string } | null = null;
let presetCacheTime = 0;
const PRESET_CACHE_TTL = 30000; // 30 seconds TTL for preset cache

function getBackendSharedToken(): string | null {
  // Use cached token if available
  if (cachedBackendToken) return cachedBackendToken;
  
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const token = import.meta.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) {
      cachedBackendToken = token;
      return token;
    }
  }

  if (typeof process !== 'undefined' && process.env) {
    const token = process.env.REACT_APP_BACKEND_SHARED_TOKEN || process.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) {
      cachedBackendToken = token;
      return token;
    }
  }

  if (typeof window !== 'undefined' && (window as any).BACKEND_SHARED_TOKEN) {
    cachedBackendToken = (window as any).BACKEND_SHARED_TOKEN;
    return cachedBackendToken;
  }

  return null;
}

export interface TranscribeRequest {
  audio?: string;
  text?: string;
  rules?: string;
  baserules?: string;
  persona?: string;
  context?: string;
}

export interface TranscribeResponse {
  text: string;
  transcription?: string;
  error?: string;
}

async function getUserId(): Promise<string> {
  // OPTIMIZATION: Return cached userId immediately if available (~20-50ms savings)
  if (cachedUserId) {
    return cachedUserId;
  }
  
  try {
    const { value } = await Preferences.get({ key: USER_ID_STORAGE_KEY });

    if (value) {
      cachedUserId = value;
      return value;
    }

    const newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await Preferences.set({ key: USER_ID_STORAGE_KEY, value: newUserId });
    cachedUserId = newUserId;

    return newUserId;
  } catch (error) {
    logger.error('Error getting user_id', 'API', error instanceof Error ? error : new Error(String(error)));

    const fallbackUserId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return fallbackUserId;
  }
}

// OPTIMIZATION: Get cached preset or fetch with TTL
async function getCachedActivePreset(): Promise<{ id: string; name: string; persona: string; rules: string }> {
  const now = Date.now();
  if (cachedActivePreset && (now - presetCacheTime) < PRESET_CACHE_TTL) {
    return cachedActivePreset;
  }
  
  const preset = await getActivePreset();
  cachedActivePreset = preset;
  presetCacheTime = now;
  return preset;
}

// Export function to invalidate cache when settings change
export function invalidateApiCache(): void {
  cachedActivePreset = null;
  presetCacheTime = 0;
}

// Track in-flight requests to prevent duplicates
const inFlightRequests = new Map<string, Promise<TranscribeResponse>>();

function getRequestKey(request: TranscribeRequest): string {
  // Create a more reliable key that ignores context variations
  const text = request.text || '';
  const audio = request.audio ? request.audio.substring(0, 50) : '';
  // Use a hash of context length instead of content to catch duplicates even if context slightly differs
  const contextHash = request.context ? `${request.context.length}_${request.context.split('\n\n').length}` : '';
  return `${text}_${audio}_${contextHash}`;
}

export async function sendTranscription(request: TranscribeRequest): Promise<TranscribeResponse> {
  // Check if there's already an in-flight request with the same parameters
  const requestKey = getRequestKey(request);
  if (inFlightRequests.has(requestKey)) {
    logger.debug('Duplicate request detected, reusing in-flight request', 'API');
    return inFlightRequests.get(requestKey)!;
  }

  const requestPromise = (async () => {
    try {
      // OPTIMIZATION: Fetch user_id and preset in parallel (~30-50ms savings)
      const [user_id, activePreset] = await Promise.all([
        getUserId(),
        getCachedActivePreset()
      ]);

      const persona = request.persona || activePreset.persona || '';
      const rules = request.rules || activePreset.rules || '';

      logger.debug(`Using persona preset: "${activePreset.name}"`, 'API');

    // Determine if we're sending audio or text
    const hasAudio = !!request.audio;
    const hasText = !!request.text;
    
    if (!hasAudio && !hasText) {
      throw new Error('Either audio or text must be provided');
    }

    const backendToken = getBackendSharedToken();
    if (!backendToken) {
      throw new Error(
        'Backend shared token not found. Please set VITE_BACKEND_SHARED_TOKEN environment variable.'
      );
    }

    // Check if in background for performance optimizations
    const isBackground = typeof document !== 'undefined' && (document.visibilityState === 'hidden' || !document.hasFocus());
    
    // OPTIMIZATION: Only fetch context if not provided
    // Context is often pre-fetched in parallel by callers for better performance
    let conversationContext = request.context;
    if (!conversationContext) {
      // Exclude last user message to avoid duplication with current transcript
      conversationContext = await formatConversationContext(true);
    }
    
    // Only log context details in foreground or dev mode
    if (!isBackground || import.meta.env.DEV) {
      if (conversationContext) {
        logger.debug(`Conversation context: ${conversationContext.length} chars`, 'API');
      } else {
        logger.warn('No conversation context available', 'API');
      }
    }

    // Build backend payload - send audio directly to backend for transcription
    const backendPayload: any = {
      user_id: user_id,
      persona: persona,
      rules: rules,
    };

    if (hasAudio) {
      // Send audio to backend - backend will transcribe with Deepgram
      logger.debug('Sending audio to backend for transcription', 'API');
      backendPayload.audio = request.audio;
    } else if (hasText) {
      // Send text directly
      backendPayload.transcript = request.text.trim();
      logger.debug('Using provided text as transcript', 'API');
    }

    if (conversationContext && conversationContext.trim().length > 0) {
      backendPayload.context = conversationContext;
      
      // Only log detailed context info in foreground or dev mode
      if (!isBackground || import.meta.env.DEV) {
        logger.debug(`Context added to payload (${conversationContext.length} chars)`, 'API');
      }
    }

    const url = `${API_ENDPOINT}/v1/chat`;
    const isNative = Capacitor.isNativePlatform();
    
    // TIMING: Chat API request
    const chatRequestStart = performance.now();
    // Increase timeouts when sending audio - backend needs to transcribe + process
    // Audio processing can take longer: upload + Deepgram transcription + AI response
    const connectTimeout = hasAudio 
      ? (isBackground ? 30000 : 60000)  // 30s/60s for audio (larger payload)
      : (isBackground ? 15000 : 30000); // 15s/30s for text only
    const readTimeout = hasAudio
      ? (isBackground ? 120000 : 180000) // 2min/3min for audio processing
      : (isBackground ? 45000 : 60000);  // 45s/60s for text only

    // Only log detailed info in foreground or dev mode
    if (!isBackground || import.meta.env.DEV) {
      logger.debug(`Sending chat request with payload keys: ${Object.keys(backendPayload).join(', ')}`, 'API');
      if (backendPayload.context) {
        logger.debug(`Payload includes context: ${backendPayload.context.length} chars`, 'API');
      }
    }

    if (isNative) {
      try {
        const nativeResponse = await CapacitorHttp.request({
          method: 'POST',
          url: url,
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': backendToken,
          },
          data: backendPayload,
          connectTimeout,
          readTimeout,
        });

        const chatRequestTime = performance.now() - chatRequestStart;
        logger.info(`[TIMING] Chat HTTP request: ${chatRequestTime.toFixed(2)}ms`, 'API');

        if (nativeResponse.status >= 400) {
          const errorData = typeof nativeResponse.data === 'string'
            ? JSON.parse(nativeResponse.data)
            : nativeResponse.data;

          const errorMessage = errorData?.error || errorData?.message || (typeof errorData === 'string' ? errorData : JSON.stringify(errorData)) || 'Unknown error';
          logger.error(`Server error: ${nativeResponse.status}`, 'API', new Error(errorMessage));
          throw new Error(`Server error: ${nativeResponse.status} - ${errorMessage}`);
        }

        const data = typeof nativeResponse.data === 'string'
          ? JSON.parse(nativeResponse.data)
          : nativeResponse.data;

        const answer = data.reply ?? data.answer ?? data.text ?? data.response ?? '';
        // Backend may return transcription if audio was sent
        const transcription = data.transcription ?? data.transcript ?? (hasText ? request.text : '');

        const normalizedData: TranscribeResponse = {
          text: answer,
          transcription: transcription,
          error: data.error,
        };

        if (!normalizedData.text) {
          logger.warn('Backend returned empty response', 'API');
        }

        if (normalizedData.error) {
          logger.error('Backend error in response', 'API', new Error(normalizedData.error));
        }

        return normalizedData;
      } catch (nativeError: any) {
        logger.error('Native HTTP request failed', 'API', nativeError instanceof Error ? nativeError : new Error(String(nativeError)));
        throw new Error(`Native HTTP request failed: ${nativeError?.message || 'Unknown error'}`);
      }
    }

    const controller = new AbortController();
    // Use optimized timeout based on background state and request type
    // Audio requests need more time: upload + transcription + AI processing
    const fetchTimeout = hasAudio
      ? (isBackground ? 120000 : 180000) // 2min/3min for audio
      : (isBackground ? 45000 : 60000);  // 45s/60s for text
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Token': backendToken,
      },
      body: JSON.stringify(backendPayload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const chatRequestTime = performance.now() - chatRequestStart;

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Server error: ${response.status}`, 'API', new Error(errorText));
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    logger.info(`[TIMING] Chat HTTP request: ${chatRequestTime.toFixed(2)}ms`, 'API');

    const answer = data.reply ?? data.answer ?? data.text ?? data.response ?? '';
    // Backend may return transcription if audio was sent
    const transcription = data.transcription ?? data.transcript ?? (hasText ? request.text : '');

    const normalizedData: TranscribeResponse = {
      text: answer,
      transcription: transcription,
      error: data.error,
    };

    return normalizedData;
    } catch (error) {
      logger.error('Transcription request failed', 'API', error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      // Remove from in-flight requests when done
      inFlightRequests.delete(requestKey);
    }
  })();

  // Store the promise for deduplication
  inFlightRequests.set(requestKey, requestPromise);
  
  return requestPromise;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const url = `${API_ENDPOINT}/health`;

    if (Capacitor.isNativePlatform()) {
      try {
        const response = await CapacitorHttp.request({
          method: 'GET',
          url: url,
        });
        return response.status >= 200 && response.status < 300;
      } catch (error) {
        logger.error('Health check failed (native)', 'API', error instanceof Error ? error : new Error(String(error)));
        return false;
      }
    }

    const response = await fetch(url, {
      method: 'GET',
    });
    return response.ok;
  } catch (error) {
    logger.error('Health check failed', 'API', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

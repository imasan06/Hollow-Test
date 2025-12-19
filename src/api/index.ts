import { formatConversationContext } from '@/storage/conversationStore';
import { getActivePreset } from '@/storage/settingsStore';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { logger } from '@/utils/logger';

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || 'https://hollow-backend.fly.dev';
const USER_ID_STORAGE_KEY = 'hollow_user_id';

function getBackendSharedToken(): string | null {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const token = import.meta.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) return token;
  }

  if (typeof process !== 'undefined' && process.env) {
    const token = process.env.REACT_APP_BACKEND_SHARED_TOKEN || process.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) return token;
  }

  if (typeof window !== 'undefined' && (window as any).BACKEND_SHARED_TOKEN) {
    return (window as any).BACKEND_SHARED_TOKEN;
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
  try {
    const { value } = await Preferences.get({ key: USER_ID_STORAGE_KEY });

    if (value) {
      logger.debug('Using existing user_id', 'API');
      return value;
    }

    const newUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await Preferences.set({ key: USER_ID_STORAGE_KEY, value: newUserId });
    logger.debug('Generated new user_id', 'API');

    return newUserId;
  } catch (error) {
    logger.error('Error getting user_id', 'API', error instanceof Error ? error : new Error(String(error)));

    const fallbackUserId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.warn('Using fallback user_id (not persisted)', 'API');
    return fallbackUserId;
  }
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
      const user_id = await getUserId();

      const activePreset = await getActivePreset();
      const persona = request.persona || activePreset.persona || '';
      const rules = request.rules || activePreset.rules || '';

      logger.debug(`Using persona preset: "${activePreset.name}"`, 'API');

    let transcript = '';
    let localTranscription = '';

    if (request.audio) {
      logger.debug('Audio provided, sending to backend for transcription', 'API');

      const backendToken = getBackendSharedToken();
      if (!backendToken) {
        throw new Error('Backend token not available');
      }

      const transcribeUrl = `${API_ENDPOINT}/transcribe/base64`;
      const isNative = Capacitor.isNativePlatform();

      // Check if app is in background for optimized timeouts
      const isBackground = document.visibilityState === 'hidden' || (typeof window !== 'undefined' && !document.hasFocus());
      const connectTimeout = isBackground ? 15000 : 30000; // 15s in background, 30s in foreground
      const readTimeout = isBackground ? 45000 : 60000; // 45s in background, 60s in foreground

      const audioPayload = {
        audio: request.audio,
        ...(user_id && { user_id }),
      };

      // TIMING: Transcription API request
      const transcribeRequestStart = performance.now();
      let transcribeResponse;
      if (isNative) {
        transcribeResponse = await CapacitorHttp.request({
          method: 'POST',
          url: transcribeUrl,
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': backendToken,
          },
          data: audioPayload,
          connectTimeout,
          readTimeout,
        });
      } else {
        const response = await fetch(transcribeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Token': backendToken,
          },
          body: JSON.stringify(audioPayload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        transcribeResponse = {
          status: response.status,
          data: await response.json(),
        };
      }
      const transcribeRequestTime = performance.now() - transcribeRequestStart;
      logger.info(`[TIMING] Transcription HTTP request: ${transcribeRequestTime.toFixed(2)}ms`, 'API');

      if (transcribeResponse.status >= 200 && transcribeResponse.status < 300) {
        const data = typeof transcribeResponse.data === 'string'
          ? JSON.parse(transcribeResponse.data)
          : transcribeResponse.data;

        const backendTranscript = data.transcript || data.text || data.transcription || data.result || '';

        if (backendTranscript) {
          transcript = backendTranscript;
          localTranscription = backendTranscript;
          logger.debug('Backend transcription successful', 'API');
        } else {
          throw new Error('Backend /transcribe/base64 returned empty transcript');
        }
      } else {
        const errorData = typeof transcribeResponse.data === 'string'
          ? JSON.parse(transcribeResponse.data)
          : transcribeResponse.data;
        logger.error(`Backend transcription failed: ${transcribeResponse.status}`, 'API', new Error(JSON.stringify(errorData)));
        throw new Error(`Backend /transcribe/base64 returned status ${transcribeResponse.status}: ${JSON.stringify(errorData)}`);
      }
    } else if (request.text) {
      transcript = request.text.trim();
      logger.debug('Using provided text as transcript', 'API');
    } else {
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

    const backendPayload: any = {
      user_id: user_id,
      transcript: transcript,
      persona: persona,
      rules: rules,
    };

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
    const connectTimeout = isBackground ? 15000 : 30000; // 15s in background, 30s in foreground
    const readTimeout = isBackground ? 45000 : 60000; // 45s in background, 60s in foreground

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

        const normalizedData: TranscribeResponse = {
          text: answer,
          transcription: localTranscription,
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
    // Use optimized timeout based on background state
    const fetchTimeout = isBackground ? 45000 : 60000;
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

    const normalizedData: TranscribeResponse = {
      text: answer,
      transcription: localTranscription,
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

import { formatConversationContext } from "@/storage/conversationStore";
import { getActivePreset } from "@/storage/settingsStore";
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { logger } from "@/utils/logger";

const API_ENDPOINT =
  import.meta.env.VITE_API_ENDPOINT || "https://hollow-backend.fly.dev";
const USER_ID_STORAGE_KEY = "hollow_user_id";

let cachedUserId: string | null = null;
let cachedBackendToken: string | null = null;
let cachedActivePreset: {
  id: string;
  name: string;
  persona: string;
  rules: string;
} | null = null;
let presetCacheTime = 0;
const PRESET_CACHE_TTL = 30000;

export function getBackendSharedToken(): string | null {
  if (cachedBackendToken) return cachedBackendToken;

  if (typeof import.meta !== "undefined" && import.meta.env) {
    const token = import.meta.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) {
      cachedBackendToken = token;
      return token;
    }
  }

  if (typeof process !== "undefined" && process.env) {
    const token =
      process.env.REACT_APP_BACKEND_SHARED_TOKEN ||
      process.env.VITE_BACKEND_SHARED_TOKEN;
    if (token) {
      cachedBackendToken = token;
      return token;
    }
  }

  if (typeof window !== "undefined" && (window as any).BACKEND_SHARED_TOKEN) {
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
  if (cachedUserId) {
    return cachedUserId;
  }

  try {
    const { value } = await Preferences.get({ key: USER_ID_STORAGE_KEY });

    if (value) {
      cachedUserId = value;
      return value;
    }

    const newUserId = `user_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    await Preferences.set({ key: USER_ID_STORAGE_KEY, value: newUserId });
    cachedUserId = newUserId;

    return newUserId;
  } catch (error) {
    logger.error(
      "Error getting user_id",
      "API",
      error instanceof Error ? error : new Error(String(error))
    );

    const fallbackUserId = `temp_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    return fallbackUserId;
  }
}

async function getCachedActivePreset(): Promise<{
  id: string;
  name: string;
  persona: string;
  rules: string;
}> {
  const now = Date.now();
  if (cachedActivePreset && now - presetCacheTime < PRESET_CACHE_TTL) {
    return cachedActivePreset;
  }

  const preset = await getActivePreset();
  cachedActivePreset = preset;
  presetCacheTime = now;
  return preset;
}

export function invalidateApiCache(): void {
  cachedActivePreset = null;
  presetCacheTime = 0;
}

const inFlightRequests = new Map<string, Promise<TranscribeResponse>>();

function getRequestKey(request: TranscribeRequest): string {
  const text = request.text || "";
  const audio = request.audio ? request.audio.substring(0, 50) : "";

  const contextHash = request.context
    ? `${request.context.length}_${request.context.split("\n\n").length}`
    : "";
  return `${text}_${audio}_${contextHash}`;
}

export async function sendTranscription(
  request: TranscribeRequest
): Promise<TranscribeResponse> {
  const requestKey = getRequestKey(request);
  if (inFlightRequests.has(requestKey)) {
    logger.debug(
      "Duplicate request detected, reusing in-flight request",
      "API"
    );
    return inFlightRequests.get(requestKey)!;
  }

  const requestPromise = (async () => {
    try {
      const [user_id, activePreset] = await Promise.all([
        getUserId(),
        getCachedActivePreset(),
      ]);

      const persona = request.persona || activePreset.persona || "";
      const rules = request.rules || activePreset.rules || "";

      logger.debug(`Using persona preset: "${activePreset.name}"`, "API");

      const hasAudio = !!request.audio;
      const hasText = !!request.text;

      if (!hasAudio && !hasText) {
        throw new Error("Either audio or text must be provided");
      }

      const backendToken = getBackendSharedToken();
      if (!backendToken) {
        throw new Error(
          "Backend shared token not found. Please set VITE_BACKEND_SHARED_TOKEN environment variable."
        );
      }

      const isBackground =
        typeof document !== "undefined" &&
        (document.visibilityState === "hidden" || !document.hasFocus());

      let conversationContext = request.context;
      if (!conversationContext) {
        conversationContext = await formatConversationContext(true);
      }

      if (!isBackground || import.meta.env.DEV) {
        if (conversationContext) {
          logger.debug(
            `Conversation context: ${conversationContext.length} chars`,
            "API"
          );
        } else {
          logger.warn("No conversation context available", "API");
        }
      }

      const backendPayload: any = {
        user_id: user_id,
        persona: persona,
        rules: rules,
      };

      if (hasAudio) {
        logger.debug("Sending audio to backend for transcription", "API");
        backendPayload.audio = request.audio;
      } else if (hasText) {
        backendPayload.transcript = request.text.trim();
        logger.debug("Using provided text as transcript", "API");
      }

      if (conversationContext && conversationContext.trim().length > 0) {
        backendPayload.context = conversationContext;

        if (!isBackground || import.meta.env.DEV) {
          logger.debug(
            `Context added to payload (${conversationContext.length} chars)`,
            "API"
          );
        }
      }

      const url = `${API_ENDPOINT}/v1/chat`;
      const isNative = Capacitor.isNativePlatform();

      const chatRequestStart = performance.now();

      const connectTimeout = hasAudio
        ? isBackground
          ? 30000
          : 60000
        : isBackground
        ? 15000
        : 30000;
      const readTimeout = hasAudio
        ? isBackground
          ? 120000
          : 180000
        : isBackground
        ? 45000
        : 60000;

      if (!isBackground || import.meta.env.DEV) {
        logger.debug(
          `Sending chat request with payload keys: ${Object.keys(
            backendPayload
          ).join(", ")}`,
          "API"
        );
        if (backendPayload.context) {
          logger.debug(
            `Payload includes context: ${backendPayload.context.length} chars`,
            "API"
          );
        }
      }

      if (isNative) {
        try {
          const nativeResponse = await CapacitorHttp.request({
            method: "POST",
            url: url,
            headers: {
              "Content-Type": "application/json",
              "X-User-Token": backendToken,
            },
            data: backendPayload,
            connectTimeout,
            readTimeout,
          });

          const chatRequestTime = performance.now() - chatRequestStart;
          logger.info(
            `[TIMING] Chat HTTP request: ${chatRequestTime.toFixed(2)}ms`,
            "API"
          );

          if (nativeResponse.status >= 400) {
            const errorData =
              typeof nativeResponse.data === "string"
                ? JSON.parse(nativeResponse.data)
                : nativeResponse.data;

            const errorMessage =
              errorData?.error ||
              errorData?.message ||
              (typeof errorData === "string"
                ? errorData
                : JSON.stringify(errorData)) ||
              "Unknown error";
            logger.error(
              `Server error: ${nativeResponse.status}`,
              "API",
              new Error(errorMessage)
            );
            throw new Error(
              `Server error: ${nativeResponse.status} - ${errorMessage}`
            );
          }

          const data =
            typeof nativeResponse.data === "string"
              ? JSON.parse(nativeResponse.data)
              : nativeResponse.data;

          const answer =
            data.reply ?? data.answer ?? data.text ?? data.response ?? "";

          const transcription =
            data.transcription ??
            data.transcript ??
            (hasText ? request.text : "");

          const normalizedData: TranscribeResponse = {
            text: answer,
            transcription: transcription,
            error: data.error,
          };

          if (!normalizedData.text) {
            logger.warn("Backend returned empty response", "API");
          }

          if (normalizedData.error) {
            logger.error(
              "Backend error in response",
              "API",
              new Error(normalizedData.error)
            );
          }

          return normalizedData;
        } catch (nativeError: any) {
          logger.error(
            "Native HTTP request failed",
            "API",
            nativeError instanceof Error
              ? nativeError
              : new Error(String(nativeError))
          );
          throw new Error(
            `Native HTTP request failed: ${
              nativeError?.message || "Unknown error"
            }`
          );
        }
      }

      const controller = new AbortController();

      const fetchTimeout = hasAudio
        ? isBackground
          ? 120000
          : 180000
        : isBackground
        ? 45000
        : 60000;
      const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Token": backendToken,
        },
        body: JSON.stringify(backendPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const chatRequestTime = performance.now() - chatRequestStart;

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          `Server error: ${response.status}`,
          "API",
          new Error(errorText)
        );
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      logger.info(
        `[TIMING] Chat HTTP request: ${chatRequestTime.toFixed(2)}ms`,
        "API"
      );

      const answer =
        data.reply ?? data.answer ?? data.text ?? data.response ?? "";

      const transcription =
        data.transcription ?? data.transcript ?? (hasText ? request.text : "");

      const normalizedData: TranscribeResponse = {
        text: answer,
        transcription: transcription,
        error: data.error,
      };

      return normalizedData;
    } catch (error) {
      logger.error(
        "Transcription request failed",
        "API",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, requestPromise);

  return requestPromise;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const url = `${API_ENDPOINT}/health`;

    if (Capacitor.isNativePlatform()) {
      try {
        const response = await CapacitorHttp.request({
          method: "GET",
          url: url,
        });
        return response.status >= 200 && response.status < 300;
      } catch (error) {
        logger.error(
          "Health check failed (native)",
          "API",
          error instanceof Error ? error : new Error(String(error))
        );
        return false;
      }
    }

    const response = await fetch(url, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    logger.error(
      "Health check failed",
      "API",
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}

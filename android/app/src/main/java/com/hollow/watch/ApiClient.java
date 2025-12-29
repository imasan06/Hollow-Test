package com.hollow.watch;

import android.util.Log;
import okhttp3.*;
import org.json.JSONObject;
import org.json.JSONException;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * HTTP client for making API requests to the backend
 * Handles transcription and chat requests
 */
public class ApiClient {
    private static final String TAG = "ApiClient";
    private static final String DEFAULT_API_ENDPOINT = "https://hollow-backend.fly.dev";
    private static final int CONNECT_TIMEOUT_SECONDS = 30;
    private static final int READ_TIMEOUT_SECONDS = 120;
    
    // Connection pool configuration for better connection reuse
    // Keep connections alive for 10 minutes (default is 5 minutes)
    private static final int CONNECTION_POOL_MAX_IDLE_CONNECTIONS = 5;
    private static final long CONNECTION_POOL_KEEP_ALIVE_DURATION_MINUTES = 10;
    
    // Shared connection pool across all ApiClient instances for better reuse
    private static final ConnectionPool connectionPool = new ConnectionPool(
        CONNECTION_POOL_MAX_IDLE_CONNECTIONS,
        CONNECTION_POOL_KEEP_ALIVE_DURATION_MINUTES,
        TimeUnit.MINUTES
    );
    
    // Shared OkHttpClient instance for connection reuse
    private static OkHttpClient sharedHttpClient;
    
    private final OkHttpClient httpClient;
    private final String apiEndpoint;
    private final String backendToken;
    
    public ApiClient(String backendToken) {
        this(backendToken, DEFAULT_API_ENDPOINT);
    }
    
    public ApiClient(String backendToken, String apiEndpoint) {
        this.backendToken = backendToken;
        this.apiEndpoint = apiEndpoint;
        
        // Use shared client for better connection reuse
        synchronized (ApiClient.class) {
            if (sharedHttpClient == null) {
                sharedHttpClient = new OkHttpClient.Builder()
                    .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .writeTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true) // Enable automatic retry on connection failure
                    .connectionPool(connectionPool) // Use shared connection pool
                    .build();
            }
        }
        
        this.httpClient = sharedHttpClient;
    }
    
    /**
     * Pre-warm the HTTP connection by making a lightweight request
     * This helps reduce latency for the first real request after inactivity
     * Call this periodically (e.g., every 5 minutes) to keep connection alive
     * 
     * Note: This runs in a background thread and failures are non-critical.
     * The connection will be established on the first real request if pre-warming fails.
     */
    public void prewarmConnection() {
        new Thread(() -> {
            try {
                // Make a minimal chat request to establish and keep the connection alive
                // This ensures TCP/TLS handshake is done before the first real request
                JSONObject payload = new JSONObject();
                payload.put("user_id", "prewarm");
                payload.put("transcript", "ping");
                
                Request request = new Request.Builder()
                    .url(apiEndpoint + "/v1/chat")
                    .post(RequestBody.create(
                        payload.toString(),
                        MediaType.parse("application/json")
                    ))
                    .addHeader("Content-Type", "application/json")
                    .addHeader("X-User-Token", backendToken)
                    .build();
                
                try (Response response = httpClient.newCall(request).execute()) {
                    // Connection is now warm - TCP/TLS handshake completed
                    // We don't care about the response, just that the connection was established
                    Log.d(TAG, "Connection pre-warmed successfully");
                }
            } catch (Exception e) {
                // Pre-warming failed, but that's okay - connection will be established on first real request
                // This is non-critical and shouldn't be logged as an error
                Log.d(TAG, "Connection pre-warming skipped (non-critical): " + e.getClass().getSimpleName());
            }
        }).start();
    }
    
    public static class ChatResponse {
        public final String text;
        public final String transcription;
        public final String error;
        
        public ChatResponse(String text, String transcription, String error) {
            this.text = text;
            this.transcription = transcription;
            this.error = error;
        }
    }
    
    /**
     * Send transcription-only request (separate from LLM)
     * This allows separating audio upload from LLM processing for better performance
     * @param audioBase64 Base64 encoded WAV audio
     * @param userId User ID
     * @return Transcription response with transcription text, or null if error
     */
    public String sendTranscriptionOnly(String audioBase64, String userId) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("user_id", userId);
            payload.put("audio", audioBase64);
            
            String url = apiEndpoint + "/v1/transcribe"; // Assuming separate endpoint exists
            RequestBody body = RequestBody.create(
                payload.toString(),
                MediaType.parse("application/json")
            );
            
            Request request = new Request.Builder()
                .url(url)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .addHeader("X-User-Token", backendToken)
                .build();
            
            Log.d(TAG, "Sending transcription-only request to: " + url);
            long startTime = System.currentTimeMillis();
            try (Response response = httpClient.newCall(request).execute()) {
                long duration = System.currentTimeMillis() - startTime;
                
                if (!response.isSuccessful()) {
                    Log.e(TAG, "Transcription request failed: " + response.code());
                    return null;
                }
                
                String responseBody = response.body() != null ? response.body().string() : "{}";
                Log.d(TAG, "Transcription received in " + duration + "ms");
                
                JSONObject json = new JSONObject(responseBody);
                String transcription = json.optString("transcription", null);
                if (transcription == null || transcription.isEmpty()) {
                    transcription = json.optString("transcript", null);
                }
                
                return transcription;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in transcription-only request: " + e.getMessage(), e);
            return null;
        }
    }
    
    /**
     * Send text-only chat request (after transcription)
     * This allows separating transcription from LLM processing
     * @param transcription Transcribed text
     * @param userId User ID
     * @param persona Persona string
     * @param rules Rules string
     * @param baseRules Base rules string
     * @param context Optional conversation context
     * @return ChatResponse with text and error
     */
    public ChatResponse sendTextChatRequest(
        String transcription,
        String userId,
        String persona,
        String rules,
        String baseRules,
        String context
    ) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("user_id", userId);
            payload.put("transcript", transcription); // Use transcript field for text-only
            
            if (persona != null && !persona.isEmpty()) {
                payload.put("persona", persona);
            }
            if (rules != null && !rules.isEmpty()) {
                payload.put("rules", rules);
            }
            if (baseRules != null && !baseRules.isEmpty()) {
                payload.put("baserules", baseRules);
            }
            if (context != null && !context.isEmpty()) {
                try {
                    org.json.JSONArray contextArray = new org.json.JSONArray(context);
                    payload.put("context", contextArray);
                    Log.d(TAG, "Context sent as JSON array with " + contextArray.length() + " messages");
                } catch (org.json.JSONException e) {
                    payload.put("context", context);
                    Log.d(TAG, "Context sent as plain text (" + context.length() + " chars)");
                }
            }
            
            String url = apiEndpoint + "/v1/chat";
            RequestBody body = RequestBody.create(
                payload.toString(),
                MediaType.parse("application/json")
            );
            
            Request request = new Request.Builder()
                .url(url)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .addHeader("X-User-Token", backendToken)
                .build();
            
            Log.d(TAG, "Sending text-only chat request to: " + url);
            int payloadSize = payload.toString().length();
            int contextSize = context != null ? context.length() : 0;
            Log.d(TAG, "Text chat payload: " + payloadSize + " chars (" + (payloadSize / 1024) + " KB)");
            Log.d(TAG, "  Transcription: " + transcription.length() + " chars");
            Log.d(TAG, "  Context: " + contextSize + " chars (" + (contextSize / 1024) + " KB)");
            
            long startTime = System.currentTimeMillis();
            try (Response response = httpClient.newCall(request).execute()) {
                long duration = System.currentTimeMillis() - startTime;
                
                if (!response.isSuccessful()) {
                    String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                    Log.e(TAG, "Text chat request failed: " + response.code() + " - " + errorBody);
                    return new ChatResponse(null, null, "HTTP " + response.code() + ": " + errorBody);
                }
                
                String responseBody = response.body() != null ? response.body().string() : "{}";
                Log.d(TAG, "Text chat response received in " + duration + "ms");
                
                JSONObject json = new JSONObject(responseBody);
                String text = json.optString("reply", null);
                if (text == null || text.isEmpty()) {
                    text = json.optString("answer", null);
                }
                if (text == null || text.isEmpty()) {
                    text = json.optString("text", null);
                }
                if (text == null || text.isEmpty()) {
                    text = json.optString("response", null);
                }
                
                String error = json.optString("error", null);
                return new ChatResponse(text, transcription, error); // Include transcription in response
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in text chat request: " + e.getMessage(), e);
            return new ChatResponse(null, null, "Error: " + e.getMessage());
        }
    }
    
    /**
     * Send audio transcription and chat request (combined - current implementation)
     * @param audioBase64 Base64 encoded WAV audio
     * @param userId User ID
     * @param persona Persona string
     * @param rules Rules string
     * @param baseRules Base rules string
     * @param context Optional conversation context
     * @return ChatResponse with text, transcription, and error
     */
    public ChatResponse sendAudioRequest(
        String audioBase64,
        String userId,
        String persona,
        String rules,
        String baseRules,
        String context
    ) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("user_id", userId);
            payload.put("audio", audioBase64);
            
            if (persona != null && !persona.isEmpty()) {
                payload.put("persona", persona);
            }
            if (rules != null && !rules.isEmpty()) {
                payload.put("rules", rules);
            }
            if (baseRules != null && !baseRules.isEmpty()) {
                payload.put("baserules", baseRules);
            }
            if (context == null) {
                Log.d(TAG, "Context is null - not sending context to backend");
            } else if (context.isEmpty()) {
                Log.d(TAG, "Context is empty - not sending context to backend");
            } else {
                // Context can be either JSON string (array) or formatted text
                // Try to parse as JSON first, if it fails, treat as plain text
                try {
                    org.json.JSONArray contextArray = new org.json.JSONArray(context);
                    payload.put("context", contextArray);
                    Log.d(TAG, "Context sent as JSON array with " + contextArray.length() + " messages");
                } catch (org.json.JSONException e) {
                    // If not valid JSON, send as string (formatted text)
                    payload.put("context", context);
                    Log.d(TAG, "Context sent as plain text (" + context.length() + " chars)");
                }
            }
            
            String url = apiEndpoint + "/v1/chat";
            RequestBody body = RequestBody.create(
                payload.toString(),
                MediaType.parse("application/json")
            );
            
            Request request = new Request.Builder()
                .url(url)
                .post(body)
                .addHeader("Content-Type", "application/json")
                .addHeader("X-User-Token", backendToken)
                .build();
            
            Log.d(TAG, "Sending audio request to: " + url);
            int payloadSize = payload.toString().length();
            int audioSize = audioBase64 != null ? audioBase64.length() : 0;
            int contextSize = context != null ? context.length() : 0;
            Log.d(TAG, "Request payload breakdown:");
            Log.d(TAG, "  Total payload: " + payloadSize + " chars (" + (payloadSize / 1024) + " KB)");
            Log.d(TAG, "  Audio (base64): " + audioSize + " chars (" + (audioSize / 1024) + " KB)");
            Log.d(TAG, "  Context: " + contextSize + " chars (" + (contextSize / 1024) + " KB)");
            Log.d(TAG, "  Other fields: ~" + ((payloadSize - audioSize - contextSize) / 1024) + " KB");
            
            // Execute immediately - no retries, no delays
            Log.d(TAG, "Attempting connection...");
            long connectionStartTime = System.currentTimeMillis();
            long requestStartTime = connectionStartTime;
            try (Response response = httpClient.newCall(request).execute()) {
                long connectionTime = System.currentTimeMillis() - connectionStartTime;
                Log.d(TAG, "  Connection established in " + connectionTime + "ms");
                
                long responseStartTime = System.currentTimeMillis();
                if (!response.isSuccessful()) {
                    String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                    long totalTime = System.currentTimeMillis() - requestStartTime;
                    Log.e(TAG, "API request failed: " + response.code() + " - " + errorBody + " (total: " + totalTime + "ms)");
                    return new ChatResponse(null, null, "HTTP " + response.code() + ": " + errorBody);
                }
                
                String responseBody = response.body() != null ? response.body().string() : "{}";
                long responseTime = System.currentTimeMillis() - responseStartTime;
                long totalTime = System.currentTimeMillis() - requestStartTime;
                
                Log.d(TAG, "API request timing:");
                Log.d(TAG, "  Connection: " + connectionTime + "ms");
                Log.d(TAG, "  Response read: " + responseTime + "ms");
                Log.d(TAG, "  Total: " + totalTime + "ms");
                Log.d(TAG, "  Response size: " + responseBody.length() + " chars (" + (responseBody.length() / 1024) + " KB)");
                
                JSONObject json = new JSONObject(responseBody);
                
                // Extract response text (try multiple possible keys)
                String text = json.optString("reply", null);
                if (text == null || text.isEmpty()) {
                    text = json.optString("answer", null);
                }
                if (text == null || text.isEmpty()) {
                    text = json.optString("text", null);
                }
                if (text == null || text.isEmpty()) {
                    text = json.optString("response", null);
                }
                
                // Extract transcription
                String transcription = json.optString("transcription", null);
                if (transcription == null || transcription.isEmpty()) {
                    transcription = json.optString("transcript", null);
                }
                
                // Extract error if any
                String error = json.optString("error", null);
                
                return new ChatResponse(text, transcription, error);
            }
        } catch (java.net.SocketTimeoutException e) {
            Log.e(TAG, "Request timeout: " + e.getMessage(), e);
            return new ChatResponse(null, null, "Request timeout: " + e.getMessage());
        } catch (javax.net.ssl.SSLException e) {
            Log.e(TAG, "SSL error: " + e.getMessage(), e);
            return new ChatResponse(null, null, "SSL error: " + e.getMessage());
        } catch (IOException e) {
            Log.e(TAG, "Network error: " + e.getMessage(), e);
            return new ChatResponse(null, null, "Network error: " + e.getMessage());
        } catch (JSONException e) {
            Log.e(TAG, "JSON error: " + e.getMessage(), e);
            return new ChatResponse(null, null, "JSON error: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Unexpected error: " + e.getMessage(), e);
            return new ChatResponse(null, null, "Unexpected error: " + e.getMessage());
        }
    }
}


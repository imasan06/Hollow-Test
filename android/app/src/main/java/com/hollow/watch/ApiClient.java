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
    private static final int MAX_RETRIES = 3;
    private static final long RETRY_DELAY_MS = 1000;
    
    private final OkHttpClient httpClient;
    private final String apiEndpoint;
    private final String backendToken;
    
    public ApiClient(String backendToken) {
        this(backendToken, DEFAULT_API_ENDPOINT);
    }
    
    public ApiClient(String backendToken, String apiEndpoint) {
        this.backendToken = backendToken;
        this.apiEndpoint = apiEndpoint;
        
        // Configure OkHttp with retry and better SSL handling
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true) // Enable automatic retry on connection failure
            .build();
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
     * Send audio transcription and chat request
     * @param audioBase64 Base64 encoded WAV audio
     * @param userId User ID
     * @param persona Persona string
     * @param rules Rules string
     * @param context Optional conversation context
     * @return ChatResponse with text, transcription, and error
     */
    public ChatResponse sendAudioRequest(
        String audioBase64,
        String userId,
        String persona,
        String rules,
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
            if (context != null && !context.isEmpty()) {
                payload.put("context", context);
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
            Log.d(TAG, "Request payload size: " + payloadSize + " chars (audio: " + audioSize + " chars)");
            
            // Retry logic for SSL/connection errors
            Exception lastException = null;
            for (int attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    if (attempt > 1) {
                        Log.d(TAG, "Retry attempt " + attempt + " of " + MAX_RETRIES);
                        Thread.sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
                    }
                    
                    Log.d(TAG, "Attempting connection (attempt " + attempt + ")...");
                    long startTime = System.currentTimeMillis();
                    try (Response response = httpClient.newCall(request).execute()) {
                        long duration = System.currentTimeMillis() - startTime;
                        
                        if (!response.isSuccessful()) {
                            String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                            Log.e(TAG, "API request failed: " + response.code() + " - " + errorBody);
                            return new ChatResponse(null, null, "HTTP " + response.code() + ": " + errorBody);
                        }
                        
                        String responseBody = response.body() != null ? response.body().string() : "{}";
                        Log.d(TAG, "API response received in " + duration + "ms");
                        
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
                } catch (javax.net.ssl.SSLException | java.net.SocketException | java.io.EOFException e) {
                    lastException = e;
                    Log.w(TAG, "Connection error on attempt " + attempt + ": " + e.getMessage());
                    if (attempt < MAX_RETRIES) {
                        continue; // Retry
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return new ChatResponse(null, null, "Request interrupted");
                }
            }
            
            // All retries failed
            if (lastException != null) {
                throw lastException;
            }
            // This should never happen, but compiler needs it
            return new ChatResponse(null, null, "All retry attempts failed");
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


package com.hollow.watch;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import androidx.core.app.NotificationCompat;
import java.util.concurrent.atomic.AtomicBoolean;
import android.content.SharedPreferences;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class BackgroundService extends Service {
    private static final String CHANNEL_ID = "HollowWatchBackgroundChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final String WAKE_LOCK_TAG = "HollowWatch::BLEWakeLock";
    private static final String EXTRA_DEVICE_ADDRESS = "device_address";
    private static final String BLE_HANDLER_THREAD = "HollowWatch::BLEHandler";
    
    // Protocol constants (must match ESP32 firmware)
    private static final String PROTOCOL_START_VOICE = "START_V";
    private static final String PROTOCOL_START_SILENT = "START_S";
    private static final String PROTOCOL_END = "END";
    private static final String PROTOCOL_REQ_TIME = "REQ_TIME";
    
    private PowerManager.WakeLock wakeLock;
    private BleConnectionManager bleManager;
    private static volatile BleConnectionManager staticBleManager; // Static reference for static methods
    private String connectedDeviceAddress;
    private HandlerThread bleHandlerThread;
    private Handler bleHandler;
    private AtomicBoolean isProcessingAudio = new AtomicBoolean(false);
    
    // Audio buffering for protocol handling
    private java.util.List<byte[]> audioBuffer = new java.util.ArrayList<>();
    private boolean isVoiceMode = false;
    private String currentMode = "VOICE"; // "VOICE" or "SILENT"
    
    // HTTP connection pre-warming to reduce first request latency after inactivity
    private ApiClient sharedApiClient;
    private Handler prewarmHandler;
    private Runnable prewarmRunnable;
    private static final long PREWARM_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d("BackgroundService", "onCreate() called");
        try {
            // Aumentar prioridad del proceso para evitar que sea matado
            Process.setThreadPriority(Process.THREAD_PRIORITY_FOREGROUND);
            
            // Crear HandlerThread para procesamiento BLE de alta prioridad
            // OPTIMIZACIÓN: Iniciar thread inmediatamente
            bleHandlerThread = new HandlerThread(BLE_HANDLER_THREAD, Process.THREAD_PRIORITY_FOREGROUND);
            bleHandlerThread.start();
            bleHandler = new Handler(bleHandlerThread.getLooper());
            
            // OPTIMIZACIÓN: Iniciar BleConnectionManager en paralelo con otras inicializaciones
            // Usar postAtFrontOfQueue para máxima prioridad
            bleHandler.postAtFrontOfQueue(() -> {
                bleManager = new BleConnectionManager(BackgroundService.this);
                staticBleManager = bleManager; // Store static reference
                bleManager.setEventListener(new BleConnectionManager.BleEventListener() {
                    @Override
                    public void onConnectionStateChanged(boolean connected) {
                        android.util.Log.d("BackgroundService", "BLE connection state changed: " + connected);
                        logToFile("BLE connection: " + (connected ? "CONNECTED" : "DISCONNECTED"));
                        updateNotification(connected);
                        notifyJavaScript("bleConnectionStateChanged", connected);
                        
                        // Start/stop HTTP connection pre-warming based on BLE connection
                        if (connected) {
                            startConnectionPrewarming();
                        } else {
                            stopConnectionPrewarming();
                        }
                    }
                    
                    @Override
                    public void onCharacteristicChanged(byte[] data) {
                        android.util.Log.d("BackgroundService", "BLE data received: " + data.length + " bytes");
                        logToFile("BLE data received: " + data.length + " bytes");
                        processAudioData(data);
                    }
                    
                    @Override
                    public void onError(String error) {
                        android.util.Log.e("BackgroundService", "BLE error: " + error);
                        logToFile("BLE ERROR: " + error);
                        notifyJavaScript("bleError", error);
                    }
                });
            });
            
            // OPTIMIZACIÓN: Estas operaciones corren en paralelo con la inicialización de BLE
            createNotificationChannel();
            acquireWakeLock();
            
            android.util.Log.d("BackgroundService", "Service created successfully");
            logToFile("=== SERVICE CREATED ===");
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error in onCreate: " + e.getMessage(), e);
            logToFile("ERROR in onCreate: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d("BackgroundService", "onStartCommand() called with startId: " + startId);
        logToFile("=== SERVICE STARTED ===");
        
        try {
            if (intent != null) {
                // Manejar acción de desconexión
                String action = intent.getAction();
                if ("DISCONNECT_BLE".equals(action)) {
                    android.util.Log.d("BackgroundService", "Disconnect BLE requested");
                    disconnectBleDevice();
                } else {
                    // Obtener dirección del dispositivo BLE si se proporciona
                    if (intent.hasExtra(EXTRA_DEVICE_ADDRESS)) {
                        connectedDeviceAddress = intent.getStringExtra(EXTRA_DEVICE_ADDRESS);
                        android.util.Log.d("BackgroundService", "Device address received: " + connectedDeviceAddress);
                        
                        // Conectar al dispositivo BLE si tenemos el gestor y la dirección
                        if (bleManager != null && connectedDeviceAddress != null && !connectedDeviceAddress.isEmpty()) {
                            android.util.Log.d("BackgroundService", "Attempting to connect to BLE device");
                            boolean connected = bleManager.connectToDevice(connectedDeviceAddress);
                            if (!connected) {
                                android.util.Log.w("BackgroundService", "Failed to initiate BLE connection");
                            }
                        }
                    }
                }
            }
            
            Intent notificationIntent = new Intent(this, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );

            int iconResId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
            if (iconResId == 0) {
                iconResId = android.R.drawable.ic_dialog_info;
                android.util.Log.w("BackgroundService", "Using default icon, ic_launcher not found");
            }

            boolean isBleConnected = bleManager != null && bleManager.isConnected();
            String notificationText = isBleConnected 
                ? "Conectado al reloj - Mantén la app minimizada" 
                : "Manteniendo conexión con el reloj";
            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Hollow Watch")
                .setContentText(notificationText)
                .setSmallIcon(iconResId)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .build();

            android.util.Log.d("BackgroundService", "Starting foreground service with notification");
            startForeground(NOTIFICATION_ID, notification);
            android.util.Log.d("BackgroundService", "Foreground service started successfully");

            // START_STICKY hace que el servicio se reinicie automáticamente si Android lo mata
            return START_STICKY;
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error in onStartCommand: " + e.getMessage(), e);
            return START_STICKY;
        }
    }
    
    private void updateNotification(boolean isConnected) {
        try {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        int iconResId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
        if (iconResId == 0) {
            iconResId = android.R.drawable.ic_dialog_info;
        }

            String notificationText = isConnected 
                ? "Conectado al reloj - Mantén la app minimizada" 
                : "Manteniendo conexión con el reloj";
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Hollow Watch")
                .setContentText(notificationText)
            .setSmallIcon(iconResId)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX) // Máxima prioridad
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE) // Android 14+
            .build();

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error updating notification: " + e.getMessage(), e);
        }
    }

    @Override
    public void onDestroy() {
        android.util.Log.d("BackgroundService", "onDestroy() called");
        logToFile("=== SERVICE DESTROYED ===");
        
        // Stop connection pre-warming
        stopConnectionPrewarming();
        
        // Limpiar conexión BLE en el handler thread
        if (bleHandler != null && bleManager != null) {
            bleHandler.post(() -> {
                if (bleManager != null) {
                    bleManager.cleanup();
                    bleManager = null;
                    staticBleManager = null; // Clear static reference
                }
            });
        } else {
            staticBleManager = null; // Clear static reference if handler not available
        }
        
        // Detener handler thread
        if (bleHandlerThread != null) {
            bleHandlerThread.quitSafely();
            try {
                bleHandlerThread.join(1000);
            } catch (InterruptedException e) {
                android.util.Log.e("BackgroundService", "Error joining handler thread", e);
            }
            bleHandlerThread = null;
            bleHandler = null;
        }
        
        releaseWakeLock();
        super.onDestroy();
    }
    
    /**
     * Procesa datos de audio directamente en el servicio nativo (alta prioridad)
     * Maneja el protocolo BLE: START_V/START_S -> chunks -> END
     * Solo envía audio completo a JavaScript cuando se recibe END
     */
    private void processAudioData(byte[] data) {
        bleHandler.post(() -> {
            try {
                // Try to decode as text to check for control messages
                String message = null;
                try {
                    String decoded = new String(data, "UTF-8").trim();
                    // Check if it's printable ASCII (control message)
                    if (decoded.matches("^[\\x20-\\x7E]+$")) {
                        message = decoded;
                    }
                } catch (Exception e) {
                    // Not a text message, treat as binary audio data
                }
                
                // Handle protocol messages
                if (message != null) {
                    if (message.equals(PROTOCOL_REQ_TIME)) {
                        android.util.Log.d("BackgroundService", "REQ_TIME received - ignoring (handled by bleManager)");
                        return;
                    }
                    
                    if (message.startsWith("SET_PERSONA")) {
                        android.util.Log.d("BackgroundService", "SET_PERSONA received - ignoring (handled by bleManager)");
                        return;
                    }
                    
                    if (message.equals(PROTOCOL_START_VOICE)) {
                        android.util.Log.d("BackgroundService", "START_V received - starting audio buffer");
                        logToFile("START_VOICE received - starting audio buffer");
                        audioBuffer.clear();
                        isVoiceMode = true;
                        currentMode = "VOICE";
                        return;
                    }
                    
                    if (message.equals(PROTOCOL_START_SILENT)) {
                        android.util.Log.d("BackgroundService", "START_S received - starting audio buffer (silent mode)");
                        logToFile("START_SILENT received - starting audio buffer");
                        audioBuffer.clear();
                        isVoiceMode = true;
                        currentMode = "SILENT";
                        return;
                    }
                    
                    if (message.equals(PROTOCOL_END)) {
                        android.util.Log.d("BackgroundService", "END received - processing buffered audio natively");
                        logToFile("END received - processing " + audioBuffer.size() + " audio chunks");
                        
                        if (audioBuffer.isEmpty()) {
                            android.util.Log.w("BackgroundService", "END received but no audio buffered");
                            logToFile("WARNING: END received but no audio buffered");
                            isVoiceMode = false;
                            return;
                        }
                        
                        // Prevent concurrent processing
                        if (!isProcessingAudio.compareAndSet(false, true)) {
                            android.util.Log.w("BackgroundService", "Audio processing already in progress, skipping");
                            logToFile("WARNING: Audio processing already in progress, skipping");
                            audioBuffer.clear();
                            isVoiceMode = false;
                            return;
                        }
                        
                        // Combine all buffered chunks
                        int totalLength = 0;
                        for (byte[] chunk : audioBuffer) {
                            totalLength += chunk.length;
                        }
                        
                        byte[] mergedAudio = new byte[totalLength];
                        int offset = 0;
                        for (byte[] chunk : audioBuffer) {
                            System.arraycopy(chunk, 0, mergedAudio, offset, chunk.length);
                            offset += chunk.length;
                        }
                        
                        android.util.Log.d("BackgroundService", "Processing audio natively: " + mergedAudio.length + " bytes from " + audioBuffer.size() + " chunks");
                        
                        // Clear buffer and reset state
                        audioBuffer.clear();
                        isVoiceMode = false;
                        
                        // Process audio completely in native (background-safe)
                        processAudioNative(mergedAudio);
                        return;
                    }
                }
                
                // If in voice mode, buffer the audio chunk
                if (isVoiceMode) {
                    audioBuffer.add(data.clone());
                    android.util.Log.d("BackgroundService", "Audio chunk buffered: " + data.length + " bytes (total chunks: " + audioBuffer.size() + ")");
                } else {
                    // Not in voice mode and not a control message - might be stray data
                    android.util.Log.d("BackgroundService", "Data received outside voice mode: " + data.length + " bytes - ignoring");
                }
                
            } catch (Exception e) {
                android.util.Log.e("BackgroundService", "Error processing audio data: " + e.getMessage(), e);
            }
        });
    }
    
    /**
     * Notifica eventos a JavaScript usando broadcasts del sistema
     * Usa broadcasts del sistema en lugar de LocalBroadcastManager porque
     * el servicio corre en un proceso separado (:background)
     */
    private void notifyJavaScript(String eventName, Object data) {
        try {
            Intent intent = new Intent("com.hollow.watch.BLE_EVENT");
            intent.putExtra("eventName", eventName);
            
            if (data instanceof Boolean) {
                intent.putExtra("value", (Boolean) data);
            } else if (data instanceof String) {
                intent.putExtra("error", (String) data);
            } else if (data instanceof byte[]) {
                // Convertir byte array a base64 para JavaScript
                String base64 = android.util.Base64.encodeToString((byte[]) data, android.util.Base64.NO_WRAP);
                intent.putExtra("data", base64);
            }
            
            // Use LocalBroadcastManager since service and plugin now run in the same process
            // This is more efficient and secure than system broadcasts
            androidx.localbroadcastmanager.content.LocalBroadcastManager.getInstance(this).sendBroadcast(intent);
            android.util.Log.d("BackgroundService", "Event broadcast sent (LocalBroadcast): " + eventName);
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error broadcasting event: " + e.getMessage(), e);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    // Métodos públicos para controlar la conexión BLE
    public void connectBleDevice(String deviceAddress) {
        if (deviceAddress == null || deviceAddress.isEmpty()) {
            android.util.Log.w("BackgroundService", "Invalid device address provided");
            return;
        }
        
        // Check if already connected to the same device
        if (bleManager != null && bleManager.isConnected() && deviceAddress.equals(connectedDeviceAddress)) {
            android.util.Log.d("BackgroundService", "Already connected to device: " + deviceAddress);
            logToFile("Already connected to device: " + deviceAddress);
            return;
        }
        
        connectedDeviceAddress = deviceAddress;
        logToFile("Connecting to BLE device: " + deviceAddress);
        if (bleHandler != null && bleManager != null) {
            // Ejecutar conexión en el handler thread de alta prioridad
            bleHandler.post(() -> {
                android.util.Log.d("BackgroundService", "Connecting to BLE device: " + deviceAddress);
                boolean connected = bleManager.connectToDevice(deviceAddress);
                if (!connected) {
                    android.util.Log.w("BackgroundService", "Failed to initiate BLE connection");
                    logToFile("ERROR: Failed to initiate BLE connection to " + deviceAddress);
                }
            });
        } else {
            android.util.Log.w("BackgroundService", "BLE manager or handler not initialized");
            logToFile("WARNING: BLE manager or handler not initialized");
        }
    }
    
    public void disconnectBleDevice() {
        if (bleManager != null) {
            android.util.Log.d("BackgroundService", "Disconnecting BLE device");
            bleManager.disconnect();
        }
        connectedDeviceAddress = null;
    }
    
    public boolean isBleConnected() {
        return bleManager != null && bleManager.isConnected();
    }
    
    public void sendBleData(byte[] data) {
        if (bleManager != null && data != null) {
            bleManager.sendData(data);
        }
    }
    
    /**
     * Process audio completely in native - no JavaScript dependency
     * This works even when the app is in background/Doze mode
     */
    private void processAudioNative(byte[] adpcmData) {
        // Run in background thread to avoid blocking BLE handler
        new Thread(() -> {
            // Acquire wake lock for processing to prevent Doze mode from slowing down
            PowerManager.WakeLock processingWakeLock = null;
            try {
                PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
                if (powerManager != null) {
                    processingWakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK, 
                        "HollowWatch::AudioProcessing"
                    );
                    processingWakeLock.acquire(5 * 60 * 1000L); // 5 minutos máximo para procesamiento
                }
                
                android.util.Log.d("BackgroundService", "Starting native audio processing pipeline");
                logToFile("=== STARTING AUDIO PROCESSING ===");
                long pipelineStartTime = System.currentTimeMillis();
                
                // Step 1: Decode ADPCM to PCM
                long decodeStartTime = System.currentTimeMillis();
                android.util.Log.d("BackgroundService", "Step 1: Decoding ADPCM to PCM...");
                android.util.Log.d("BackgroundService", "  Input: " + adpcmData.length + " bytes (ADPCM)");
                ImaAdpcmDecoder.DecodeResult decodeResult = ImaAdpcmDecoder.decode(adpcmData, null);
                short[] pcmSamples = decodeResult.samples;
                long decodeTime = System.currentTimeMillis() - decodeStartTime;
                
                // Calculate audio duration (sample rate is 16000 Hz)
                double audioDurationSeconds = pcmSamples.length / 16000.0;
                android.util.Log.d("BackgroundService", "  Decoded: " + pcmSamples.length + " PCM samples (" + String.format("%.2f", audioDurationSeconds) + "s audio, took " + decodeTime + "ms)");
                
                // Audio duration and size limits
                final double MAX_AUDIO_DURATION_SECONDS = 30.0; // 30 seconds max
                final int MAX_AUDIO_BASE64_SIZE_KB = 500; // ~500 KB base64 max (roughly 30s at 16kHz)
                
                if (audioDurationSeconds > MAX_AUDIO_DURATION_SECONDS) {
                    android.util.Log.w("BackgroundService", "⚠️ Audio duration (" + String.format("%.2f", audioDurationSeconds) + "s) exceeds limit (" + MAX_AUDIO_DURATION_SECONDS + "s). Truncating...");
                    // Truncate to max duration
                    int maxSamples = (int)(MAX_AUDIO_DURATION_SECONDS * 16000);
                    short[] truncatedSamples = new short[maxSamples];
                    System.arraycopy(pcmSamples, Math.max(0, pcmSamples.length - maxSamples), truncatedSamples, 0, maxSamples);
                    pcmSamples = truncatedSamples;
                    audioDurationSeconds = MAX_AUDIO_DURATION_SECONDS;
                    android.util.Log.d("BackgroundService", "  Truncated to " + pcmSamples.length + " samples (" + String.format("%.2f", audioDurationSeconds) + "s)");
                }
                
                // Step 2: Encode PCM to WAV Base64
                long encodeStartTime = System.currentTimeMillis();
                android.util.Log.d("BackgroundService", "Step 2: Encoding PCM to WAV Base64...");
                String wavBase64 = WavEncoder.encodeToBase64(pcmSamples);
                long encodeTime = System.currentTimeMillis() - encodeStartTime;
                
                // Calculate sizes
                int wavBase64Size = wavBase64.length();
                int wavBase64SizeKB = wavBase64Size / 1024;
                int estimatedPayloadSizeKB = (wavBase64Size + 1000) / 1024; // Rough estimate including other fields
                
                android.util.Log.d("BackgroundService", "  Encoded: " + wavBase64Size + " chars base64 (" + wavBase64SizeKB + " KB, took " + encodeTime + "ms)");
                logToFile("Encode: " + encodeTime + "ms, " + wavBase64SizeKB + " KB");
                
                // Check size limit
                if (wavBase64SizeKB > MAX_AUDIO_BASE64_SIZE_KB) {
                    android.util.Log.w("BackgroundService", "⚠️ Audio size (" + wavBase64SizeKB + " KB) exceeds limit (" + MAX_AUDIO_BASE64_SIZE_KB + " KB)");
                }
                
                android.util.Log.d("BackgroundService", "  Estimated total payload: ~" + estimatedPayloadSizeKB + " KB");
                
                long audioProcessingTime = System.currentTimeMillis() - pipelineStartTime;
                android.util.Log.d("BackgroundService", "Audio processing pipeline: " + audioProcessingTime + "ms total (decode: " + decodeTime + "ms, encode: " + encodeTime + "ms)");
                
                // Step 3: Get configuration from SharedPreferences
                long configStartTime = System.currentTimeMillis();
                android.util.Log.d("BackgroundService", "Step 3: Loading configuration from SharedPreferences...");
                String userId = getUserId();
                String backendToken = getBackendToken();
                String persona = getPersona();
                String rules = getRules();
                String baseRules = getBaseRules();
                long configTime = System.currentTimeMillis() - configStartTime;
                android.util.Log.d("BackgroundService", "  Configuration loaded in " + configTime + "ms");
                
                if (backendToken == null || backendToken.isEmpty()) {
                    android.util.Log.e("BackgroundService", "Backend token not found - cannot process audio");
                    isProcessingAudio.set(false);
                    return;
                }
                
                // Step 3.5: Get conversation context from SharedPreferences
                // OPTIMIZED: Direct StringBuilder building to avoid intermediate list
                String contextText = null;
                long contextStartTime = System.currentTimeMillis();
                long contextTime = 0;
                try {
                    SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
                    String conversationHistoryJson = prefs.getString("conversation_history", null);
                    
                    if (conversationHistoryJson != null && !conversationHistoryJson.isEmpty()) {
                        android.util.Log.d("BackgroundService", "Found conversation_history: " + conversationHistoryJson.length() + " chars");
                        
                        // Parse JSON array and format as text (matching JavaScript formatConversationContext)
                        org.json.JSONArray historyArray = new org.json.JSONArray(conversationHistoryJson);
                        android.util.Log.d("BackgroundService", "Parsed conversation_history: " + historyArray.length() + " messages (fresh parse)");
                        if (historyArray.length() > 0) {
                            // OPTIMIZATION: Build directly with StringBuilder, skip intermediate list
                            int maxMessages = Math.min(historyArray.length(), 10); // MAX_CONTEXT_TURNS (matches TypeScript)
                            int startIndex = Math.max(0, historyArray.length() - maxMessages);
                            
                            // Pre-allocate StringBuilder with estimated capacity (average 100 chars per message)
                            StringBuilder contextBuilder = new StringBuilder(maxMessages * 100);
                            boolean firstMessage = true;
                            
                            for (int i = startIndex; i < historyArray.length(); i++) {
                                org.json.JSONObject msg = historyArray.getJSONObject(i);
                                String role = msg.optString("role", "");
                                String text = msg.optString("text", "");
                                
                                if (!text.isEmpty() && (role.equals("user") || role.equals("assistant"))) {
                                    if (!firstMessage) {
                                        contextBuilder.append("\n\n");
                                    }
                                    firstMessage = false;
                                    
                                    String roleLabel = role.equals("user") ? "USER" : "ASSISTANT";
                                    contextBuilder.append(roleLabel).append(": ").append(text);
                                }
                            }
                            
                            if (contextBuilder.length() > 0) {
                                contextText = contextBuilder.toString();
                                contextTime = System.currentTimeMillis() - contextStartTime;
                                android.util.Log.d("BackgroundService", "Step 3.5: Formatted conversation context: " + maxMessages + " messages (" + contextText.length() + " chars, took " + contextTime + "ms)");
                            } else {
                                android.util.Log.d("BackgroundService", "No valid messages found in conversation_history after filtering");
                            }
                        } else {
                            android.util.Log.d("BackgroundService", "conversation_history array is empty");
                        }
                    } else {
                        android.util.Log.d("BackgroundService", "No conversation_history found in SharedPreferences");
                    }
                } catch (org.json.JSONException e) {
                    android.util.Log.w("BackgroundService", "Invalid conversation_history JSON: " + e.getMessage());
                } catch (Exception e) {
                    android.util.Log.e("BackgroundService", "Error formatting context: " + e.getMessage(), e);
                }
                
                // Step 4: Make HTTP request to backend
                android.util.Log.d("BackgroundService", "Step 4: Sending request to backend API...");
                android.util.Log.d("BackgroundService", "  Audio size: " + (wavBase64.length() / 1024) + " KB base64");
                android.util.Log.d("BackgroundService", "  Context size: " + (contextText != null ? contextText.length() : 0) + " chars");
                android.util.Log.d("BackgroundService", "  Estimated payload: ~" + ((wavBase64.length() + (contextText != null ? contextText.length() : 0) + 1000) / 1024) + " KB");
                
                long apiStartTime = System.currentTimeMillis();
                long networkStartTime = apiStartTime;
                
                // Use shared ApiClient if available (for connection reuse), otherwise create new one
                ApiClient apiClient = sharedApiClient;
                if (apiClient == null) {
                    apiClient = new ApiClient(backendToken);
                    // Cache it for future use
                    sharedApiClient = apiClient;
                }
                
                // TODO: When backend supports separate transcription endpoint, uncomment this:
                // This separates audio upload from LLM processing for better performance
                /*
                android.util.Log.d("BackgroundService", "  Using separate transcription + chat flow");
                long transcribeStartTime = System.currentTimeMillis();
                String transcription = apiClient.sendTranscriptionOnly(wavBase64, userId);
                long transcribeTime = System.currentTimeMillis() - transcribeStartTime;
                
                if (transcription == null || transcription.isEmpty()) {
                    android.util.Log.e("BackgroundService", "Transcription failed");
                    isProcessingAudio.set(false);
                    return;
                }
                
                android.util.Log.d("BackgroundService", "  Transcription received in " + transcribeTime + "ms: \"" + transcription + "\"");
                
                long chatStartTime = System.currentTimeMillis();
                ApiClient.ChatResponse response = apiClient.sendTextChatRequest(
                    transcription,
                    userId,
                    persona,
                    rules,
                    baseRules,
                    contextText
                );
                long chatTime = System.currentTimeMillis() - chatStartTime;
                long apiTime = System.currentTimeMillis() - apiStartTime;
                android.util.Log.d("BackgroundService", "  Chat request completed in " + chatTime + "ms");
                android.util.Log.d("BackgroundService", "  Total API time: " + apiTime + "ms (transcribe: " + transcribeTime + "ms, chat: " + chatTime + "ms)");
                */
                
                // Current implementation: combined audio + chat request
                ApiClient.ChatResponse response = apiClient.sendAudioRequest(
                    wavBase64,
                    userId,
                    persona,
                    rules,
                    baseRules,
                    contextText // Send formatted conversation history as context
                );
                
                long apiTime = System.currentTimeMillis() - apiStartTime;
                android.util.Log.d("BackgroundService", "  API request completed in " + apiTime + "ms");
                android.util.Log.d("BackgroundService", "  Response received: " + (response.text != null ? response.text.length() : 0) + " chars");
                logToFile("API: " + apiTime + "ms, response: " + (response.text != null ? response.text.length() : 0) + " chars");
                
                // Step 5: Send response to watch via BLE
                if (response.error != null && !response.error.isEmpty()) {
                    android.util.Log.e("BackgroundService", "API error: " + response.error);
                    isProcessingAudio.set(false);
                    return;
                }
                
                if (response.text == null || response.text.isEmpty()) {
                    android.util.Log.w("BackgroundService", "API returned empty response");
                    isProcessingAudio.set(false);
                    return;
                }
                
                android.util.Log.d("BackgroundService", "Sending response to watch: " + response.text.substring(0, Math.min(50, response.text.length())) + "...");
                
                // Send text response to watch via BLE
                if (bleManager != null && bleManager.isConnected()) {
                    byte[] responseBytes = response.text.getBytes("UTF-8");
                    boolean sent = bleManager.sendData(responseBytes);
                    if (sent) {
                        android.util.Log.d("BackgroundService", "Response sent to watch successfully");
                    } else {
                        android.util.Log.e("BackgroundService", "Failed to send response to watch");
                    }
                } else {
                    android.util.Log.w("BackgroundService", "BLE not connected, cannot send response");
                }
                
                long totalTime = System.currentTimeMillis() - pipelineStartTime;
                android.util.Log.d("BackgroundService", "═══════════════════════════════════════════════════");
                android.util.Log.d("BackgroundService", "📊 PROCESSING TIMING BREAKDOWN:");
                android.util.Log.d("BackgroundService", "  Audio decode: " + decodeTime + "ms");
                android.util.Log.d("BackgroundService", "  Audio encode: " + encodeTime + "ms");
                android.util.Log.d("BackgroundService", "  Config load: " + configTime + "ms");
                android.util.Log.d("BackgroundService", "  Context format: " + (contextTime > 0 ? contextTime + "ms" : "N/A"));
                android.util.Log.d("BackgroundService", "  API request: " + apiTime + "ms");
                android.util.Log.d("BackgroundService", "  Message save: (see below)");
                android.util.Log.d("BackgroundService", "  ───────────────────────────────────────────────");
                android.util.Log.d("BackgroundService", "  TOTAL: " + totalTime + "ms");
                android.util.Log.d("BackgroundService", "  Audio duration: " + String.format("%.2f", audioDurationSeconds) + "s");
                android.util.Log.d("BackgroundService", "  Payload size: ~" + estimatedPayloadSizeKB + " KB");
                android.util.Log.d("BackgroundService", "═══════════════════════════════════════════════════");
                
                // Log timing breakdown to file for offline debugging
                logToFile(String.format("TIMING: decode=%dms, encode=%dms, config=%dms, context=%dms, api=%dms, TOTAL=%dms",
                    decodeTime, encodeTime, configTime, contextTime, apiTime, totalTime));
                
                // Step 6: Save messages directly to SharedPreferences (works even when JavaScript is paused)
                if (response.transcription != null && !response.transcription.isEmpty() && 
                    response.text != null && !response.text.isEmpty()) {
                    saveConversationMessagesNative(
                        response.transcription,
                        response.text
                    );
                }
                
                // Notify JavaScript (optional - for UI updates)
                notifyJavaScript("bleAudioProcessed", response.text);
                
            } catch (Exception e) {
                android.util.Log.e("BackgroundService", "Error in native audio processing: " + e.getMessage(), e);
                logToFile("ERROR: " + e.getMessage());
            } finally {
                // Release processing wake lock
                if (processingWakeLock != null && processingWakeLock.isHeld()) {
                    processingWakeLock.release();
                }
                isProcessingAudio.set(false);
            }
        }).start();
    }
    
    /**
     * Get user ID from SharedPreferences (Capacitor Preferences)
     */
    private String getUserId() {
        try {
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            String userId = prefs.getString("hollow_user_id", null);
            if (userId == null || userId.isEmpty()) {
                // Generate new user ID
                userId = "user_" + System.currentTimeMillis() + "_" + 
                    java.util.UUID.randomUUID().toString().substring(0, 9);
                prefs.edit().putString("hollow_user_id", userId).apply();
            }
            return userId;
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error getting user ID: " + e.getMessage());
            return "user_" + System.currentTimeMillis();
        }
    }
    
    /**
     * Get backend token from environment/build config
     * This should be set via build.gradle or environment variable
     */
    private String getBackendToken() {
        // Try to get from SharedPreferences first (set by JS)
        try {
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            String token = prefs.getString("backend_shared_token", null);
            if (token != null && !token.isEmpty()) {
                return token;
            }
        } catch (Exception e) {
            android.util.Log.w("BackgroundService", "Error reading token from prefs: " + e.getMessage());
        }
        
        // Fallback: try to get from BuildConfig (set via gradle.properties or build.gradle)
        // For now, return null - token should be set by JavaScript on app start
        android.util.Log.w("BackgroundService", "Backend token not found in preferences");
        return null;
    }
    
    /**
     * Get persona from SharedPreferences
     */
    private String getPersona() {
        try {
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            return prefs.getString("active_persona", "");
        } catch (Exception e) {
            android.util.Log.w("BackgroundService", "Error getting persona: " + e.getMessage());
            return "";
        }
    }
    
    /**
     * Get rules from SharedPreferences
     */
    private String getRules() {
        try {
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            return prefs.getString("active_rules", "");
        } catch (Exception e) {
            android.util.Log.w("BackgroundService", "Error getting rules: " + e.getMessage());
            return "";
        }
    }
    
    /**
     * Get baseRules from SharedPreferences
     */
    private String getBaseRules() {
        try {
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            return prefs.getString("active_baserules", "");
        } catch (Exception e) {
            android.util.Log.w("BackgroundService", "Error getting baseRules: " + e.getMessage());
            return "";
        }
    }

    /**
     * Start periodic HTTP connection pre-warming to reduce first request latency after inactivity
     */
    private void startConnectionPrewarming() {
        if (prewarmHandler != null) {
            // Already started
            return;
        }
        
        // Initialize shared ApiClient if needed
        if (sharedApiClient == null) {
            try {
                SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
                String backendToken = prefs.getString("backend_token", "");
                if (!backendToken.isEmpty()) {
                    sharedApiClient = new ApiClient(backendToken);
                    android.util.Log.d("BackgroundService", "Initialized shared ApiClient for connection pre-warming");
                    logToFile("HTTP connection pre-warming started");
                }
            } catch (Exception e) {
                android.util.Log.w("BackgroundService", "Failed to initialize ApiClient for pre-warming: " + e.getMessage());
            }
        }
        
        if (sharedApiClient == null) {
            return;
        }
        
        // Create handler on main thread for pre-warming
        prewarmHandler = new Handler(getMainLooper());
        
        // Pre-warm immediately
        sharedApiClient.prewarmConnection();
        
        // Schedule periodic pre-warming
        prewarmRunnable = new Runnable() {
            @Override
            public void run() {
                if (sharedApiClient != null && bleManager != null && bleManager.isConnected()) {
                    sharedApiClient.prewarmConnection();
                    // Schedule next pre-warming
                    if (prewarmHandler != null) {
                        prewarmHandler.postDelayed(this, PREWARM_INTERVAL_MS);
                    }
                }
            }
        };
        
        prewarmHandler.postDelayed(prewarmRunnable, PREWARM_INTERVAL_MS);
    }
    
    /**
     * Stop HTTP connection pre-warming
     */
    private void stopConnectionPrewarming() {
        if (prewarmHandler != null && prewarmRunnable != null) {
            prewarmHandler.removeCallbacks(prewarmRunnable);
            prewarmRunnable = null;
            prewarmHandler = null;
            android.util.Log.d("BackgroundService", "Stopped HTTP connection pre-warming");
            logToFile("HTTP connection pre-warming stopped");
        }
    }
    
    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            // PARTIAL_WAKE_LOCK mantiene la CPU activa incluso cuando la pantalla está apagada
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG);
            wakeLock.acquire(10 * 60 * 60 * 1000L); // 10 horas máximo
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }
    
    /**
     * Log to file for debugging when USB is not connected
     * Logs are saved to: /data/data/com.hollow.watch/files/hollow_logs.txt
     */
    private void logToFile(String message) {
        try {
            File logFile = new File(getFilesDir(), "hollow_logs.txt");
            FileWriter writer = new FileWriter(logFile, true); // Append mode
            
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US);
            String timestamp = sdf.format(new Date());
            String logLine = timestamp + " [BackgroundService] " + message + "\n";
            
            writer.append(logLine);
            writer.flush();
            writer.close();
            
            // Keep log file under 1MB (delete and recreate if too large)
            if (logFile.length() > 1024 * 1024) {
                logFile.delete();
            }
        } catch (IOException e) {
            // Silently fail - don't break processing if logging fails
            android.util.Log.w("BackgroundService", "Failed to write to log file: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.util.Log.d("BackgroundService", "Creating notification channel");
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Hollow Watch Background Service",
                NotificationManager.IMPORTANCE_HIGH // Alta importancia para mantener prioridad
            );
            channel.setDescription("Mantiene la conexión BLE con el reloj activa");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            // Configurar para mantener prioridad incluso en Doze mode
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                channel.setAllowBubbles(false);
            }

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                android.util.Log.d("BackgroundService", "Notification channel created");
            } else {
                android.util.Log.e("BackgroundService", "NotificationManager is null!");
            }
        } else {
            android.util.Log.d("BackgroundService", "Android version < O, no channel needed");
        }
    }
    
    /**
     * Static method to process ADPCM audio natively (called from plugin)
     */
    public static void processAdpcmNativeStatic(Context context, byte[] adpcmData) {
        android.util.Log.d("BackgroundService", "processAdpcmNativeStatic called from plugin");
        // Start service if not running
        Intent serviceIntent = new Intent(context, BackgroundService.class);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
        
        // Process audio in a new thread
        new Thread(() -> {
            try {
                processWavFromAdpcm(context, adpcmData);
            } catch (Exception e) {
                android.util.Log.e("BackgroundService", "Error in processAdpcmNativeStatic: " + e.getMessage(), e);
            }
        }).start();
    }
    
    /**
     * Static method to process WAV Base64 directly (called from plugin for recorded audio)
     */
    public static void processWavBase64Native(Context context, String wavBase64, String contextText) {
        android.util.Log.d("BackgroundService", "processWavBase64Native called from plugin");
        // Start service if not running
        Intent serviceIntent = new Intent(context, BackgroundService.class);
        if (contextText != null && !contextText.isEmpty()) {
            serviceIntent.putExtra("conversation_context", contextText);
            android.util.Log.d("BackgroundService", "Context passed via Intent: " + contextText.length() + " chars");
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
        
        // Process audio in a new thread
        final String finalContext = contextText; // Make final for use in thread
        new Thread(() -> {
            try {
                processWavBase64(context, wavBase64, finalContext);
            } catch (Exception e) {
                android.util.Log.e("BackgroundService", "Error in processWavBase64Native: " + e.getMessage(), e);
            }
        }).start();
    }
    
    /**
     * Process WAV from ADPCM (shared logic)
     */
    private static void processWavFromAdpcm(Context context, byte[] adpcmData) {
        try {
            android.util.Log.d("BackgroundService", "Starting native audio processing pipeline (from ADPCM)");
            long startTime = System.currentTimeMillis();
            
            // Step 1: Decode ADPCM to PCM
            android.util.Log.d("BackgroundService", "Decoding ADPCM to PCM...");
            ImaAdpcmDecoder.DecodeResult decodeResult = ImaAdpcmDecoder.decode(adpcmData, null);
            short[] pcmSamples = decodeResult.samples;
            android.util.Log.d("BackgroundService", "Decoded to " + pcmSamples.length + " PCM samples");
            
            // Step 2: Encode PCM to WAV Base64
            android.util.Log.d("BackgroundService", "Encoding PCM to WAV Base64...");
            String wavBase64 = WavEncoder.encodeToBase64(pcmSamples);
            android.util.Log.d("BackgroundService", "WAV encoded: " + wavBase64.length() + " chars (base64)");
            
            // Process the WAV (no context from BLE, will read from SharedPreferences)
            processWavBase64(context, wavBase64, null);
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error in processWavFromAdpcm: " + e.getMessage(), e);
        }
    }
    
    /**
     * Process WAV Base64 (shared logic for both ADPCM and direct WAV)
     */
    private static void processWavBase64(Context context, String wavBase64, String providedContext) {
        try {
            long startTime = System.currentTimeMillis();
            android.util.Log.d("BackgroundService", "Processing WAV Base64: " + wavBase64.length() + " chars");
            
            // Get configuration from SharedPreferences
            // Always get a fresh instance to avoid cache issues
            SharedPreferences prefs = context.getSharedPreferences("_capacitor_preferences", Context.MODE_PRIVATE);
            
            // Force reload by getting a new instance if possible (Android doesn't cache, but this ensures fresh read)
            String userId = prefs.getString("hollow_user_id", null);
            if (userId == null || userId.isEmpty()) {
                userId = "user_" + System.currentTimeMillis() + "_" + 
                    java.util.UUID.randomUUID().toString().substring(0, 9);
                prefs.edit().putString("hollow_user_id", userId).apply();
            }
            
            String backendToken = prefs.getString("backend_shared_token", null);
            String persona = prefs.getString("active_persona", "");
            String rules = prefs.getString("active_rules", "");
            String baseRules = prefs.getString("active_baserules", "");
            
            if (backendToken == null || backendToken.isEmpty()) {
                android.util.Log.e("BackgroundService", "Backend token not found - cannot process audio");
                return;
            }
            
            // Use provided context if available, otherwise try to read from SharedPreferences
            String contextText = (providedContext != null && !providedContext.isEmpty()) ? providedContext : null;
            
            if (contextText == null || contextText.isEmpty()) {
                android.util.Log.d("BackgroundService", "No context provided, trying to read from SharedPreferences");
                
                // Get fresh instance and force sync - read immediately, no retries
                prefs = context.getSharedPreferences("_capacitor_preferences", Context.MODE_PRIVATE);
                java.util.Map<String, ?> allPrefs = prefs.getAll(); // Force disk read
                
                // Read immediately - no retries, no delays
                String conversationHistoryJson = prefs.getString("conversation_history", null);
                
                // Also try reading from getAll() which forces a sync
                if (conversationHistoryJson == null || conversationHistoryJson.isEmpty()) {
                    if (allPrefs.containsKey("conversation_history")) {
                        Object historyValue = allPrefs.get("conversation_history");
                        if (historyValue != null) {
                            conversationHistoryJson = historyValue.toString();
                            android.util.Log.d("BackgroundService", "Found conversation_history via getAll()");
                        }
                    }
                }
                
                if (conversationHistoryJson == null) {
                    android.util.Log.d("BackgroundService", "conversation_history is null in SharedPreferences");
                } else if (conversationHistoryJson.isEmpty()) {
                    android.util.Log.d("BackgroundService", "conversation_history is empty in SharedPreferences");
                } else {
                android.util.Log.d("BackgroundService", "Found conversation_history: " + conversationHistoryJson.length() + " chars");
                try {
                    // Parse JSON array and format as text (matching JavaScript formatConversationContext)
                    // CRITICAL: Always parse fresh - don't reuse old data
                    // OPTIMIZED: Direct StringBuilder building to avoid intermediate list
                    org.json.JSONArray historyArray = new org.json.JSONArray(conversationHistoryJson);
                    android.util.Log.d("BackgroundService", "Parsed conversation_history: " + historyArray.length() + " messages (fresh parse)");
                    if (historyArray.length() > 0) {
                        // OPTIMIZATION: Build directly with StringBuilder, skip intermediate list
                        int maxMessages = Math.min(historyArray.length(), 10); // MAX_CONTEXT_TURNS (matches TypeScript)
                        int startIndex = Math.max(0, historyArray.length() - maxMessages);
                        
                        // Pre-allocate StringBuilder with estimated capacity (average 100 chars per message)
                        StringBuilder contextBuilder = new StringBuilder(maxMessages * 100);
                        boolean firstMessage = true;
                        
                        for (int i = startIndex; i < historyArray.length(); i++) {
                            org.json.JSONObject msg = historyArray.getJSONObject(i);
                            String role = msg.optString("role", "");
                            String text = msg.optString("text", "");
                            
                            if (!text.isEmpty() && (role.equals("user") || role.equals("assistant"))) {
                                if (!firstMessage) {
                                    contextBuilder.append("\n\n");
                                }
                                firstMessage = false;
                                
                                String roleLabel = role.equals("user") ? "USER" : "ASSISTANT";
                                contextBuilder.append(roleLabel).append(": ").append(text);
                            }
                        }
                        
                        if (contextBuilder.length() > 0) {
                            contextText = contextBuilder.toString();
                            android.util.Log.d("BackgroundService", "Formatted conversation context: " + maxMessages + " messages (" + contextText.length() + " chars)");
                        } else {
                            android.util.Log.d("BackgroundService", "No valid messages found in conversation_history after filtering");
                        }
                    } else {
                        android.util.Log.d("BackgroundService", "conversation_history array is empty");
                    }
                } catch (org.json.JSONException e) {
                    android.util.Log.w("BackgroundService", "Invalid conversation_history JSON: " + e.getMessage());
                    android.util.Log.w("BackgroundService", "JSON content (first 200 chars): " + conversationHistoryJson.substring(0, Math.min(200, conversationHistoryJson.length())));
                } catch (Exception e) {
                    android.util.Log.e("BackgroundService", "Error formatting context: " + e.getMessage(), e);
                }
                }
            } else {
                android.util.Log.d("BackgroundService", "Using context provided from JavaScript: " + contextText.length() + " chars");
            }
            
            // Make HTTP request to backend
            android.util.Log.d("BackgroundService", "Sending request to backend API...");
            long apiStartTime = System.currentTimeMillis();
            
            // Use shared ApiClient if available (for connection reuse), otherwise create new one
            ApiClient apiClient = sharedApiClient;
            if (apiClient == null) {
                apiClient = new ApiClient(backendToken);
                // Cache it for future use
                sharedApiClient = apiClient;
            }
            ApiClient.ChatResponse response = apiClient.sendAudioRequest(
                wavBase64,
                userId,
                persona,
                rules,
                baseRules,
                contextText // Send formatted conversation history as context
            );
            
            long apiTime = System.currentTimeMillis() - apiStartTime;
            android.util.Log.d("BackgroundService", "API request took " + apiTime + "ms");
            
            // Handle response
            if (response.error != null && !response.error.isEmpty()) {
                android.util.Log.e("BackgroundService", "API error: " + response.error);
                // Notify JavaScript of error
                notifyJavaScriptStatic(context, "bleAudioError", response.error);
                return;
            }
            
            if (response.text == null || response.text.isEmpty()) {
                android.util.Log.w("BackgroundService", "API returned empty response");
                return;
            }
            
            android.util.Log.d("BackgroundService", "API response: " + response.text.substring(0, Math.min(50, response.text.length())) + "...");
            
            // Send response to watch via BLE
            android.util.Log.d("BackgroundService", "Sending response to watch: " + response.text.substring(0, Math.min(50, response.text.length())) + "...");
            if (staticBleManager != null && staticBleManager.isConnected()) {
                try {
                    byte[] responseBytes = response.text.getBytes("UTF-8");
                    boolean sent = staticBleManager.sendData(responseBytes);
                    if (sent) {
                        android.util.Log.d("BackgroundService", "Response sent to watch successfully");
                    } else {
                        android.util.Log.e("BackgroundService", "Failed to send response to watch");
                    }
                } catch (Exception e) {
                    android.util.Log.e("BackgroundService", "Error sending response to watch: " + e.getMessage(), e);
                }
            } else {
                android.util.Log.w("BackgroundService", "BLE manager not available or not connected - cannot send response to watch");
            }
            
            long totalTime = System.currentTimeMillis() - startTime;
            android.util.Log.d("BackgroundService", "Complete native processing took " + totalTime + "ms");
            
            // Save messages directly to SharedPreferences (works even when JavaScript is paused)
            if (response.transcription != null && !response.transcription.isEmpty() && 
                response.text != null && !response.text.isEmpty()) {
                saveConversationMessagesNativeStatic(
                    context,
                    response.transcription,
                    response.text
                );
            }
            
            // Notify JavaScript with results
            notifyJavaScriptStatic(context, "bleAudioProcessed", response.text);
            if (response.transcription != null) {
                notifyJavaScriptStatic(context, "bleTranscription", response.transcription);
            }
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error in processWavBase64: " + e.getMessage(), e);
            notifyJavaScriptStatic(context, "bleAudioError", e.getMessage());
        }
    }
    private static class BackendConfig {
        String backendToken;
        String persona;
        String rules;
        String baseRules;
    }
    
    private static BackendConfig readBackendConfig(Context context) {
        SharedPreferences prefs =
            context.getSharedPreferences("_capacitor_preferences", Context.MODE_PRIVATE);
    
        BackendConfig config = new BackendConfig();
        config.backendToken = prefs.getString("backend_shared_token", "");
        config.persona = prefs.getString("active_persona", "");
        config.rules = prefs.getString("active_rules", "");
        config.baseRules = prefs.getString("active_baserules", "");
    
        android.util.Log.d(
            "BackgroundService",
            "Loaded backend config | persona="
                + (config.persona != null && !config.persona.isEmpty())
                + " rules="
                + (config.rules != null && !config.rules.isEmpty())
                + " baseRules="
                + (config.baseRules != null && !config.baseRules.isEmpty())
        );
    
        return config;
    }
    
    
    /**
     * Save conversation messages directly to SharedPreferences (native implementation)
     * This works even when JavaScript is paused in background/sleep mode
     * OPTIMIZED: Only recreates array if exceeding max messages to avoid unnecessary parsing
     */
    private void saveConversationMessagesNative(String transcription, String response) {
        try {
            long saveStartTime = System.currentTimeMillis();
            SharedPreferences prefs = getSharedPreferences("_capacitor_preferences", MODE_PRIVATE);
            String existingHistoryJson = prefs.getString("conversation_history", "[]");
            
            org.json.JSONArray historyArray;
            try {
                historyArray = new org.json.JSONArray(existingHistoryJson);
            } catch (org.json.JSONException e) {
                android.util.Log.w("BackgroundService", "Invalid conversation_history JSON, starting fresh: " + e.getMessage());
                historyArray = new org.json.JSONArray();
            }
            
            long now = System.currentTimeMillis();
            
            // Add user message (transcription)
            org.json.JSONObject userMsg = new org.json.JSONObject();
            userMsg.put("role", "user");
            userMsg.put("text", transcription);
            userMsg.put("timestamp", now);
            historyArray.put(userMsg);
            
            // Add assistant message (response)
            org.json.JSONObject assistantMsg = new org.json.JSONObject();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("text", response);
            assistantMsg.put("timestamp", now + 1); // Ensure order
            historyArray.put(assistantMsg);
            
            // Limit to last 20 messages (MAX_CONVERSATION_TURNS)
            // OPTIMIZATION: Only recreate array if we exceed the limit
            int maxMessages = 20;
            if (historyArray.length() > maxMessages) {
                // Only create new array when necessary - this is the expensive operation
                org.json.JSONArray limitedArray = new org.json.JSONArray();
                int startIndex = historyArray.length() - maxMessages;
                for (int i = startIndex; i < historyArray.length(); i++) {
                    limitedArray.put(historyArray.get(i));
                }
                historyArray = limitedArray;
            }
            
            // Save using commit() for synchronous write (critical for background)
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString("conversation_history", historyArray.toString());
            boolean success = editor.commit(); // Synchronous write
            
            long saveTime = System.currentTimeMillis() - saveStartTime;
            
            if (success) {
                android.util.Log.d("BackgroundService", 
                    "✅ Saved conversation messages natively: user \"" + 
                    transcription.substring(0, Math.min(30, transcription.length())) + 
                    "...\" and assistant \"" + 
                    response.substring(0, Math.min(30, response.length())) + 
                    "...\" (total: " + historyArray.length() + " messages, save took " + saveTime + "ms)");
            } else {
                android.util.Log.e("BackgroundService", "Failed to save conversation messages (commit returned false)");
            }
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error saving conversation messages natively: " + e.getMessage(), e);
        }
    }
    
    /**
     * Static version for use in processWavBase64
     * OPTIMIZED: Only recreates array if exceeding max messages to avoid unnecessary parsing
     */
    private static void saveConversationMessagesNativeStatic(Context context, String transcription, String response) {
        try {
            long saveStartTime = System.currentTimeMillis();
            SharedPreferences prefs = context.getSharedPreferences("_capacitor_preferences", Context.MODE_PRIVATE);
            String existingHistoryJson = prefs.getString("conversation_history", "[]");
            
            org.json.JSONArray historyArray;
            try {
                historyArray = new org.json.JSONArray(existingHistoryJson);
            } catch (org.json.JSONException e) {
                android.util.Log.w("BackgroundService", "Invalid conversation_history JSON, starting fresh: " + e.getMessage());
                historyArray = new org.json.JSONArray();
            }
            
            long now = System.currentTimeMillis();
            
            // Add user message (transcription)
            org.json.JSONObject userMsg = new org.json.JSONObject();
            userMsg.put("role", "user");
            userMsg.put("text", transcription);
            userMsg.put("timestamp", now);
            historyArray.put(userMsg);
            
            // Add assistant message (response)
            org.json.JSONObject assistantMsg = new org.json.JSONObject();
            assistantMsg.put("role", "assistant");
            assistantMsg.put("text", response);
            assistantMsg.put("timestamp", now + 1); // Ensure order
            historyArray.put(assistantMsg);
            
            // Limit to last 20 messages (MAX_CONVERSATION_TURNS)
            // OPTIMIZATION: Only recreate array if we exceed the limit
            int maxMessages = 20;
            if (historyArray.length() > maxMessages) {
                // Only create new array when necessary - this is the expensive operation
                org.json.JSONArray limitedArray = new org.json.JSONArray();
                int startIndex = historyArray.length() - maxMessages;
                for (int i = startIndex; i < historyArray.length(); i++) {
                    limitedArray.put(historyArray.get(i));
                }
                historyArray = limitedArray;
            }
            
            // Save using commit() for synchronous write (critical for background)
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString("conversation_history", historyArray.toString());
            boolean success = editor.commit(); // Synchronous write
            
            long saveTime = System.currentTimeMillis() - saveStartTime;
            
            if (success) {
                android.util.Log.d("BackgroundService", 
                    "✅ Saved conversation messages natively: user \"" + 
                    transcription.substring(0, Math.min(30, transcription.length())) + 
                    "...\" and assistant \"" + 
                    response.substring(0, Math.min(30, response.length())) + 
                    "...\" (total: " + historyArray.length() + " messages, save took " + saveTime + "ms)");
            } else {
                android.util.Log.e("BackgroundService", "Failed to save conversation messages (commit returned false)");
            }
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error saving conversation messages natively: " + e.getMessage(), e);
        }
    }
    
    /**
     * Static helper to notify JavaScript
     */
    private static void notifyJavaScriptStatic(Context context, String eventName, String data) {
        try {
            Intent intent = new Intent("com.hollow.watch.BLE_EVENT");
            intent.putExtra("eventName", eventName);
            intent.putExtra("data", data);
            androidx.localbroadcastmanager.content.LocalBroadcastManager.getInstance(context).sendBroadcast(intent);
            android.util.Log.d("BackgroundService", "Event broadcast sent (LocalBroadcast): " + eventName);
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error broadcasting event: " + e.getMessage(), e);
        }
    }
}


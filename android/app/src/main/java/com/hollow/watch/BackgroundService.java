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
                        updateNotification(connected);
                        notifyJavaScript("bleConnectionStateChanged", connected);
                    }
                    
                    @Override
                    public void onCharacteristicChanged(byte[] data) {
                        android.util.Log.d("BackgroundService", "BLE data received: " + data.length + " bytes");
                        processAudioData(data);
                    }
                    
                    @Override
                    public void onError(String error) {
                        android.util.Log.e("BackgroundService", "BLE error: " + error);
                        notifyJavaScript("bleError", error);
                    }
                });
            });
            
            // OPTIMIZACIÓN: Estas operaciones corren en paralelo con la inicialización de BLE
            createNotificationChannel();
            acquireWakeLock();
            
            android.util.Log.d("BackgroundService", "Service created successfully");
        } catch (Exception e) {
            android.util.Log.e("BackgroundService", "Error in onCreate: " + e.getMessage(), e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        android.util.Log.d("BackgroundService", "onStartCommand() called with startId: " + startId);
        
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
                        audioBuffer.clear();
                        isVoiceMode = true;
                        currentMode = "VOICE";
                        return;
                    }
                    
                    if (message.equals(PROTOCOL_START_SILENT)) {
                        android.util.Log.d("BackgroundService", "START_S received - starting audio buffer (silent mode)");
                        audioBuffer.clear();
                        isVoiceMode = true;
                        currentMode = "SILENT";
                        return;
                    }
                    
                    if (message.equals(PROTOCOL_END)) {
                        android.util.Log.d("BackgroundService", "END received - processing buffered audio natively");
                        
                        if (audioBuffer.isEmpty()) {
                            android.util.Log.w("BackgroundService", "END received but no audio buffered");
                            isVoiceMode = false;
                            return;
                        }
                        
                        // Prevent concurrent processing
                        if (!isProcessingAudio.compareAndSet(false, true)) {
                            android.util.Log.w("BackgroundService", "Audio processing already in progress, skipping");
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
            return;
        }
        
        connectedDeviceAddress = deviceAddress;
        if (bleHandler != null && bleManager != null) {
            // Ejecutar conexión en el handler thread de alta prioridad
            bleHandler.post(() -> {
                android.util.Log.d("BackgroundService", "Connecting to BLE device: " + deviceAddress);
                boolean connected = bleManager.connectToDevice(deviceAddress);
                if (!connected) {
                    android.util.Log.w("BackgroundService", "Failed to initiate BLE connection");
                }
            });
        } else {
            android.util.Log.w("BackgroundService", "BLE manager or handler not initialized");
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
            try {
                android.util.Log.d("BackgroundService", "Starting native audio processing pipeline");
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
                
                long audioProcessingTime = System.currentTimeMillis() - startTime;
                android.util.Log.d("BackgroundService", "Audio processing took " + audioProcessingTime + "ms");
                
                // Step 3: Get configuration from SharedPreferences
                String userId = getUserId();
                String backendToken = getBackendToken();
                String persona = getPersona();
                String rules = getRules();
                
                if (backendToken == null || backendToken.isEmpty()) {
                    android.util.Log.e("BackgroundService", "Backend token not found - cannot process audio");
                    isProcessingAudio.set(false);
                    return;
                }
                
                // Step 4: Make HTTP request to backend
                android.util.Log.d("BackgroundService", "Sending request to backend API...");
                long apiStartTime = System.currentTimeMillis();
                
                ApiClient apiClient = new ApiClient(backendToken);
                ApiClient.ChatResponse response = apiClient.sendAudioRequest(
                    wavBase64,
                    userId,
                    persona,
                    rules,
                    null // context - can be added later if needed
                );
                
                long apiTime = System.currentTimeMillis() - apiStartTime;
                android.util.Log.d("BackgroundService", "API request took " + apiTime + "ms");
                
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
                
                long totalTime = System.currentTimeMillis() - startTime;
                android.util.Log.d("BackgroundService", "Complete native processing took " + totalTime + "ms");
                
                // Notify JavaScript (optional - for UI updates)
                notifyJavaScript("bleAudioProcessed", response.text);
                
            } catch (Exception e) {
                android.util.Log.e("BackgroundService", "Error in native audio processing: " + e.getMessage(), e);
            } finally {
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
                    org.json.JSONArray historyArray = new org.json.JSONArray(conversationHistoryJson);
                    android.util.Log.d("BackgroundService", "Parsed conversation_history: " + historyArray.length() + " messages (fresh parse)");
                    if (historyArray.length() > 0) {
                        // Format messages as "USER: text\n\nASSISTANT: text" (matching backend expectation)
                        java.util.List<String> formattedMessages = new java.util.ArrayList<>();
                        int maxMessages = Math.min(historyArray.length(), 12); // MAX_CONTEXT_TURNS
                        int startIndex = Math.max(0, historyArray.length() - maxMessages);
                        
                        for (int i = startIndex; i < historyArray.length(); i++) {
                            org.json.JSONObject msg = historyArray.getJSONObject(i);
                            String role = msg.optString("role", "");
                            String text = msg.optString("text", "");
                            
                            if (!text.isEmpty() && (role.equals("user") || role.equals("assistant"))) {
                                String roleLabel = role.equals("user") ? "USER" : "ASSISTANT";
                                formattedMessages.add(roleLabel + ": " + text);
                            }
                        }
                        
                        if (!formattedMessages.isEmpty()) {
                            // Build formatted context string (compatible with older Android versions)
                            StringBuilder contextBuilder = new StringBuilder();
                            for (int i = 0; i < formattedMessages.size(); i++) {
                                if (i > 0) {
                                    contextBuilder.append("\n\n");
                                }
                                contextBuilder.append(formattedMessages.get(i));
                            }
                            contextText = contextBuilder.toString();
                            android.util.Log.d("BackgroundService", "Formatted conversation context: " + formattedMessages.size() + " messages (" + contextText.length() + " chars)");
                            android.util.Log.d("BackgroundService", "Context preview (first 200 chars): " + contextText.substring(0, Math.min(200, contextText.length())));
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
            
            ApiClient apiClient = new ApiClient(backendToken);
            ApiClient.ChatResponse response = apiClient.sendAudioRequest(
                wavBase64,
                userId,
                persona,
                rules,
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
    }
    
    private static BackendConfig readBackendConfig(Context context) {
        SharedPreferences prefs =
            context.getSharedPreferences("_capacitor_preferences", Context.MODE_PRIVATE);
    
        BackendConfig config = new BackendConfig();
        config.backendToken = prefs.getString("backend_shared_token", "");
        config.persona = prefs.getString("active_persona", "");
        config.rules = prefs.getString("active_rules", "");
    
        android.util.Log.d(
            "BackgroundService",
            "Loaded backend config | persona="
                + (config.persona != null && !config.persona.isEmpty())
                + " rules="
                + (config.rules != null && !config.rules.isEmpty())
        );
    
        return config;
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


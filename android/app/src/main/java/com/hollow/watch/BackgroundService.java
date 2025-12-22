package com.hollow.watch;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
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
                }
            });
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
                        android.util.Log.d("BackgroundService", "END received - processing buffered audio");
                        
                        if (audioBuffer.isEmpty()) {
                            android.util.Log.w("BackgroundService", "END received but no audio buffered");
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
                        
                        android.util.Log.d("BackgroundService", "Sending complete audio to JavaScript: " + mergedAudio.length + " bytes from " + audioBuffer.size() + " chunks");
                        
                        // Clear buffer and reset state
                        audioBuffer.clear();
                        isVoiceMode = false;
                        
                        // Send complete audio to JavaScript
                        notifyJavaScript("bleAudioData", mergedAudio);
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
            intent.setPackage(getPackageName()); // Restrict to our app only for security
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
            
            // Use system broadcast instead of LocalBroadcastManager
            // because we run in a separate process (:background)
            sendBroadcast(intent);
            android.util.Log.d("BackgroundService", "Event broadcast sent: " + eventName);
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
}


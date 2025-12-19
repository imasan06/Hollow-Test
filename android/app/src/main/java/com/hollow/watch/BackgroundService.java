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
import androidx.core.app.NotificationCompat;

public class BackgroundService extends Service {
    private static final String CHANNEL_ID = "HollowWatchBackgroundChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final String WAKE_LOCK_TAG = "HollowWatch::BLEWakeLock";
    private static final String EXTRA_DEVICE_ADDRESS = "device_address";
    private PowerManager.WakeLock wakeLock;
    private BleConnectionManager bleManager;
    private String connectedDeviceAddress;

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d("BackgroundService", "onCreate() called");
        try {
        createNotificationChannel();
        acquireWakeLock();
            
            // Inicializar el gestor BLE nativo
            bleManager = new BleConnectionManager(this);
            bleManager.setEventListener(new BleConnectionManager.BleEventListener() {
                @Override
                public void onConnectionStateChanged(boolean connected) {
                    android.util.Log.d("BackgroundService", "BLE connection state changed: " + connected);
                    updateNotification(connected);
                    // Notificar a JavaScript a través del plugin si es necesario
                }
                
                @Override
                public void onCharacteristicChanged(byte[] data) {
                    android.util.Log.d("BackgroundService", "BLE data received: " + data.length + " bytes");
                    // Aquí podríamos notificar a JavaScript, pero por ahora solo logueamos
                    // En una implementación completa, usaríamos un BroadcastReceiver o EventBus
                }
                
                @Override
                public void onError(String error) {
                    android.util.Log.e("BackgroundService", "BLE error: " + error);
                }
            });
            
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
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
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
        
        // Limpiar conexión BLE
        if (bleManager != null) {
            bleManager.cleanup();
            bleManager = null;
        }
        
        releaseWakeLock();
        super.onDestroy();
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
        if (bleManager != null) {
            android.util.Log.d("BackgroundService", "Connecting to BLE device: " + deviceAddress);
            boolean connected = bleManager.connectToDevice(deviceAddress);
            if (!connected) {
                android.util.Log.w("BackgroundService", "Failed to initiate BLE connection");
            }
        } else {
            android.util.Log.w("BackgroundService", "BLE manager not initialized");
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
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Mantiene la conexión BLE con el reloj activa");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);

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


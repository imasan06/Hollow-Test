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
import androidx.core.app.NotificationCompat;

public class BackgroundService extends Service {
    private static final String CHANNEL_ID = "HollowWatchBackgroundChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final String WAKE_LOCK_TAG = "HollowWatch::BLEWakeLock";
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        android.util.Log.d("BackgroundService", "onCreate() called");
        try {
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

            Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Hollow Watch")
                .setContentText("Manteniendo conexión con el reloj")
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

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
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


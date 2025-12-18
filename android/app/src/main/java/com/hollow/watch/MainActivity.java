package com.hollow.watch;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registrar el plugin manualmente antes de super.onCreate()
        Log.d(TAG, "Registering BackgroundServicePlugin");
        registerPlugin(BackgroundServicePlugin.class);
        
        super.onCreate(savedInstanceState);
        
        Log.d(TAG, "MainActivity onCreate completed");
        
        // Enable edge-to-edge display
        // This ensures the app respects system bars (status bar, navigation bar)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        Log.d(TAG, "MainActivity onPause() - App going to background");
        // No pausar el WebView para mantener la conexión BLE activa
        // El servicio en segundo plano mantendrá la app viva
    }

    @Override
    public void onResume() {
        super.onResume();
        Log.d(TAG, "MainActivity onResume() - App coming to foreground");
    }

    @Override
    public void onStop() {
        super.onStop();
        Log.d(TAG, "MainActivity onStop() - App stopped");
        // No detener el WebView para mantener la conexión BLE activa
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "MainActivity onDestroy() - Activity being destroyed");
        super.onDestroy();
    }
}

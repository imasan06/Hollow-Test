package com.hollow.watch;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

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

        // Configurar WebView para mantener la conexión BLE activa
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    // Configurar WebView para que no se pause en segundo plano
                    webView.getSettings().setJavaScriptEnabled(true);
                    webView.setKeepScreenOn(false);
                    Log.d(TAG, "WebView configured for background BLE connection");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error configuring WebView: " + e.getMessage(), e);
        }
    }

    @Override
    public void onPause() {
        Log.d(TAG, "MainActivity onPause() - App going to background");
        // IMPORTANTE: Mantener el WebView activo para BLE
        // No llamamos super.onPause() inmediatamente para evitar que el WebView se pause
        // El servicio en segundo plano mantendrá la app viva
        
        // Intentar mantener el WebView activo
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    // Forzar que el WebView siga activo
                    webView.onResume();
                    Log.d(TAG, "WebView kept active in onPause()");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error keeping WebView active: " + e.getMessage(), e);
        }
        
        // Llamar super.onPause() pero después de configurar el WebView
        super.onPause();
    }

    @Override
    public void onResume() {
        Log.d(TAG, "MainActivity onResume() - App coming to foreground");
        super.onResume();
        
        // Asegurar que el WebView esté activo
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.onResume();
                    Log.d(TAG, "WebView resumed");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error resuming WebView: " + e.getMessage(), e);
        }
    }

    @Override
    public void onStop() {
        Log.d(TAG, "MainActivity onStop() - App stopped");
        // IMPORTANTE: Android requiere llamar a super.onStop()
        // El servicio en segundo plano mantendrá la app viva
        // El WebView puede pausarse, pero el servicio mantendrá el proceso activo
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    // Intentar mantener el WebView activo antes de onStop
                    // Nota: Esto puede no funcionar completamente, pero el servicio
                    // en segundo plano mantendrá el proceso activo
                    webView.onResume();
                    Log.d(TAG, "WebView kept active before onStop()");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error keeping WebView active in onStop: " + e.getMessage(), e);
        }
        
        // CRITICAL: Llamar a super.onStop() es requerido por Android
        // Sin esto, la app crasheará con SuperNotCalledException
        super.onStop();
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "MainActivity onDestroy() - Activity being destroyed");
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        Log.d(TAG, "MainActivity onWindowFocusChanged - hasFocus: " + hasFocus);
        
        // Mantener el WebView activo incluso sin foco
        if (!hasFocus) {
            Log.d(TAG, "Window lost focus but keeping WebView active for BLE");
            try {
                Bridge bridge = getBridge();
                if (bridge != null) {
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.onResume();
                        Log.d(TAG, "WebView kept active after losing focus");
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error keeping WebView active after focus loss: " + e.getMessage(), e);
            }
        }
    }
}

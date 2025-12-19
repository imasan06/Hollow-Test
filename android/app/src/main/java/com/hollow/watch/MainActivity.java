package com.hollow.watch;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // OPTIMIZACIÓN: Registrar plugin primero, sin log en release
        registerPlugin(BackgroundServicePlugin.class);
        
        super.onCreate(savedInstanceState);
        
        // OPTIMIZACIÓN: Edge-to-edge solo en Android R+ (más común)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        // OPTIMIZACIÓN: Configurar WebView de forma diferida para no bloquear onCreate
        getWindow().getDecorView().post(() -> {
            try {
                Bridge bridge = getBridge();
                if (bridge != null) {
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.getSettings().setJavaScriptEnabled(true);
                        webView.setKeepScreenOn(false);
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onPause() {
        // OPTIMIZACIÓN: Mantener WebView activo sin logs excesivos
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.onResume();
                }
            }
        } catch (Exception ignored) {}
        
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        
        // OPTIMIZACIÓN: Reanudar WebView sin logs
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.onResume();
                }
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onStop() {
        // OPTIMIZACIÓN: Mantener WebView activo antes de stop
        try {
            Bridge bridge = getBridge();
            if (bridge != null) {
                WebView webView = bridge.getWebView();
                if (webView != null) {
                    webView.onResume();
                }
            }
        } catch (Exception ignored) {}
        
        super.onStop();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        
        // OPTIMIZACIÓN: Mantener WebView activo sin foco, sin logs
        if (!hasFocus) {
            try {
                Bridge bridge = getBridge();
                if (bridge != null) {
                    WebView webView = bridge.getWebView();
                    if (webView != null) {
                        webView.onResume();
                    }
                }
            } catch (Exception ignored) {}
        }
    }
}

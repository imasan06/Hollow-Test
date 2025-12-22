package com.hollow.watch;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundService")
public class BackgroundServicePlugin extends Plugin {
    private static final String TAG = "BackgroundServicePlugin";
    private BackgroundService backgroundService;
    private boolean isServiceBound = false;
    private BroadcastReceiver bleEventReceiver;
    
    private ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            Log.d(TAG, "Service connected");
            isServiceBound = true;
        }
        
        @Override
        public void onServiceDisconnected(ComponentName name) {
            Log.d(TAG, "Service disconnected");
            isServiceBound = false;
            backgroundService = null;
        }
    };
    
    @Override
    public void load() {
        super.load();
        
        // Registrar BroadcastReceiver para eventos BLE del servicio
        bleEventReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                Log.d(TAG, "BroadcastReceiver.onReceive() called");
                String eventName = intent.getStringExtra("eventName");
                if (eventName == null) {
                    Log.w(TAG, "Received broadcast with null eventName");
                    return;
                }
                Log.d(TAG, "Received event: " + eventName);
                
                JSObject jsData = new JSObject();
                jsData.put("name", eventName);
                
                if (intent.hasExtra("value")) {
                    jsData.put("value", intent.getBooleanExtra("value", false));
                } else if (intent.hasExtra("error")) {
                    jsData.put("error", intent.getStringExtra("error"));
                } else if (intent.hasExtra("data")) {
                    jsData.put("data", intent.getStringExtra("data"));
                }
                
                // Enviar evento a JavaScript usando WebView
                // OPTIMIZATION: Use bridge.notifyListeners for better background support
                // This works even when WebView is paused in background
                try {
                    // Try using Capacitor's notifyListeners first (better for background)
                    notifyListeners(eventName, jsData);
                    Log.d(TAG, "Event sent to JavaScript via notifyListeners: " + eventName);
                } catch (Exception e) {
                    // Fallback to WebView if notifyListeners fails
                    Log.w(TAG, "notifyListeners failed, trying WebView fallback: " + e.getMessage());
                    android.webkit.WebView webView = getBridge().getWebView();
                    if (webView != null) {
                        String jsCode = String.format(
                            "window.dispatchEvent(new CustomEvent('%s', { detail: %s }));",
                            eventName,
                            jsData.toString()
                        );
                        
                        // Use post to ensure it runs on UI thread
                        // In background, WebView may be paused, but post should still work
                        webView.post(() -> {
                            try {
                                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
                                    webView.evaluateJavascript(jsCode, null);
                                } else {
                                    // Fallback para versiones antiguas
                                    webView.loadUrl("javascript:" + jsCode);
                                }
                                Log.d(TAG, "Event sent to JavaScript via WebView: " + eventName);
                            } catch (Exception ex) {
                                Log.e(TAG, "Error sending event via WebView: " + ex.getMessage());
                            }
                        });
                    } else {
                        Log.w(TAG, "WebView is null, cannot send event to JavaScript");
                    }
                }
            }
        };
        
        IntentFilter filter = new IntentFilter("com.hollow.watch.BLE_EVENT");
        // Use system broadcast receiver instead of LocalBroadcastManager
        // because BackgroundService runs in a separate process (:background)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ requires explicit export flag
            getContext().registerReceiver(bleEventReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(bleEventReceiver, filter);
        }
        Log.d(TAG, "BLE event receiver registered (system broadcast)");
    }
    
    @Override
    public void handleOnDestroy() {
        super.handleOnDestroy();
        if (bleEventReceiver != null) {
            try {
                getContext().unregisterReceiver(bleEventReceiver);
            } catch (Exception e) {
                Log.w(TAG, "Error unregistering receiver: " + e.getMessage());
            }
            bleEventReceiver = null;
            Log.d(TAG, "BLE event receiver unregistered");
        }
    }

    @PluginMethod
    public void startService(PluginCall call) {
        Log.d(TAG, "startService() called");
        try {
            android.content.Context context = getContext();
            if (context == null) {
                Log.e(TAG, "Context is null!");
                call.reject("Context is null");
                return;
            }

            // Intentar usar Activity context si está disponible (mejor para iniciar servicios)
            android.content.Context serviceContext = context;
            if (getActivity() != null) {
                serviceContext = getActivity();
                Log.d(TAG, "Using Activity context for service start");
            } else {
                Log.d(TAG, "Using Application context for service start");
            }

            Log.d(TAG, "Creating Intent for BackgroundService");
            Intent serviceIntent = new Intent(serviceContext, BackgroundService.class);
            
            // Obtener dirección del dispositivo BLE si se proporciona
            String deviceAddress = call.getString("deviceAddress");
            if (deviceAddress != null && !deviceAddress.isEmpty()) {
                serviceIntent.putExtra("device_address", deviceAddress);
                Log.d(TAG, "Device address provided: " + deviceAddress);
            }
            
            Log.d(TAG, "Android SDK version: " + android.os.Build.VERSION.SDK_INT);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                Log.d(TAG, "Starting foreground service (Android O+)");
                try {
                    serviceContext.startForegroundService(serviceIntent);
                    Log.d(TAG, "startForegroundService() called successfully");
                } catch (IllegalStateException e) {
                    Log.e(TAG, "IllegalStateException starting foreground service: " + e.getMessage());
                    // Intentar con startService como fallback
                    try {
                        serviceContext.startService(serviceIntent);
                        Log.d(TAG, "Fallback: startService() called");
                    } catch (Exception fallbackError) {
                        Log.e(TAG, "Fallback startService also failed: " + fallbackError.getMessage());
                        call.reject("Failed to start service: " + fallbackError.getMessage(), fallbackError);
                        return;
                    }
                } catch (SecurityException e) {
                    Log.e(TAG, "SecurityException: " + e.getMessage());
                    call.reject("SecurityException: " + e.getMessage() + ". Check permissions in AndroidManifest.xml");
                    return;
                } catch (Exception e) {
                    Log.e(TAG, "Unexpected exception: " + e.getMessage(), e);
                    call.reject("Failed to start service: " + e.getMessage(), e);
                    return;
                }
            } else {
                Log.d(TAG, "Starting regular service (Android < O)");
                try {
                    serviceContext.startService(serviceIntent);
                    Log.d(TAG, "startService() called successfully");
                } catch (Exception e) {
                    Log.e(TAG, "Exception starting service: " + e.getMessage(), e);
                    call.reject("Failed to start service: " + e.getMessage(), e);
                    return;
                }
            }

            JSObject result = new JSObject();
            result.put("success", true);
            Log.d(TAG, "Service start initiated successfully, resolving call");
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in startService: " + e.getMessage(), e);
            call.reject("Failed to start service: " + e.getMessage(), e);
        }
    }
    
    @PluginMethod
    public void connectBleDevice(PluginCall call) {
        Log.d(TAG, "connectBleDevice() called");
        try {
            String deviceAddress = call.getString("deviceAddress");
            if (deviceAddress == null || deviceAddress.isEmpty()) {
                call.reject("Device address is required");
                return;
            }
            
            android.content.Context context = getContext();
            if (context == null) {
                call.reject("Context is null");
                return;
            }
            
            Intent serviceIntent = new Intent(context, BackgroundService.class);
            serviceIntent.putExtra("device_address", deviceAddress);
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in connectBleDevice: " + e.getMessage(), e);
            call.reject("Failed to connect BLE device: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void disconnectBleDevice(PluginCall call) {
        Log.d(TAG, "disconnectBleDevice() called");
        try {
            android.content.Context context = getContext();
            if (context == null) {
                call.reject("Context is null");
                return;
            }
            
            Intent serviceIntent = new Intent(context, BackgroundService.class);
            serviceIntent.setAction("DISCONNECT_BLE");
            
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in disconnectBleDevice: " + e.getMessage(), e);
            call.reject("Failed to disconnect BLE device: " + e.getMessage(), e);
        }
    }
    
    @PluginMethod
    public void isBleConnected(PluginCall call) {
        Log.d(TAG, "isBleConnected() called");
        try {
            // Por ahora retornamos false, en una implementación completa
            // necesitaríamos acceder al servicio para verificar el estado
            JSObject result = new JSObject();
            result.put("connected", false);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in isBleConnected: " + e.getMessage(), e);
            call.reject("Failed to check BLE connection: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Log.d(TAG, "stopService() called");
        try {
            if (getContext() == null) {
                Log.e(TAG, "Context is null!");
                call.reject("Context is null");
                return;
            }

            Intent serviceIntent = new Intent(getContext(), BackgroundService.class);
            boolean stopped = getContext().stopService(serviceIntent);
            Log.d(TAG, "stopService() returned: " + stopped);

            JSObject result = new JSObject();
            result.put("success", stopped);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in stopService: " + e.getMessage(), e);
            call.reject("Failed to stop service: " + e.getMessage(), e);
        }
    }
}


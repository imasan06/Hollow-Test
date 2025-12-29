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
        // Use LocalBroadcastManager since service and plugin now run in the same process
        // This is more efficient and secure than system broadcasts
        androidx.localbroadcastmanager.content.LocalBroadcastManager.getInstance(getContext())
            .registerReceiver(bleEventReceiver, filter);
        Log.d(TAG, "BLE event receiver registered (LocalBroadcast)");
    }
    
    @Override
    public void handleOnDestroy() {
        super.handleOnDestroy();
        if (bleEventReceiver != null) {
            try {
                androidx.localbroadcastmanager.content.LocalBroadcastManager.getInstance(getContext())
                    .unregisterReceiver(bleEventReceiver);
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
    
    /**
     * Test method to simulate the BackgroundService audio flow without a real BLE device.
     * This sends a fake audio broadcast through the same path as real BLE data.
     */
    @PluginMethod
    public void setBackendConfig(PluginCall call) {
        Log.d(TAG, "setBackendConfig() called");
        try {
            String backendToken = call.getString("backendToken");
            String persona = call.getString("persona");
            String rules = call.getString("rules");
            String baseRules = call.getString("baseRules");
            
            android.content.SharedPreferences prefs = getContext().getSharedPreferences("_capacitor_preferences", android.content.Context.MODE_PRIVATE);
            android.content.SharedPreferences.Editor editor = prefs.edit();
            
            if (backendToken != null && !backendToken.isEmpty()) {
                editor.putString("backend_shared_token", backendToken);
                Log.d(TAG, "Backend token saved");
            }
            if (persona != null) {
                editor.putString("active_persona", persona);
            }
            if (rules != null) {
                editor.putString("active_rules", rules);
            }
            if (baseRules != null) {
                editor.putString("active_baserules", baseRules);
            }
            
            editor.apply();
            
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in setBackendConfig: " + e.getMessage(), e);
            call.reject("Failed to set backend config: " + e.getMessage(), e);
        }
    }
    
    @PluginMethod
    public void shareLogFile(PluginCall call) {
        Log.d(TAG, "shareLogFile() called");
        try {
            android.content.Context context = getContext();
            if (context == null) {
                call.reject("Context is null");
                return;
            }
            
            java.io.File logFile = new java.io.File(context.getFilesDir(), "hollow_logs.txt");
            
            if (!logFile.exists()) {
                call.reject("Log file does not exist yet. Use the app first to generate logs.");
                return;
            }
            
            // Use FileProvider to share the file
            android.net.Uri fileUri = androidx.core.content.FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                logFile
            );
            
            android.content.Intent shareIntent = new android.content.Intent(android.content.Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(android.content.Intent.EXTRA_STREAM, fileUri);
            shareIntent.putExtra(android.content.Intent.EXTRA_SUBJECT, "Hollow Watch Logs");
            shareIntent.putExtra(android.content.Intent.EXTRA_TEXT, "Logs from Hollow Watch app");
            shareIntent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            
            android.content.Intent chooser = android.content.Intent.createChooser(shareIntent, "Share Log File");
            chooser.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            
            context.startActivity(chooser);
            
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("fileSize", logFile.length());
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in shareLogFile: " + e.getMessage(), e);
            call.reject("Failed to share log file: " + e.getMessage(), e);
        }
    }
    
    @PluginMethod
    public void processAudioNative(PluginCall call) {
        Log.d(TAG, "processAudioNative() called");
        try {
            String wavBase64 = call.getString("wavBase64");
            if (wavBase64 == null || wavBase64.isEmpty()) {
                call.reject("wavBase64 is required");
                return;
            }
            
            // Get optional context from JavaScript
            String context = call.getString("context", null);
            if (context != null && !context.isEmpty()) {
                Log.d(TAG, "Received context from JavaScript: " + context.length() + " chars");
            } else {
                Log.d(TAG, "No context provided from JavaScript, will try to read from SharedPreferences");
            }
            
            // Process WAV directly (no need to convert to ADPCM)
            BackgroundService.processWavBase64Native(getContext(), wavBase64, context);
            
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Exception in processAudioNative: " + e.getMessage(), e);
            call.reject("Failed to process audio: " + e.getMessage(), e);
        }
    }
    
    /**
     * Process audio natively (same method used by BackgroundService)
     */
    private void processAudioNative(byte[] adpcmData) {
        // Get BackgroundService instance to process audio
        android.content.Context context = getContext();
        if (context == null) {
            Log.e(TAG, "Context is null, cannot process audio");
            return;
        }
        
        // Start BackgroundService if not already running
        Intent serviceIntent = new Intent(context, BackgroundService.class);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
        
        // Process ADPCM audio natively
        BackgroundService.processAdpcmNativeStatic(context, adpcmData);
    }
}


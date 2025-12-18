package com.hollow.watch;

import android.content.Intent;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundService")
public class BackgroundServicePlugin extends Plugin {
    private static final String TAG = "BackgroundServicePlugin";

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


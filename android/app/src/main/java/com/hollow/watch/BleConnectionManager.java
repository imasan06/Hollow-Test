package com.hollow.watch;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

public class BleConnectionManager {
    private static final String TAG = "BleConnectionManager";
    
    // UUIDs del servicio BLE
    private static final String SERVICE_UUID_STR = "4FAFC201-1FB5-459E-8FCC-C5C9C331914B";
    private static final String AUDIO_CHAR_UUID_STR = "BEB5483E-36E1-4688-B7F5-EA07361B26A8";
    private static final String TEXT_CHAR_UUID_STR = "0A3D547E-6967-4660-A744-8ACE08191266";
    
    private static final UUID SERVICE_UUID = UUID.fromString(SERVICE_UUID_STR);
    private static final UUID AUDIO_CHAR_UUID = UUID.fromString(AUDIO_CHAR_UUID_STR);
    private static final UUID TEXT_CHAR_UUID = UUID.fromString(TEXT_CHAR_UUID_STR);
    private static final UUID CLIENT_CHARACTERISTIC_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    
    private Context context;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothGatt bluetoothGatt;
    private BluetoothDevice connectedDevice;
    private boolean isConnected = false;
    private boolean isConnecting = false;
    private Handler mainHandler;
    
    // Callback interface para notificar eventos a JavaScript
    public interface BleEventListener {
        void onConnectionStateChanged(boolean connected);
        void onCharacteristicChanged(byte[] data);
        void onError(String error);
    }
    
    private BleEventListener eventListener;
    private ConcurrentLinkedQueue<byte[]> audioBuffer = new ConcurrentLinkedQueue<>();
    
    public BleConnectionManager(Context context) {
        this.context = context;
        this.mainHandler = new Handler(Looper.getMainLooper());
        
        BluetoothManager bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            this.bluetoothAdapter = bluetoothManager.getAdapter();
        }
        
        Log.d(TAG, "BleConnectionManager initialized");
    }
    
    public void setEventListener(BleEventListener listener) {
        this.eventListener = listener;
    }
    
    public boolean connectToDevice(String deviceAddress) {
        if (bluetoothAdapter == null) {
            Log.e(TAG, "BluetoothAdapter is null");
            return false;
        }
        
        // Check if already connected to the same device
        if (isConnected && connectedDevice != null && connectedDevice.getAddress().equals(deviceAddress)) {
            Log.d(TAG, "Already connected to this device: " + deviceAddress);
            return true;
        }
        
        if (isConnecting || isConnected) {
            Log.w(TAG, "Already connecting or connected to different device");
            return false;
        }
        
        try {
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceAddress);
            if (device == null) {
                Log.e(TAG, "Device not found: " + deviceAddress);
                return false;
            }
            
            Log.d(TAG, "Connecting to device: " + deviceAddress);
            isConnecting = true;
            
            // Conectar usando connectGatt con autoConnect=false para conexión inmediata
            bluetoothGatt = device.connectGatt(context, false, gattCallback);
            
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Error connecting to device: " + e.getMessage(), e);
            isConnecting = false;
            if (eventListener != null) {
                eventListener.onError("Connection failed: " + e.getMessage());
            }
            return false;
        }
    }
    
    public void disconnect() {
        Log.d(TAG, "Disconnecting from device");
        isConnecting = false;
        isConnected = false;
        
        if (bluetoothGatt != null) {
            try {
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
            } catch (Exception e) {
                Log.e(TAG, "Error disconnecting: " + e.getMessage(), e);
            }
            bluetoothGatt = null;
        }
        
        connectedDevice = null;
        audioBuffer.clear();
        
        if (eventListener != null) {
            eventListener.onConnectionStateChanged(false);
        }
    }
    
    public boolean sendData(byte[] data) {
        if (!isConnected || bluetoothGatt == null) {
            Log.w(TAG, "Not connected, cannot send data");
            return false;
        }
        
        try {
            BluetoothGattService service = bluetoothGatt.getService(SERVICE_UUID);
            if (service == null) {
                Log.e(TAG, "Service not found");
                return false;
            }
            
            BluetoothGattCharacteristic characteristic = service.getCharacteristic(TEXT_CHAR_UUID);
            if (characteristic == null) {
                Log.e(TAG, "Text characteristic not found");
                return false;
            }
            
            // Double-check connection state right before write (connection may have dropped)
            if (!isConnected() || bluetoothGatt == null) {
                Log.w(TAG, "Cannot send data - connection lost before write");
                return false;
            }
            
            characteristic.setValue(data);
            boolean success = bluetoothGatt.writeCharacteristic(characteristic);
            
            if (success) {
                Log.d(TAG, "Data sent successfully: " + data.length + " bytes");
            } else {
                Log.w(TAG, "Failed to write characteristic");
            }
            
            return success;
        } catch (Exception e) {
            Log.e(TAG, "Error sending data: " + e.getMessage(), e);
            return false;
        }
    }
    
    public boolean isConnected() {
        return isConnected && bluetoothGatt != null;
    }
    
    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            Log.d(TAG, "Connection state changed: status=" + status + ", newState=" + newState);
            
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "Connected to GATT server");
                isConnecting = false;
                isConnected = true;
                connectedDevice = gatt.getDevice();
                
                // Descubrir servicios
                gatt.discoverServices();
                
                if (eventListener != null) {
                    eventListener.onConnectionStateChanged(true);
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "Disconnected from GATT server");
                isConnecting = false;
                isConnected = false;
                
                if (eventListener != null) {
                    eventListener.onConnectionStateChanged(false);
                }
                
                // Intentar reconectar si fue una desconexión inesperada
                if (connectedDevice != null && status != 0) {
                    Log.d(TAG, "Attempting to reconnect...");
                    mainHandler.postDelayed(() -> {
                        if (!isConnected && connectedDevice != null) {
                            connectToDevice(connectedDevice.getAddress());
                        }
                    }, 2000);
                }
            }
        }
        
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Services discovered successfully");
                
                BluetoothGattService service = gatt.getService(SERVICE_UUID);
                if (service != null) {
                    BluetoothGattCharacteristic audioChar = service.getCharacteristic(AUDIO_CHAR_UUID);
                    if (audioChar != null) {
                        // Habilitar notificaciones
                        gatt.setCharacteristicNotification(audioChar, true);
                        
                        BluetoothGattDescriptor descriptor = audioChar.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG);
                        if (descriptor != null) {
                            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            gatt.writeDescriptor(descriptor);
                            Log.d(TAG, "Notifications enabled for audio characteristic");
                        }
                    } else {
                        Log.e(TAG, "Audio characteristic not found");
                    }
                } else {
                    Log.e(TAG, "Service not found");
                }
            } else {
                Log.e(TAG, "Service discovery failed: " + status);
            }
        }
        
        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            UUID charUuid = characteristic.getUuid();
            
            if (charUuid.equals(AUDIO_CHAR_UUID)) {
                byte[] data = characteristic.getValue();
                if (data != null && data.length > 0) {
                    Log.d(TAG, "Audio data received: " + data.length + " bytes");
                    
                    // Agregar a buffer
                    audioBuffer.offer(data);
                    
                    // Notificar al listener
                    if (eventListener != null) {
                        eventListener.onCharacteristicChanged(data);
                    }
                }
            }
        }
        
        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Characteristic write successful");
            } else {
                Log.e(TAG, "Characteristic write failed: " + status);
            }
        }
        
        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Descriptor write successful");
            } else {
                Log.e(TAG, "Descriptor write failed: " + status);
            }
        }
    };
    
    public void cleanup() {
        disconnect();
        if (mainHandler != null) {
            mainHandler.removeCallbacksAndMessages(null);
        }
    }
}

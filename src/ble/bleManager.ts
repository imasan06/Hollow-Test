import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';
import { 
  SERVICE_UUID, 
  AUDIO_CHAR_UUID, 
  TEXT_CHAR_UUID, 
  DEVICE_NAME,
  PROTOCOL,
  BLE_CONFIG 
} from './constants';
import { APP_CONFIG } from '@/config/app.config';
import { MockBleService } from './mockBleService';
import { BleMessageType } from '@/types/bleMessages';

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected';
export type VoiceState = 'idle' | 'listening' | 'processing' | 'responding';

export interface BleManagerCallbacks {
  onConnectionStateChange?: (state: ConnectionState) => void;
  onVoiceStateChange?: (state: VoiceState) => void;
  onAudioData?: (data: Uint8Array) => void;
  onVoiceEnd?: () => void;
  onTimeRequest?: () => void;
  onError?: (error: string) => void;
  onAudioComplete?: (adpcmData: Uint8Array, mode: 'VOICE' | 'SILENT') => void;
  onControlMessage?: (command: string, data?: string) => void; // For REQ_TIME, SET_PERSONA, etc.
}

class BleManager {
  private device: BleDevice | null = null;
  private callbacks: BleManagerCallbacks | null = null;
  private mode: 'VOICE' | 'SILENT' = 'VOICE';
  private audioBuffer: Uint8Array[] = [];
  private isVoiceMode = false;
  private reconnectAttempts = 0;
  private isInitialized = false;
  private mockMode = APP_CONFIG.BLE_MOCK_MODE;
  private mockService: MockBleService | null = null;
  private chunkCounter = 0;

  async initialize(callbacks: BleManagerCallbacks): Promise<void> {
    this.callbacks = callbacks;
    console.log(`[BLE] Mode: ${this.mockMode ? 'MOCK/DEMO' : 'REAL'}`);
    
    if (this.mockMode) {
      this.isInitialized = true;
      this.mockService = new MockBleService({
        onNotification: (value) => this.handleAudioNotification(value),
        onDisconnect: () => this.handleDisconnect(),
      });
      console.log('[BLE] Mock service ready');
      return;
    }

    try {
      await BleClient.initialize();
      this.isInitialized = true;
      console.log('[BLE] Initialized successfully');
    } catch (error) {
      console.error('[BLE] Initialization failed:', error);
      this.callbacks?.onError?.('Failed to initialize Bluetooth');
      throw error;
    }
  }

  async scan(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('BLE not initialized');
    }

    this.callbacks?.onConnectionStateChange('scanning');
    console.log('[BLE] Scanning for Hollow Watch...');

    if (this.mockMode) {
      try {
        const device = await this.mockService!.scan();
        this.device = device as unknown as BleDevice;
        this.callbacks?.onConnectionStateChange('connecting');
        await this.connectMock();
      } catch (error) {
        console.error('[BLE] Mock scan failed:', error);
        this.callbacks?.onConnectionStateChange('disconnected');
        this.callbacks?.onError?.('Mock scan failed');
      }
      return;
    }

    try {
      // Strategy 1: Try with namePrefix only (most flexible - device may not advertise service UUID in scan)
      console.log(`[BLE] Attempting scan with namePrefix: "${DEVICE_NAME}"...`);
      console.log('[BLE] Note: If device was just turned on, wait 3-5 seconds for it to start advertising');
      let device: BleDevice | null = null;
      
      try {
        device = await BleClient.requestDevice({
          namePrefix: DEVICE_NAME,
          optionalServices: [SERVICE_UUID], // Include service as optional for discovery after connection
        });
        console.log('[BLE] ✓ Device found via namePrefix:', device.name ?? 'Unknown', device.deviceId);
      } catch (namePrefixError) {
        const errorMsg = namePrefixError instanceof Error ? namePrefixError.message : String(namePrefixError);
        console.log(`[BLE] NamePrefix scan failed: ${errorMsg}`);
        console.log('[BLE] Trying without filters (will show all BLE devices)...');
        
        // Strategy 2: Try without any filters (show all devices)
        // This is the most reliable method - shows all devices and lets user select
        try {
          console.log('[BLE] Showing device picker with all available BLE devices...');
          console.log(`[BLE] Look for a device starting with "${DEVICE_NAME}" in the list`);
          device = await BleClient.requestDevice({});
          
          if (!device) {
            throw new Error('No device selected by user');
          }
          
          // Verify the device name matches our prefix
          if (device.name && device.name.startsWith(DEVICE_NAME)) {
            console.log('[BLE] ✓ Device found without filters (name matches):', device.name, device.deviceId);
          } else if (device.name) {
            console.warn(`[BLE] ⚠ Device selected: "${device.name}" (does not match prefix "${DEVICE_NAME}")`);
            console.warn('[BLE] Proceeding with connection - user selected this device manually');
          } else {
            console.warn('[BLE] ⚠ Device selected but has no name');
            console.warn('[BLE] Proceeding with connection - user selected this device manually');
          }
        } catch (noFilterError) {
          const errorMsg = noFilterError instanceof Error ? noFilterError.message : String(noFilterError);
          console.log(`[BLE] No-filter scan failed: ${errorMsg}`);
          console.log('[BLE] Trying with service UUID filter (last attempt)...');
          
          // Strategy 3: Try with service UUID (original method - may work if device advertises service)
          try {
            console.log(`[BLE] Scanning for devices advertising service: ${SERVICE_UUID}`);
            device = await BleClient.requestDevice({
        services: [SERVICE_UUID],
        optionalServices: [],
      });
            console.log('[BLE] ✓ Device found via service UUID:', device.name ?? 'Unknown', device.deviceId);
          } catch (serviceError) {
            const errorMsg = serviceError instanceof Error ? serviceError.message : String(serviceError);
            console.error('[BLE] ✗ All scan strategies failed');
            console.error('[BLE] Last error:', errorMsg);
            console.error('[BLE] Troubleshooting tips:');
            console.error('  1. Ensure the device Bluetooth is ON and in discoverable mode');
            console.error('  2. Wait 3-5 seconds after turning on Bluetooth before scanning');
            console.error(`  3. Verify device name starts with "${DEVICE_NAME}"`);
            console.error(`  4. Check that device is advertising service UUID: ${SERVICE_UUID}`);
            throw serviceError; // Throw the last error
          }
        }
      }

      if (device) {
        // Verify device name matches prefix (if available)
        if (device.name && !device.name.startsWith(DEVICE_NAME)) {
          console.warn(`[BLE] Warning: Device name "${device.name}" does not match expected prefix "${DEVICE_NAME}"`);
          console.warn('[BLE] Proceeding anyway - user may have selected correct device manually');
        }
        
        this.device = device;
        await this.connectReal();
      } else {
        throw new Error('No device selected');
      }
    } catch (error) {
      console.error('[BLE] Scan failed:', error);
      this.callbacks?.onConnectionStateChange('disconnected');
      const errorMessage = error instanceof Error ? error.message : 'Scan failed or cancelled';
      this.callbacks?.onError?.(errorMessage);
    }
  }

  private async connectReal(): Promise<void> {
    if (!this.device) {
      throw new Error('No device to connect');
    }

    this.callbacks?.onConnectionStateChange('connecting');
    console.log('[BLE] Connecting...');

    try {
      await BleClient.connect(this.device.deviceId, (deviceId) => {
        console.log('[BLE] Disconnected:', deviceId);
        this.handleDisconnect();
      });

      console.log('[BLE] ✓ Connected');

      // Subscribe to audio characteristic notifications
      await BleClient.startNotifications(
        this.device.deviceId,
        SERVICE_UUID,
        AUDIO_CHAR_UUID,
        (value) => this.handleAudioNotification(value)
      );

      console.log('[BLE] Subscribing to audio notifications...');
      this.callbacks?.onConnectionStateChange('connected');
      this.reconnectAttempts = 0;

      // Note: Time sync is now handled by TimeSyncService
      // It will send time immediately and then every 60 seconds
      console.log('[BLE] Connection established - TimeSyncService will handle time sync');

    } catch (error) {
      console.error('[BLE] Connection failed:', error);
      this.callbacks?.onConnectionStateChange('disconnected');
      this.callbacks?.onError?.('Failed to connect to watch');
      this.attemptReconnect();
    }
  }

  private async connectMock(): Promise<void> {
    if (!this.mockService) return;
    this.callbacks?.onConnectionStateChange('connecting');
    await this.mockService.connect();
    this.callbacks?.onConnectionStateChange('connected');
    this.chunkCounter = 0;
    await this.mockService.startStreaming();
  }

  private handleAudioNotification(value: DataView): void {
    const data = new Uint8Array(value.buffer);
  
    let msg: string | null = null;
  
    try {
      const decoded = new TextDecoder().decode(data);
      const trimmed = decoded.trim();
  
      if (/^[\x20-\x7E]+$/.test(trimmed)) {
        msg = trimmed;
      }
    } catch {
      msg = null;
    }
  
    // Check for control messages first (REQ_TIME, SET_PERSONA, etc.)
    if (msg === PROTOCOL.REQ_TIME) {
      console.log('[BLE] → REQ_TIME received (control message)');
      this.callbacks?.onTimeRequest?.();
      this.callbacks?.onControlMessage?.('REQ_TIME');
      return; // CRITICAL: Don't process as audio or AI text
    }

    // Check for other control messages (SET_PERSONA_JSON, SET_PERSONA, etc.)
    if (msg && msg.startsWith('SET_PERSONA')) {
      console.log('[BLE] → Control message received:', msg);
      // Extract data after colon (SET_PERSONA_JSON:{"name":"..."} or SET_PERSONA:text)
      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const command = msg.substring(0, colonIndex);
        const data = msg.substring(colonIndex + 1);
        this.callbacks?.onControlMessage?.(command, data);
      } else {
        this.callbacks?.onControlMessage?.(msg);
      }
      return; // Don't process as audio or AI text
    }
  
    if (msg === PROTOCOL.START_VOICE) {
      console.log('[BLE] → START_V received');
      this.audioBuffer = [];
      this.mode = 'VOICE';
      this.isVoiceMode = true;
      this.chunkCounter = 0;
      this.callbacks?.onVoiceStateChange?.('listening');
      return;
    }
  
    if (msg === PROTOCOL.START_SILENT) {
      console.log('[BLE] → START_S received');
      this.audioBuffer = [];
      this.mode = 'SILENT';
      this.isVoiceMode = true; 
      this.chunkCounter = 0;
      this.callbacks?.onVoiceStateChange?.('listening');
      return;
    }
  
    if (msg === PROTOCOL.END) {
      console.log('[BLE] → END received');
  
      if (!this.audioBuffer.length) {
        console.warn('[BLE] END received but no ADPCM data buffered');
        this.isVoiceMode = false;
        return;
      }
  
      const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of this.audioBuffer) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
  
      this.audioBuffer = [];
      this.isVoiceMode = false;
  
      this.callbacks?.onAudioComplete?.(merged, this.mode);
      return;
    }
  
    if (this.isVoiceMode) {
      this.chunkCounter++;
      const total = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0) + data.length;
      console.log(`[BLE] Chunk ${this.chunkCounter} (${data.length} bytes) - Total: ${total} bytes`);
      this.audioBuffer.push(data);
      this.callbacks?.onAudioData?.(data);
    }
  }

  getAudioBuffer(): Uint8Array {
    const totalLength = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of this.audioBuffer) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return combined;
  }

  clearAudioBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * Send AI response text to watch
   * This is separate from sendTime() to avoid routing confusion
   * Fragments long messages into chunks (BLE limit is ~512 bytes per write)
   */
  async sendText(text: string): Promise<void> {
    if (this.mockMode) {
      console.log('[BLE] (mock) Skipping sendText, mock device');
      return;
    }

    if (!this.device) {
      throw new Error('Not connected to device');
    }

    console.log('[BLE] Sending AI text response:', text.substring(0, 50) + '...');
    console.log('[BLE] Text length:', text.length, 'bytes');

      const encoder = new TextEncoder();
    const fullData = encoder.encode(text);
    const maxChunkSize = 400; // Conservative limit (512 - overhead for BLE)
    
    try {
      
      // If message fits in one chunk, send directly
      if (fullData.length <= maxChunkSize) {
        const dataView = new DataView(fullData.buffer, fullData.byteOffset, fullData.byteLength);
        await BleClient.write(
          this.device.deviceId,
          SERVICE_UUID,
          TEXT_CHAR_UUID,
          dataView
        );
        console.log('[BLE] AI text sent successfully (single chunk)');
        return;
      }

      // Fragment message into chunks
      const totalChunks = Math.ceil(fullData.length / maxChunkSize);
      console.log(`[BLE] Fragmenting message into ${totalChunks} chunks`);
      let offset = 0;
      let chunkIndex = 0;
      
      try {
        while (offset < fullData.length) {
          const chunkSize = Math.min(maxChunkSize, fullData.length - offset);
          const chunk = fullData.slice(offset, offset + chunkSize);
          const dataView = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      
          try {
      await BleClient.write(
        this.device.deviceId,
        SERVICE_UUID,
        TEXT_CHAR_UUID,
        dataView
      );

            chunkIndex++;
            offset += chunkSize;
            
            console.log(`[BLE] Sent chunk ${chunkIndex}/${totalChunks} (${chunkSize} bytes)`);
            
            // Small delay between chunks to avoid overwhelming the BLE stack
            if (offset < fullData.length) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } catch (chunkError) {
            console.error(`[BLE] Failed to send chunk ${chunkIndex + 1}/${totalChunks}:`, chunkError);
            throw new Error(`Failed to send chunk ${chunkIndex + 1}: ${chunkError instanceof Error ? chunkError.message : String(chunkError)}`);
          }
        }

        console.log('[BLE] AI text sent successfully (fragmented)');
      } catch (fragError) {
        console.error('[BLE] Fragmentation failed:', fragError);
        throw fragError;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[BLE] Failed to send AI text:', errorMsg);
      console.error('[BLE] Error details:', {
        textLength: text.length,
        encodedLength: fullData.length,
        deviceConnected: !!this.device,
      });
      this.callbacks?.onError?.('Failed to send response to watch');
      throw error;
    }
  }

  /**
   * Send AI response text (alias for sendText for clarity)
   */
  async sendAiText(text: string): Promise<void> {
    return this.sendText(text);
  }

  /**
   * Send time to watch using TIME: prefix
   * This is separate from sendText() to prevent time from appearing as AI answer
   * Format: "TIME:<epoch_seconds>"
   */
  async sendTime(): Promise<void> {
    if (this.mockMode) {
      console.log('[BLE] (mock) Skipping time sync');
      return;
    }

    if (!this.device) {
      console.warn('[BLE] Cannot send time - not connected');
      return;
    }

    // Unix epoch in seconds
    // FIX: The watch is interpreting UTC as local time, so we need to send local time
    // adjusted to appear as UTC. We calculate what UTC timestamp would show the local time.
    const now = new Date();
    const epochSecondsUTC = Math.floor(now.getTime() / 1000);
    
    // Get local time components
    const localYear = now.getFullYear();
    const localMonth = now.getMonth();
    const localDate = now.getDate();
    const localHours = now.getHours();
    const localMinutes = now.getMinutes();
    const localSeconds = now.getSeconds();
    
    // Create UTC timestamp that represents the local time (watch will display it as-is)
    // This is what the watch needs: a UTC timestamp that when displayed shows local time
    const localAsUTCTimestamp = Date.UTC(localYear, localMonth, localDate, localHours, localMinutes, localSeconds);
    const epochSeconds = Math.floor(localAsUTCTimestamp / 1000);
    
    const timeString = `${PROTOCOL.TIME_PREFIX}${epochSeconds}`;
    
    // Log for debugging
    const localTime = now.toLocaleTimeString();
    const utcTime = now.toUTCString();
    const timezoneOffset = -now.getTimezoneOffset() / 60; // Offset in hours
    console.log('[BLE] Sending time (TIME: prefix):', timeString);
    console.log('[BLE] Current time - Local:', localTime, 'UTC:', utcTime);
    console.log('[BLE] Timezone offset:', timezoneOffset, 'hours');
    console.log('[BLE] Epoch sent:', epochSeconds, '(local time as UTC) vs UTC epoch:', epochSecondsUTC);

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(timeString);
      const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      
      await BleClient.write(
        this.device.deviceId,
        SERVICE_UUID,
        TEXT_CHAR_UUID,
        dataView
      );

      console.log('[BLE] Time sent successfully (via dedicated time channel)');
    } catch (error) {
      console.error('[BLE] Failed to send time:', error);
      // Don't throw - time sync failures shouldn't break the app
    }
  }

  private handleDisconnect(): void {
    this.callbacks?.onConnectionStateChange('disconnected');
    this.callbacks?.onVoiceStateChange('idle');
    this.isVoiceMode = false;
    this.chunkCounter = 0;

    if (this.mockMode) {
      return;
    }

    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.log('[BLE] Max reconnect attempts reached');
      this.callbacks?.onError?.('Unable to reconnect. Please scan again.');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[BLE] Reconnect attempt ${this.reconnectAttempts}/${BLE_CONFIG.MAX_RECONNECT_ATTEMPTS}`);

    await new Promise(resolve => setTimeout(resolve, BLE_CONFIG.RECONNECT_DELAY));
    
    if (this.device) {
      try {
        await this.connectReal();
      } catch (error) {
        console.error('[BLE] Reconnect failed:', error);
      }
    }
  }

  async disconnect(): Promise<void> {
    // Stop time sync service when disconnecting
    // Note: TimeSyncService will be stopped by useBle hook, but we ensure it here too
    
    if (this.device && !this.mockMode) {
      try {
        await BleClient.stopNotifications(
          this.device.deviceId,
          SERVICE_UUID,
          AUDIO_CHAR_UUID
        );
        await BleClient.disconnect(this.device.deviceId);
      } catch (error) {
        console.error('[BLE] Disconnect error:', error);
      }
    }

    if (this.mockMode) {
      this.mockService?.disconnect();
    }

    this.device = null;
    this.isVoiceMode = false;
    this.audioBuffer = [];
    this.callbacks?.onConnectionStateChange('disconnected');
    this.callbacks?.onVoiceStateChange('idle');
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  getDeviceName(): string | null {
    return this.device?.name || null;
  }
}

// Singleton instance
export const bleManager = new BleManager();

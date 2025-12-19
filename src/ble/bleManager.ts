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
import { logger } from '@/utils/logger';
import { isBlePreInitialized, waitForBleReady } from './bleBootstrap';

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected';
export type VoiceState = 'idle' | 'listening' | 'processing' | 'responding';

export interface BleManagerCallbacks {
  onConnectionStateChange?: (state: ConnectionState) => void | Promise<void>;
  onVoiceStateChange?: (state: VoiceState) => void;
  onAudioData?: (data: Uint8Array) => void;
  onVoiceEnd?: () => void;
  onTimeRequest?: () => void;
  onError?: (error: string) => void;
  onAudioComplete?: (adpcmData: Uint8Array, mode: 'VOICE' | 'SILENT') => void;
  onControlMessage?: (command: string, data?: string) => void;
}

class BleManager {
  private device: BleDevice | null = null;
  private lastDeviceId: string | null = null; // Store device ID for reconnection
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
    logger.debug(`Mode: ${this.mockMode ? 'MOCK/DEMO' : 'REAL'}`, 'BLE');

    if (this.mockMode) {
      this.isInitialized = true;
      this.mockService = new MockBleService({
        onNotification: (value) => this.handleAudioNotification(value),
        onDisconnect: () => this.handleDisconnect(),
      });
      logger.debug('Mock service ready', 'BLE');
      return;
    }

    try {
      // Usar pre-inicialización si ya está lista (ahorra ~100-200ms)
      if (isBlePreInitialized()) {
        logger.debug('Using pre-initialized BLE', 'BLE');
        this.isInitialized = true;
        return;
      }

      // Esperar pre-inicialización en progreso o inicializar ahora
      await waitForBleReady();
      
      if (isBlePreInitialized()) {
        logger.debug('BLE pre-initialization completed', 'BLE');
        this.isInitialized = true;
        return;
      }

      // Fallback: inicializar ahora si pre-inicialización falló
      await BleClient.initialize();
      this.isInitialized = true;
      logger.info('Initialized successfully', 'BLE');
    } catch (error) {
      logger.error('Initialization failed', 'BLE', error instanceof Error ? error : new Error(String(error)));
      this.callbacks?.onError?.('Failed to initialize Bluetooth');
      throw error;
    }
  }

  async scan(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('BLE not initialized');
    }

    this.callbacks?.onConnectionStateChange('scanning');
    logger.info('Scanning for Hollow Watch', 'BLE');

    if (this.mockMode) {
      try {
        const device = await this.mockService!.scan();
        this.device = device as unknown as BleDevice;
        this.callbacks?.onConnectionStateChange('connecting');
        await this.connectMock();
      } catch (error) {
        logger.error('Mock scan failed', 'BLE', error instanceof Error ? error : new Error(String(error)));
        this.callbacks?.onConnectionStateChange('disconnected');
        this.callbacks?.onError?.('Mock scan failed');
      }
      return;
    }

    try {
      logger.debug(`Scanning for device with namePrefix: "${DEVICE_NAME}"`, 'BLE');

      const device = await BleClient.requestDevice({
        namePrefix: DEVICE_NAME,
        optionalServices: [SERVICE_UUID],
      });

      if (!device) {
        throw new Error('No device selected');
      }

      logger.info(`Device found: ${device.name ?? 'Unknown'}`, 'BLE');

      if (device.name && !device.name.startsWith(DEVICE_NAME)) {
        logger.warn(`Device name "${device.name}" does not match expected prefix "${DEVICE_NAME}"`, 'BLE');
      }

      this.device = device;
      await this.connectReal();
    } catch (error) {
      logger.error('Scan failed', 'BLE', error instanceof Error ? error : new Error(String(error)));
      this.callbacks?.onConnectionStateChange('disconnected');
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isCancelled = errorMsg.toLowerCase().includes('cancel') ||
        errorMsg.toLowerCase().includes('user') ||
        errorMsg.toLowerCase().includes('abort');

      const errorMessage = isCancelled
        ? 'Connection cancelled'
        : (error instanceof Error ? error.message : 'Scan failed');

      this.callbacks?.onError?.(errorMessage);
    }
  }

  private async connectReal(): Promise<void> {
    if (!this.device) {
      throw new Error('No device to connect');
    }

    this.callbacks?.onConnectionStateChange('connecting');
    logger.info('Connecting', 'BLE');

    try {
      await BleClient.connect(this.device.deviceId, (deviceId) => {
        logger.info(`Disconnected: ${deviceId}`, 'BLE');
        this.handleDisconnect();
      });

      logger.info('Connected', 'BLE');
      
      // Store device ID for potential reconnection
      this.lastDeviceId = this.device.deviceId;

      await BleClient.startNotifications(
        this.device.deviceId,
        SERVICE_UUID,
        AUDIO_CHAR_UUID,
        (value) => this.handleAudioNotification(value)
      );

      logger.debug('Subscribed to audio notifications', 'BLE');
      this.callbacks?.onConnectionStateChange('connected');
      this.reconnectAttempts = 0;

    } catch (error) {
      logger.error('Connection failed', 'BLE', error instanceof Error ? error : new Error(String(error)));
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


    if (msg === PROTOCOL.REQ_TIME) {
      logger.debug('REQ_TIME received', 'BLE');
      this.callbacks?.onTimeRequest?.();
      this.callbacks?.onControlMessage?.('REQ_TIME');
      return;
    }

    if (msg && msg.startsWith('SET_PERSONA')) {
      logger.debug(`Control message received: ${msg}`, 'BLE');

      const colonIndex = msg.indexOf(':');
      if (colonIndex !== -1) {
        const command = msg.substring(0, colonIndex);
        const data = msg.substring(colonIndex + 1);
        this.callbacks?.onControlMessage?.(command, data);
      } else {
        this.callbacks?.onControlMessage?.(msg);
      }
      return;
    }

    if (msg === PROTOCOL.START_VOICE) {
      logger.debug('START_V received', 'BLE');
      this.audioBuffer = [];
      this.mode = 'VOICE';
      this.isVoiceMode = true;
      this.chunkCounter = 0;
      this.callbacks?.onVoiceStateChange?.('listening');
      return;
    }

    if (msg === PROTOCOL.START_SILENT) {
      logger.debug('START_S received', 'BLE');
      this.audioBuffer = [];
      this.mode = 'SILENT';
      this.isVoiceMode = true;
      this.chunkCounter = 0;
      this.callbacks?.onVoiceStateChange?.('listening');
      return;
    }

    if (msg === PROTOCOL.END) {
      logger.debug('END received', 'BLE');

      if (!this.audioBuffer.length) {
        logger.warn('END received but no ADPCM data buffered', 'BLE');
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
      logger.debug(`Chunk ${this.chunkCounter} (${data.length} bytes) - Total: ${total} bytes`, 'BLE');
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


  async sendText(text: string): Promise<void> {
    if (this.mockMode) {
      logger.debug('Skipping sendText, mock device', 'BLE');
      return;
    }

    if (!this.device) {
      throw new Error('Not connected to device');
    }

    logger.debug(`Sending AI text response (${text.length} bytes)`, 'BLE');

    const encoder = new TextEncoder();
    const fullData = encoder.encode(text);
    const maxChunkSize = 400;

    try {
      if (fullData.length <= maxChunkSize) {
        const dataView = new DataView(fullData.buffer, fullData.byteOffset, fullData.byteLength);
        await BleClient.write(
          this.device.deviceId,
          SERVICE_UUID,
          TEXT_CHAR_UUID,
          dataView
        );
        logger.debug('AI text sent successfully (single chunk)', 'BLE');
        return;
      }

      const totalChunks = Math.ceil(fullData.length / maxChunkSize);
      logger.debug(`Fragmenting message into ${totalChunks} chunks`, 'BLE');
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

            logger.debug(`Sent chunk ${chunkIndex}/${totalChunks} (${chunkSize} bytes)`, 'BLE');

            if (offset < fullData.length) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } catch (chunkError) {
            logger.error(`Failed to send chunk ${chunkIndex + 1}/${totalChunks}`, 'BLE', chunkError instanceof Error ? chunkError : new Error(String(chunkError)));
            throw new Error(`Failed to send chunk ${chunkIndex + 1}: ${chunkError instanceof Error ? chunkError.message : String(chunkError)}`);
          }
        }

        logger.debug('AI text sent successfully (fragmented)', 'BLE');
      } catch (fragError) {
        logger.error('Fragmentation failed', 'BLE', fragError instanceof Error ? fragError : new Error(String(fragError)));
        throw fragError;
      }
    } catch (error) {
      logger.error('Failed to send AI text', 'BLE', error instanceof Error ? error : new Error(String(error)));
      this.callbacks?.onError?.('Failed to send response to watch');
      throw error;
    }
  }


  async sendAiText(text: string): Promise<void> {
    const bleSendStart = performance.now();
    await this.sendText(text);
    const bleSendTime = performance.now() - bleSendStart;
    logger.info(`[TIMING] BLE send to watch: ${bleSendTime.toFixed(2)}ms`, 'BLE');
  }

  async sendTime(): Promise<void> {
    if (this.mockMode) {
      logger.debug('Skipping time sync', 'BLE');
      return;
    }

    if (!this.device) {
      logger.warn('Cannot send time - not connected', 'BLE');
      return;
    }

    const now = new Date();
    const epochSecondsUTC = Math.floor(now.getTime() / 1000);

    const localYear = now.getFullYear();
    const localMonth = now.getMonth();
    const localDate = now.getDate();
    const localHours = now.getHours();
    const localMinutes = now.getMinutes();
    const localSeconds = now.getSeconds();

    const localAsUTCTimestamp = Date.UTC(localYear, localMonth, localDate, localHours, localMinutes, localSeconds);
    const epochSeconds = Math.floor(localAsUTCTimestamp / 1000);

    const timeString = `${PROTOCOL.TIME_PREFIX}${epochSeconds}`;

    logger.debug(`Sending time: ${timeString}`, 'BLE');

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

      logger.debug('Time sent successfully', 'BLE');
    } catch (error) {
      logger.error('Failed to send time', 'BLE', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleDisconnect(): void {
    logger.info('Device disconnected', 'BLE');
    this.callbacks?.onConnectionStateChange('disconnected');
    this.callbacks?.onVoiceStateChange('idle');
    this.isVoiceMode = false;
    this.chunkCounter = 0;
    this.clearAudioBuffer();

    if (this.mockMode) {
      this.device = null;
      this.lastDeviceId = null;
      return;
    }

    // Only attempt reconnect if we have a device ID and haven't exceeded max attempts
    if (this.lastDeviceId && this.reconnectAttempts < BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      this.attemptReconnect();
    } else if (this.reconnectAttempts >= BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.warn('Max reconnection attempts reached, stopping', 'BLE');
      this.callbacks?.onError?.('Connection lost. Please reconnect manually.');
      this.device = null;
      this.lastDeviceId = null;
    } else {
      this.device = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.warn('Max reconnect attempts reached', 'BLE');
      this.callbacks?.onError?.('Unable to reconnect. Please scan again.');
      this.device = null;
      this.lastDeviceId = null;
      return;
    }

    if (!this.lastDeviceId) {
      logger.warn('No device ID available for reconnection', 'BLE');
      return;
    }

    this.reconnectAttempts++;
    logger.info(`Reconnect attempt ${this.reconnectAttempts}/${BLE_CONFIG.MAX_RECONNECT_ATTEMPTS}`, 'BLE');

    // Exponential backoff: 2s, 4s, 8s, etc.
    const delay = BLE_CONFIG.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      // Try to reconnect using the stored device ID
      await BleClient.connect(this.lastDeviceId, (deviceId) => {
        logger.info(`Disconnected during reconnect: ${deviceId}`, 'BLE');
        this.handleDisconnect();
      });

      logger.info('Reconnected successfully', 'BLE');
      
      // Recreate device object for notifications
      this.device = { deviceId: this.lastDeviceId } as BleDevice;

      await BleClient.startNotifications(
        this.lastDeviceId,
        SERVICE_UUID,
        AUDIO_CHAR_UUID,
        (value) => this.handleAudioNotification(value)
      );

      logger.debug('Subscribed to audio notifications after reconnect', 'BLE');
      this.callbacks?.onConnectionStateChange('connected');
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error('Reconnect failed', 'BLE', error instanceof Error ? error : new Error(String(error)));
      // Will retry if attempts < max
      if (this.reconnectAttempts < BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
        this.attemptReconnect();
      }
    }
  }

  async disconnect(): Promise<void> {
    // Reset reconnection attempts on manual disconnect
    this.reconnectAttempts = BLE_CONFIG.MAX_RECONNECT_ATTEMPTS;
    
    if (this.device && !this.mockMode) {
      try {
        await BleClient.stopNotifications(
          this.device.deviceId,
          SERVICE_UUID,
          AUDIO_CHAR_UUID
        );
        await BleClient.disconnect(this.device.deviceId);
      } catch (error) {
        logger.error('Disconnect error', 'BLE', error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    this.device = null;
    this.lastDeviceId = null;

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

  getDeviceId(): string | null {
    if (this.device) {
      return this.device.deviceId;
    }
    return null;
  }

  getDeviceName(): string | null {
    return this.device?.name || null;
  }
}
export const bleManager = new BleManager();

import { APP_CONFIG } from '@/config/app.config';

// BLE UUIDs for Hollow Watch (spec)
export const SERVICE_UUID = APP_CONFIG.SERVICE_UUID;
export const AUDIO_CHAR_UUID = APP_CONFIG.AUDIO_CHAR_UUID;
export const TEXT_CHAR_UUID = APP_CONFIG.TEXT_CHAR_UUID;

// Device name prefix to scan for
export const DEVICE_NAME = APP_CONFIG.DEVICE_NAME_PREFIX;

// Protocol markers
export const PROTOCOL = {
  START_VOICE: 'START_V',
  START_SILENT: 'START_S',
  END: 'END',
  GET_TIME: 'GET_TIME',
  REQ_TIME: 'REQ_TIME', // Watch requests time
  TIME_PREFIX: 'TIME:', // Prefix for time messages sent to watch
} as const;

// BLE connection settings
export const BLE_CONFIG = {
  SCAN_TIMEOUT: 10000, // 10 seconds
  RECONNECT_DELAY: 2000, // 2 seconds
  MAX_RECONNECT_ATTEMPTS: 5,
} as const;

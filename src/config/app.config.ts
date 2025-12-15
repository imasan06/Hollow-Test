export const APP_CONFIG = {
  // BLE behavior
  BLE_MOCK_MODE: process.env.REACT_APP_MOCK_MODE === 'false' || false,
  // Hollow Watch BLE UUIDs (spec)
  SERVICE_UUID: '4FAFC201-1FB5-459E-8FCC-C5C9C331914B',
  AUDIO_CHAR_UUID: 'BEB5483E-36E1-4688-B7F5-EA07361B26A8',
  TEXT_CHAR_UUID: '0A3D547E-6967-4660-A744-8ACE08191266',
  DEVICE_NAME_PREFIX: 'Hollow 1W',

  // Audio settings - actual sample rate from watch (8kHz based on logs: 29696 samples / 3.71s = 8000 Hz)
  MOCK_AUDIO_DURATION_SECONDS: 3,
  MOCK_CHUNK_SIZE_BYTES: 128,
  MOCK_CHUNK_DELAY_MS: 100,
  MOCK_FREQUENCY_HZ: 440,
  MOCK_SAMPLE_RATE: 8000, // 8kHz - actual sample rate from Hollow 1W watch
} as const;


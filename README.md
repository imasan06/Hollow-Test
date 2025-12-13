# Hollow Watch Companion (React + Capacitor)

Companion app for the **Hollow Watch** that records audio over BLE, decodes IMA ADPCM → PCM16, wraps it into WAV, and sends it to the backend for transcription/LLM response.  
The app now supports **two interchangeable modes**: real hardware and full mock/demo without hardware.

## Quick start

```bash
npm install
npm run dev
```

## Configuration

All mode toggles and BLE constants live in `src/config/app.config.ts`:

```ts
export const APP_CONFIG = {
  BLE_MOCK_MODE: false,          // true = demo/mock, false = real watch
  SERVICE_UUID: '0000abcd-0000-1000-8000-00805f9b34fb',
  AUDIO_CHAR_UUID: '0000abcd-0001-1000-8000-00805f9b34fb',
  TEXT_CHAR_UUID: '0a3d547e-6967-4660-a744-8ace08191266',
  DEVICE_NAME_PREFIX: 'Hollow 1W',
  MOCK_AUDIO_DURATION_SECONDS: 3,
  MOCK_CHUNK_SIZE_BYTES: 128,
  MOCK_CHUNK_DELAY_MS: 100,
  MOCK_FREQUENCY_HZ: 440,
  MOCK_SAMPLE_RATE: 8000,
};
```

Toggle between modes by changing only `BLE_MOCK_MODE`.

## Modes

- **Production (real hardware)**  
  - Uses Capacitor `BleClient` with the Hollow Watch service/characteristics above.  
  - Receives real notifications and decodes ADPCM → PCM → WAV.  
  - Normal reconnection + time sync behavior.

- **Mock/Demo (no hardware required)**  
  - Fully simulates scan, connect, and streaming.  
  - Generates a 440Hz sine wave in PCM, encodes to **valid IMA ADPCM**, and emits 128-byte chunks every 100ms.  
  - Sends START_V and END markers; logs mirror the real flow.  
  - UI shows a small `DEMO MODE` badge.

## Testing

### Mock mode (no watch)
1. Set `BLE_MOCK_MODE: true` in `src/config/app.config.ts`.
2. `npm run dev` and open the app.
3. Click “Connect Watch”. You should see:
   - `[BLE] Scanning for Hollow Watch...`
   - `[BLE] Device found: Hollow-DEMO`
   - `[BLE] ✓ Connected`
   - Chunk logs, then `→ END received` and WAV processing.
4. Audio decodes, WAV is generated, and the app proceeds as if real hardware sent it.

### Real mode (with watch)
1. Set `BLE_MOCK_MODE: false`.
2. `npm run dev` on a device with BLE + Capacitor native runtime.
3. Click “Connect Watch”; the app will request a device with the configured UUIDs and name prefix.
4. Speak into the watch; chunks arrive, decode, and are sent to the backend as WAV.

## Notes
- ADPCM decoding uses the standard IMA ADPCM algorithm (8kHz mono as per Hollow spec).  
- WAV encoding now uses the same 8kHz sample rate.  
- Logs in both modes are intentionally identical for demos.  
- The mock keeps realistic timing (100ms between 128-byte chunks) to mimic the watch.

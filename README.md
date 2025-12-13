
## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Open the app:**
   - For Mock/Demo mode: Open the URL shown in the terminal (typically `http://localhost:5173`)
   - For Real Hardware mode: Build and deploy to an Android device (see [Running with Real Watch](#running-with-real-watch) section)

## Configuration

The app configuration is located in `src/config/app.config.ts`. The main toggle is:

```typescript
BLE_MOCK_MODE: boolean
```

### BLE Service UUIDs
- `SERVICE_UUID`: `0000abcd-0000-1000-8000-00805f9b34fb`
- `AUDIO_CHAR_UUID`: `0000abcd-0001-1000-8000-00805f9b34fb`
- `TEXT_CHAR_UUID`: `0a3d547e-6967-4660-a744-8ace08191266`
- `DEVICE_NAME_PREFIX`: `Hollow 1W`

### Mock Audio Settings
- `MOCK_AUDIO_DURATION_SECONDS`: 3
- `MOCK_CHUNK_SIZE_BYTES`: 128
- `MOCK_CHUNK_DELAY_MS`: 100
- `MOCK_FREQUENCY_HZ`: 440
- `MOCK_SAMPLE_RATE`: 8000

## Running in MOCK/DEMO Mode (No Watch Required)

This mode simulates the entire BLE connection and audio streaming flow without requiring physical hardware. It's perfect for development, testing, and demonstrations.

### Steps

1. **Enable Mock Mode:**
   - Open `src/config/app.config.ts`
   - Set `BLE_MOCK_MODE: true`

2. **Start the development server:**
   ```bash
   npm run dev
   ```

3. **Open the app in your browser:**
   - Navigate to the URL shown in the terminal (e.g., `http://localhost:5173`)

4. **Click "Connect Watch"** in the app interface

### Expected Console Log Sequence

When running in Mock/Demo mode, you should see the following log sequence in your browser's developer console:

```
[BLE] Mode: MOCK/DEMO
[BLE] Mock service ready
[BLE] Scanning for Hollow Watch...
[BLE] Device found: Hollow-DEMO
[BLE] Connecting...
[BLE] ✓ Connected
[BLE] Subscribing to audio notifications...
[BLE] → START_V received
[BLE] Chunk 1/... (128 bytes) - Total: 128 bytes
[BLE] Chunk 2/... (128 bytes) - Total: 256 bytes
[BLE] Chunk 3/... (128 bytes) - Total: 384 bytes
...
[BLE] → END received
[Hook] onAudioComplete called. Mode: VOICE
[Hook] Processing ADPCM buffer, size: ...
[Hook] Decoded to PCM samples: ...
[Hook] Audio duration: 3.00 seconds
[Hook] WAV base64 length: ...
```

The mock mode generates a 3-second 440Hz sine wave, encodes it as IMA ADPCM, and streams it in chunks to simulate the real watch behavior. The audio processing pipeline (ADPCM → PCM16 → WAV) works identically to the real hardware flow.

## Running with Real Watch

To connect to an actual Hollow Watch device, you need to build the app as a native Android application using Capacitor.

### Steps

1. **Disable Mock Mode:**
   - Open `src/config/app.config.ts`
   - Set `BLE_MOCK_MODE: false`

2. **Build the web assets:**
   ```bash
   npm run build
   ```

3. **Sync Capacitor with Android:**
   ```bash
   npx cap sync android
   ```

4. **Open Android Studio:**
   ```bash
   npx cap open android
   ```

5. **Deploy to device:**
   - Connect your Android device via USB (enable USB debugging)
   - In Android Studio, select your device from the device dropdown
   - Click the "Run" button (green play icon) or press `Shift+F10`
   - The app will be installed and launched on your device

### BLE Scanning Flow

When you click "Connect Watch" in the app:

1. **Permission Prompts:**
   - The app will request Bluetooth permissions (`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`)
   - On Android 12+, Location permission may also be required for BLE scanning
   - Grant all requested permissions

2. **Device Picker:**
   - A system dialog will appear showing available BLE devices
   - Look for devices with names starting with "Hollow 1W"
   - Select your watch from the list

3. **Connection:**
   - The app will connect to the selected device
   - Audio notifications will be subscribed automatically
   - Time synchronization will be sent to the watch

4. **Audio Reception:**
   - When the watch sends audio, you'll see chunk logs in the console
   - The app will decode ADPCM → PCM16 → WAV automatically
   - Audio will be sent to the backend for transcription



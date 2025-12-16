import { APP_CONFIG } from '@/config/app.config';
import { PROTOCOL } from './constants';

interface MockDevice {
  deviceId: string;
  name: string;
}

export interface MockBleEvents {
  onNotification: (dataView: DataView) => void;
  onDisconnect?: () => void;
}

const IMA_STEP_TABLE: number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
  19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
  337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
  876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
  2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
  5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];

const IMA_INDEX_TABLE: number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function encodeAdpcmNibble(sample: number, state: { predictor: number; stepIndex: number }): number {
  let predictor = state.predictor;
  let stepIndex = state.stepIndex;
  const step = IMA_STEP_TABLE[stepIndex];

  let diff = sample - predictor;
  let nibble = 0;

  if (diff < 0) {
    nibble = 8;
    diff = -diff;
  }

  let delta = step >> 3;
  if (diff >= step) {
    nibble |= 4;
    diff -= step;
    delta += step;
  }
  if (diff >= (step >> 1)) {
    nibble |= 2;
    diff -= step >> 1;
    delta += step >> 1;
  }
  if (diff >= (step >> 2)) {
    nibble |= 1;
    delta += step >> 2;
  }

  predictor += (nibble & 8) ? -delta : delta;
  predictor = clamp(predictor, -32768, 32767);

  stepIndex = clamp(stepIndex + IMA_INDEX_TABLE[nibble], 0, 88);

  state.predictor = predictor;
  state.stepIndex = stepIndex;

  return nibble & 0x0f;
}

function encodeImaAdpcm(samples: Int16Array): Uint8Array {
  const state = { predictor: 0, stepIndex: 0 };
  const out = new Uint8Array(Math.ceil(samples.length / 2));
  let outIndex = 0;

  for (let i = 0; i < samples.length; i += 2) {
    const nibble1 = encodeAdpcmNibble(samples[i], state);
    const nibble2 = (i + 1 < samples.length) ? encodeAdpcmNibble(samples[i + 1], state) : 0;
    out[outIndex++] = nibble1 | (nibble2 << 4);
  }

  return out;
}

function generateSinePcm(durationSeconds: number, frequency: number, sampleRate: number): Int16Array {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const pcm = new Int16Array(totalSamples);
  const amplitude = 6000;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * frequency * t) * amplitude);
  }

  return pcm;
}


export function generateMockAdpcmAudio(
  durationSeconds: number,
  frequency: number,
  sampleRate: number,
  chunkSize: number
): Uint8Array[] {
  const pcm = generateSinePcm(durationSeconds, frequency, sampleRate);
  const adpcm = encodeImaAdpcm(pcm);

  const chunks: Uint8Array[] = [];
  for (let i = 0; i < adpcm.length; i += chunkSize) {
    chunks.push(adpcm.slice(i, Math.min(i + chunkSize, adpcm.length)));
  }
  return chunks;
}

export class MockBleService {
  private device: MockDevice = { deviceId: 'MOCK-DEVICE', name: 'Hollow-DEMO' };
  private events: MockBleEvents;
  private connected = false;

  constructor(events: MockBleEvents) {
    this.events = events;
  }

  async scan(): Promise<MockDevice> {
    logger.debug('Scanning for Hollow Watch', 'BLE');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.debug('Device found: Hollow-DEMO', 'BLE');
    return this.device;
  }

  async connect(): Promise<void> {
    logger.debug('Connecting', 'BLE');
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.connected = true;
    logger.debug('Connected', 'BLE');
  }

  async startStreaming(): Promise<void> {
    if (!this.connected) return;

    logger.debug('Subscribing to audio notifications', 'BLE');
    this.emitText(PROTOCOL.START_VOICE);

    const chunks = generateMockAdpcmAudio(
      APP_CONFIG.MOCK_AUDIO_DURATION_SECONDS,
      APP_CONFIG.MOCK_FREQUENCY_HZ,
      APP_CONFIG.MOCK_SAMPLE_RATE,
      APP_CONFIG.MOCK_CHUNK_SIZE_BYTES
    );

    let total = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      total += chunk.length;
      logger.debug(`Chunk ${i + 1}/${chunks.length} (${chunk.length} bytes) - Total: ${total} bytes`, 'BLE');
      this.emitBytes(chunk);
      await new Promise((resolve) => setTimeout(resolve, APP_CONFIG.MOCK_CHUNK_DELAY_MS));
    }

    this.emitText(PROTOCOL.END);
    logger.debug(`Audio complete: ${total} bytes ADPCM`, 'BLE');
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.events.onDisconnect?.();
  }

  private emitText(text: string): void {
    const data = new TextEncoder().encode(text);
    this.events.onNotification(new DataView(data.buffer));
  }

  private emitBytes(bytes: Uint8Array): void {
    this.events.onNotification(new DataView(bytes.buffer));
  }
}


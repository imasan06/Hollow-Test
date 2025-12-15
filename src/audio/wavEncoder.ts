/**
 * WAV Encoder
 * 
 * Creates valid 16-bit mono WAV files from PCM16 samples.
 * Uses actual sample rate from Hollow 1W watch (8kHz).
 * Note: Python example uses 16kHz, but actual watch sends 8kHz.
 */

import { APP_CONFIG } from '@/config/app.config';

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE; // 8kHz - actual sample rate from watch
const NUM_CHANNELS = 1;    // Mono
const BITS_PER_SAMPLE = 16;
const BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
const BLOCK_ALIGN = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

/**
 * Create a WAV file header
 */
function createWavHeader(dataSize: number): ArrayBuffer {
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8; // File size minus 8 bytes for RIFF header
  
  const header = new ArrayBuffer(headerSize);
  const view = new DataView(header);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize, true); // Little endian
  writeString(view, 8, 'WAVE');
  
  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);              // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);               // AudioFormat (1 = PCM)
  view.setUint16(22, NUM_CHANNELS, true);    // NumChannels
  view.setUint32(24, SAMPLE_RATE, true);     // SampleRate
  view.setUint32(28, BYTE_RATE, true);       // ByteRate
  view.setUint16(32, BLOCK_ALIGN, true);     // BlockAlign
  view.setUint16(34, BITS_PER_SAMPLE, true); // BitsPerSample
  
  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);        // Subchunk2Size
  
  return header;
}

/**
 * Write a string to a DataView
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Encode PCM16 samples to WAV format
 * 
 * @param samples - Int16Array of PCM samples
 * @returns Uint8Array containing valid WAV file data
 */
export function encodeWav(samples: Int16Array): Uint8Array {
  const dataSize = samples.length * 2; // 2 bytes per 16-bit sample
  const header = createWavHeader(dataSize);
  
  // Create combined buffer
  const wav = new Uint8Array(header.byteLength + dataSize);
  
  // Copy header
  wav.set(new Uint8Array(header), 0);
  
  // Copy sample data (already in little endian format from Int16Array)
  const sampleBytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  wav.set(sampleBytes, header.byteLength);
  
  return wav;
}

/**
 * Encode PCM16 samples to WAV and return as base64 string
 * 
 * @param samples - Int16Array of PCM samples
 * @returns Base64-encoded WAV file
 */
export function encodeWavBase64(samples: Int16Array): string {
  const wav = encodeWav(samples);
  return uint8ArrayToBase64(wav);
}

/**
 * Convert Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks to avoid call stack issues
  
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

/**
 * Create a Blob URL for audio playback
 * 
 * @param samples - Int16Array of PCM samples
 * @returns Object URL that can be used with <audio> element
 */
export function createAudioBlobUrl(samples: Int16Array): string {
  const wav = encodeWav(samples);
  const blob = new Blob([new Uint8Array(wav).buffer as ArrayBuffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Release a previously created blob URL
 */
export function releaseAudioBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Get audio duration in seconds
 */
export function getAudioDuration(sampleCount: number): number {
  return sampleCount / SAMPLE_RATE;
}

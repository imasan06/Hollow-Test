

import { APP_CONFIG } from '@/config/app.config';

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE;
const NUM_CHANNELS = 1;   
const BITS_PER_SAMPLE = 16;
const BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
const BLOCK_ALIGN = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);


function createWavHeader(dataSize: number): ArrayBuffer {
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8; 
  
  const header = new ArrayBuffer(headerSize);
  const view = new DataView(header);
  

  writeString(view, 0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeString(view, 8, 'WAVE');
  

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);             
  view.setUint16(20, 1, true);               
  view.setUint16(22, NUM_CHANNELS, true);   
  view.setUint32(24, SAMPLE_RATE, true);    
  view.setUint32(28, BYTE_RATE, true);       
  view.setUint16(32, BLOCK_ALIGN, true);     
  view.setUint16(34, BITS_PER_SAMPLE, true); 
  

  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);    
  
  return header;
}


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
  const dataSize = samples.length * 2;
  const header = createWavHeader(dataSize);
  

  const wav = new Uint8Array(header.byteLength + dataSize);
  

  wav.set(new Uint8Array(header), 0);
  
 
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


function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; 
  
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


export function releaseAudioBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}


export function getAudioDuration(sampleCount: number): number {
  return sampleCount / SAMPLE_RATE;
}

export function validateWavFormat(wavBase64: string): { valid: boolean; sampleRate?: number; channels?: number; error?: string } {
  try {
    const wavBytes = Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0));
    
    if (wavBytes.length < 44) {
      return { valid: false, error: 'WAV file too small' };
    }

    const view = new DataView(wavBytes.buffer);
    
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== 'RIFF') {
      return { valid: false, error: 'Invalid RIFF header' };
    }

    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (wave !== 'WAVE') {
      return { valid: false, error: 'Invalid WAVE header' };
    }

    const sampleRate = view.getUint32(24, true);
    const channels = view.getUint16(22, true);
    const bitsPerSample = view.getUint16(34, true);

    if (sampleRate !== SAMPLE_RATE) {
      return { valid: false, sampleRate, channels, error: `Sample rate must be ${SAMPLE_RATE}Hz, got ${sampleRate}Hz` };
    }

    if (channels !== NUM_CHANNELS) {
      return { valid: false, sampleRate, channels, error: `Must be mono (1 channel), got ${channels} channels` };
    }

    if (bitsPerSample !== BITS_PER_SAMPLE) {
      return { valid: false, sampleRate, channels, error: `Must be 16-bit, got ${bitsPerSample}-bit` };
    }

    return { valid: true, sampleRate, channels };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

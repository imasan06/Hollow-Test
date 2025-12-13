/**
 * IMA ADPCM Decoder
 * 
 * Decodes IMA ADPCM audio data to 16-bit PCM samples.
 * This implementation matches the standard IMA-ADPCM algorithm:
 * - Low nibble first (shift=0), then high nibble (shift=4)
 * - Predictor and step index persist across the entire sample stream
 * - Uses the standard IMA step table
 * - Index clamped between 0-88
 */

// IMA ADPCM Step Table (89 entries)
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

// IMA ADPCM Index Table
const IMA_INDEX_TABLE: number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];

export interface DecoderState {
  predictor: number;
  stepIndex: number;
}

/**
 * Decode a single IMA ADPCM nibble
 */
function decodeNibble(nibble: number, state: DecoderState): number {
  const step = IMA_STEP_TABLE[state.stepIndex];
  
  // Calculate difference
  let diff = step >> 3;
  if (nibble & 1) diff += step >> 2;
  if (nibble & 2) diff += step >> 1;
  if (nibble & 4) diff += step;
  if (nibble & 8) diff = -diff;
  
  // Update predictor
  state.predictor += diff;
  
  // Clamp predictor to 16-bit signed range
  if (state.predictor > 32767) state.predictor = 32767;
  if (state.predictor < -32768) state.predictor = -32768;
  
  // Update step index
  state.stepIndex += IMA_INDEX_TABLE[nibble];
  
  // Clamp step index to valid range (0-88)
  if (state.stepIndex < 0) state.stepIndex = 0;
  if (state.stepIndex > 88) state.stepIndex = 88;
  
  return state.predictor;
}

/**
 * Decode IMA ADPCM buffer to PCM16 samples
 * 
 * @param adpcmData - Raw ADPCM data (each byte contains 2 nibbles)
 * @param initialState - Optional initial decoder state (for streaming)
 * @returns Object containing PCM samples and final decoder state
 */
export function decodeImaAdpcm(
  adpcmData: Uint8Array,
  initialState?: DecoderState
): { samples: Int16Array; finalState: DecoderState } {
  const state: DecoderState = initialState 
    ? { ...initialState }
    : { predictor: 0, stepIndex: 0 };
  
  // Each byte produces 2 samples
  const samples = new Int16Array(adpcmData.length * 2);
  let sampleIndex = 0;
  
  for (let i = 0; i < adpcmData.length; i++) {
    const byte = adpcmData[i];
    
    // Low nibble first (shift=0)
    const lowNibble = byte & 0x0F;
    samples[sampleIndex++] = decodeNibble(lowNibble, state);
    
    // High nibble second (shift=4)
    const highNibble = (byte >> 4) & 0x0F;
    samples[sampleIndex++] = decodeNibble(highNibble, state);
  }
  
  return {
    samples,
    finalState: { ...state }
  };
}

/**
 * Create a streaming decoder that maintains state across multiple chunks
 */
export class ImaAdpcmStreamDecoder {
  private state: DecoderState = { predictor: 0, stepIndex: 0 };
  
  /**
   * Reset decoder state (call when starting new recording)
   */
  reset(): void {
    this.state = { predictor: 0, stepIndex: 0 };
  }
  
  /**
   * Decode a chunk of ADPCM data
   */
  decode(chunk: Uint8Array): Int16Array {
    const result = decodeImaAdpcm(chunk, this.state);
    this.state = result.finalState;
    return result.samples;
  }
  
  /**
   * Get current decoder state
   */
  getState(): DecoderState {
    return { ...this.state };
  }
}

// Export singleton for convenience
export const streamDecoder = new ImaAdpcmStreamDecoder();

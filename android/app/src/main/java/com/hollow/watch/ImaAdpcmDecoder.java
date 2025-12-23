package com.hollow.watch;

import android.util.Log;

/**
 * IMA ADPCM decoder - converts ADPCM encoded audio to 16-bit PCM samples
 * Ported from TypeScript implementation in src/audio/imaDecoder.ts
 */
public class ImaAdpcmDecoder {
    private static final String TAG = "ImaAdpcmDecoder";
    
    private static final int[] IMA_STEP_TABLE = {
        7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
        50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
        253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
        1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
        3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
        11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
        32767
    };
    
    private static final int[] IMA_INDEX_TABLE = {
        -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8
    };
    
    public static class DecoderState {
        public int predictor = 0;
        public int stepIndex = 0;
        
        public DecoderState() {}
        
        public DecoderState(int predictor, int stepIndex) {
            this.predictor = predictor;
            this.stepIndex = stepIndex;
        }
        
        public DecoderState copy() {
            return new DecoderState(predictor, stepIndex);
        }
    }
    
    /**
     * Decode a single 4-bit nibble
     */
    private static int decodeNibble(int nibble, DecoderState state) {
        int step = IMA_STEP_TABLE[state.stepIndex];
        
        int diff = step >> 3;
        if ((nibble & 1) != 0) diff += step >> 2;
        if ((nibble & 2) != 0) diff += step >> 1;
        if ((nibble & 4) != 0) diff += step;
        if ((nibble & 8) != 0) diff = -diff;
        
        state.predictor += diff;
        
        // Clamp predictor to 16-bit signed range
        if (state.predictor > 32767) state.predictor = 32767;
        if (state.predictor < -32768) state.predictor = -32768;
        
        state.stepIndex += IMA_INDEX_TABLE[nibble];
        
        // Clamp stepIndex to valid range
        if (state.stepIndex < 0) state.stepIndex = 0;
        if (state.stepIndex > 88) state.stepIndex = 88;
        
        return state.predictor;
    }
    
    /**
     * Decode ADPCM data to PCM samples
     * @param adpcmData Input ADPCM encoded bytes
     * @param initialState Optional initial decoder state (null for fresh decode)
     * @return Decoded PCM samples (16-bit signed) and final state
     */
    public static DecodeResult decode(byte[] adpcmData, DecoderState initialState) {
        DecoderState state = initialState != null ? initialState.copy() : new DecoderState();
        
        // Each byte contains 2 samples (4 bits each)
        short[] samples = new short[adpcmData.length * 2];
        int sampleIndex = 0;
        
        for (int i = 0; i < adpcmData.length; i++) {
            int byteValue = adpcmData[i] & 0xFF;
            
            // Decode low nibble (bits 0-3)
            int lowNibble = byteValue & 0x0F;
            samples[sampleIndex++] = (short) decodeNibble(lowNibble, state);
            
            // Decode high nibble (bits 4-7)
            int highNibble = (byteValue >> 4) & 0x0F;
            samples[sampleIndex++] = (short) decodeNibble(highNibble, state);
        }
        
        return new DecodeResult(samples, state.copy());
    }
    
    public static class DecodeResult {
        public final short[] samples;
        public final DecoderState finalState;
        
        public DecodeResult(short[] samples, DecoderState finalState) {
            this.samples = samples;
            this.finalState = finalState;
        }
    }
}


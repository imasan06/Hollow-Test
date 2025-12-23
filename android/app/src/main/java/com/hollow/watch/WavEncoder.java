package com.hollow.watch;

import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * WAV encoder - converts 16-bit PCM samples to WAV file format (Base64)
 * Ported from TypeScript implementation in src/audio/wavEncoder.ts
 */
public class WavEncoder {
    private static final String TAG = "WavEncoder";
    
    // Audio format constants (must match app.config.ts)
    private static final int SAMPLE_RATE = 16000;
    private static final int NUM_CHANNELS = 1;
    private static final int BITS_PER_SAMPLE = 16;
    private static final int BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
    private static final int BLOCK_ALIGN = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
    private static final int HEADER_SIZE = 44;
    
    /**
     * Encode PCM samples to WAV format and return as Base64 string
     * @param samples 16-bit signed PCM samples
     * @return Base64 encoded WAV file
     */
    public static String encodeToBase64(short[] samples) {
        try {
            int dataSize = samples.length * 2; // 2 bytes per sample
            int fileSize = HEADER_SIZE + dataSize - 8;
            
            // Create WAV file buffer
            byte[] wav = new byte[HEADER_SIZE + dataSize];
            ByteBuffer buffer = ByteBuffer.wrap(wav);
            buffer.order(ByteOrder.LITTLE_ENDIAN);
            
            // Write RIFF header
            buffer.put("RIFF".getBytes());
            buffer.putInt(fileSize);
            buffer.put("WAVE".getBytes());
            
            // Write fmt chunk
            buffer.put("fmt ".getBytes());
            buffer.putInt(16); // fmt chunk size
            buffer.putShort((short) 1); // audio format (1 = PCM)
            buffer.putShort((short) NUM_CHANNELS);
            buffer.putInt(SAMPLE_RATE);
            buffer.putInt(BYTE_RATE);
            buffer.putShort((short) BLOCK_ALIGN);
            buffer.putShort((short) BITS_PER_SAMPLE);
            
            // Write data chunk
            buffer.put("data".getBytes());
            buffer.putInt(dataSize);
            
            // Write sample data (little-endian 16-bit)
            for (short sample : samples) {
                buffer.putShort(sample);
            }
            
            // Convert to Base64
            return android.util.Base64.encodeToString(wav, android.util.Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "Error encoding WAV: " + e.getMessage(), e);
            throw new RuntimeException("Failed to encode WAV", e);
        }
    }
}


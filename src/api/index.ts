/**
 * Backend API wrapper for Hollow 0W
 * 
 * Handles communication with the LLM backend service.
 * Audio is sent to backend for transcription and LLM processing.
 */

// Hollow backend endpoint
const API_ENDPOINT = 'https://hollow-backend.fly.dev';

export interface TranscribeRequest {
  audio?: string; // WAV base64
  text?: string;  // Already transcribed text
  rules?: string;
  baserules?: string;
  persona?: string;
}

export interface TranscribeResponse {
  text: string;
  transcription?: string;
  error?: string;
}

/**
 * Send audio or text to backend for transcription and LLM processing
 * 
 * @param request - Request with audio (WAV base64) or text
 * @returns Promise resolving to LLM response text
 */
export async function sendTranscription(request: TranscribeRequest): Promise<TranscribeResponse> {
  const logContent = request.text 
    ? `text: ${request.text.substring(0, 100)}...`
    : `audio: ${request.audio?.substring(0, 50)}...`;
  console.log('[API] Sending to backend:', logContent);
  
  try {
    const response = await fetch(`${API_ENDPOINT}/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Server error:', response.status, errorText);
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log('[API] Received response:', data.text?.substring(0, 100) + '...');
    
    return data;
  } catch (error) {
    console.error('[API] Request failed:', error);
    throw error;
  }
}

/**
 * Health check for the API
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_ENDPOINT}/health`, {
      method: 'GET',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Local Speech-to-Text using Web Speech API
 * 
 * Transcribes audio locally on the device before sending to backend.
 */

// Web Speech API types
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

/**
 * Check if Web Speech API is available
 */
export function isSpeechRecognitionAvailable(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Transcribe audio from a base64 WAV using Web Speech API
 * 
 * Note: Web Speech API works with live microphone input, not audio files.
 * For WAV file transcription, we need to play the audio and capture it.
 * 
 * This is a workaround that plays audio through speakers and uses
 * speech recognition to capture it. For production, consider using
 * a proper audio transcription service or Whisper.
 */
export async function transcribeWithWebSpeech(wavBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isSpeechRecognitionAvailable()) {
      reject(new Error('Speech recognition not available on this device'));
      return;
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionClass();
    
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    let transcript = '';
    let hasResult = false;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript + ' ';
          hasResult = true;
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('[SpeechRecognition] Error:', event.error);
      if (event.error !== 'no-speech') {
        reject(new Error(`Speech recognition error: ${event.error}`));
      }
    };

    recognition.onend = () => {
      if (hasResult) {
        resolve(transcript.trim());
      } else {
        reject(new Error('No speech detected'));
      }
    };

    // Create audio element to play the WAV
    const audio = new Audio(`data:audio/wav;base64,${wavBase64}`);
    
    // Start recognition when audio starts playing
    audio.onplay = () => {
      try {
        recognition.start();
        console.log('[SpeechRecognition] Started listening');
      } catch (error) {
        console.error('[SpeechRecognition] Start failed:', error);
      }
    };

    // Stop recognition when audio ends
    audio.onended = () => {
      // Give a small delay for any final words
      setTimeout(() => {
        try {
          recognition.stop();
          console.log('[SpeechRecognition] Stopped listening');
        } catch (error) {
          console.error('[SpeechRecognition] Stop failed:', error);
        }
      }, 500);
    };

    audio.onerror = () => {
      reject(new Error('Failed to play audio for transcription'));
    };

    // Play the audio (this will trigger speech recognition)
    audio.play().catch((error) => {
      reject(new Error(`Failed to play audio: ${error.message}`));
    });
  });
}

/**
 * Fallback: Use Web Speech API to listen directly from microphone
 * This can be used as an alternative to processing recorded audio
 */
export function createLiveTranscriber(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (error: string) => void
): { start: () => void; stop: () => void } | null {
  if (!isSpeechRecognitionAvailable()) {
    return null;
  }

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognitionClass();
  
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      onTranscript(result[0].transcript, result.isFinal);
    }
  };

  recognition.onerror = (event) => {
    onError(event.error);
  };

  return {
    start: () => {
      try {
        recognition.start();
      } catch (error) {
        console.error('[LiveTranscriber] Start failed:', error);
      }
    },
    stop: () => {
      try {
        recognition.stop();
      } catch (error) {
        console.error('[LiveTranscriber] Stop failed:', error);
      }
    }
  };
}

import { APP_CONFIG } from '@/config/app.config';
import { encodeWavBase64 } from './wavEncoder';
import { logger } from '@/utils/logger';

const SAMPLE_RATE = APP_CONFIG.MOCK_SAMPLE_RATE; 

export async function textToSpeechWavSimple(text: string): Promise<string> {
  return new Promise((resolve, reject) => {

    if (!('speechSynthesis' in window)) {
      reject(new Error('Speech synthesis not available'));
      return;
    }

    logger.debug(`Generating audio from text: ${text}`, 'TTS');

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/ogg',
        });

        const audioChunks: Blob[] = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            stream.getTracks().forEach(track => track.stop());
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            const wavBase64 = await convertAudioBlobToWav(audioBlob);

            logger.debug(`Generated audio WAV, base64 length: ${wavBase64.length}`, 'TTS');
            resolve(wavBase64);
          } catch (error) {
            logger.error('Error converting audio', 'TTS', error instanceof Error ? error : new Error(String(error)));
            stream.getTracks().forEach(track => track.stop());
            reject(error);
          }
        };

        mediaRecorder.onerror = (event) => {
          logger.error('MediaRecorder error', 'TTS', new Error(String(event)));
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('Failed to record audio'));
        };

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'es-ES';
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = () => {
          logger.debug('Speech started, starting recording', 'TTS');
          mediaRecorder.start();
        };

        utterance.onend = () => {
          logger.debug('Speech ended, stopping recording', 'TTS');
          setTimeout(() => {
            mediaRecorder.stop();
          }, 500);
        };

        utterance.onerror = (event) => {
          logger.error('Speech synthesis error', 'TTS', new Error(String(event)));
          mediaRecorder.stop();
          stream.getTracks().forEach(track => track.stop());
          reject(new Error('Speech synthesis failed'));
        };

        speechSynthesis.speak(utterance);
      })
      .catch((error) => {
        logger.error('Failed to get user media', 'TTS', error instanceof Error ? error : new Error(String(error)));
        reject(new Error('Microphone permission denied or not available'));
      });
  });
}

async function convertAudioBlobToWav(audioBlob: Blob): Promise<string> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: SAMPLE_RATE,
  });

  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const samples = audioBuffer.getChannelData(0);

    let resampledSamples: Float32Array;
    if (audioBuffer.sampleRate !== SAMPLE_RATE) {
      const ratio = audioBuffer.sampleRate / SAMPLE_RATE;
      const newLength = Math.floor(samples.length / ratio);
      resampledSamples = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const index = Math.floor(srcIndex);
        const fraction = srcIndex - index;
        if (index + 1 < samples.length) {
          resampledSamples[i] = samples[index] * (1 - fraction) + samples[index + 1] * fraction;
        } else {
          resampledSamples[i] = samples[index];
        }
      }
    } else {
      resampledSamples = samples;
    }

    const int16Samples = new Int16Array(resampledSamples.length);
    for (let i = 0; i < resampledSamples.length; i++) {
      const sample = Math.max(-1, Math.min(1, resampledSamples[i]));
      int16Samples[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    const wavBase64 = encodeWavBase64(int16Samples);

    audioContext.close();
    return wavBase64;
  } catch (error) {
    audioContext.close();
    throw error;
  }
}


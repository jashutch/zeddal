// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * OpenAIWhisperBackend: Cloud-based transcription using OpenAI Whisper API
 * Architecture: Original implementation extracted from WhisperService
 */

import { IWhisperBackend } from './IWhisperBackend';
import { AudioChunk, TranscriptionChunk } from '../../utils/Types';
import { Config } from '../../utils/Config';
import { eventBus } from '../../utils/EventBus';

export class OpenAIWhisperBackend implements IWhisperBackend {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  getName(): string {
    return 'OpenAI Whisper API';
  }

  isReady(): boolean {
    const apiKey = this.config.get('openaiApiKey');
    return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
  }

  async transcribe(audioChunk: AudioChunk): Promise<TranscriptionChunk> {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please set API key in settings.');
    }

    try {
      // Create FormData for multipart upload
      const formData = new FormData();

      // Convert Blob to File with proper extension
      const mimeType = audioChunk.blob.type || 'audio/webm';

      // Determine file extension based on MIME type
      let extension = 'webm';
      if (mimeType.includes('mp4')) extension = 'mp4';
      else if (mimeType.includes('mpeg')) extension = 'mpeg';
      else if (mimeType.includes('ogg')) extension = 'ogg';
      else if (mimeType.includes('wav')) extension = 'wav';

      const file = new File(
        [audioChunk.blob],
        `audio-${audioChunk.timestamp}.${extension}`,
        { type: mimeType }
      );

      console.log('[OpenAI Backend] Audio file:', {
        size: file.size,
        type: file.type,
        name: file.name,
      });

      // Check minimum file size (empty recordings are ~125 bytes)
      if (file.size < 1000) {
        throw new Error('Recording too short or empty. Please record for at least 1-2 seconds.');
      }

      formData.append('file', file);
      formData.append('model', this.config.get('whisperModel') || 'whisper-1');
      formData.append('response_format', 'json');

      // Direct fetch to OpenAI API
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();

      // For simple json format, default confidence to 1.0
      const confidence = 1.0;

      const chunk: TranscriptionChunk = {
        text: data.text ? data.text.trim() : '',
        confidence,
        timestamp: audioChunk.timestamp,
      };

      eventBus.emit('transcribed', chunk);

      return chunk;
    } catch (error) {
      console.error('[OpenAI Backend] Transcription error:', error);
      eventBus.emit('error', {
        message: 'Transcription failed',
        error,
      });
      throw error;
    }
  }
}

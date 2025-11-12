// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * WhisperService: OpenAI Whisper transcription with confidence tracking
 * Architecture: Converts audio chunks to text using OpenAI whisper-1 model
 */

import OpenAI from 'openai';
import { eventBus } from '../utils/EventBus';
import { TranscriptionChunk, AudioChunk } from '../utils/Types';
import { Config } from '../utils/Config';

export class WhisperService {
  private openai: OpenAI | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.initializeClient();
  }

  /**
   * Initialize OpenAI client
   */
  private initializeClient(): void {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      console.warn('OpenAI API key not configured');
      return;
    }

    this.openai = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true, // Note: In production, proxy through backend
    });
  }

  /**
   * Update API key and reinitialize client
   */
  updateApiKey(apiKey: string): void {
    this.config.set('openaiApiKey', apiKey);
    this.initializeClient();
  }

  /**
   * Transcribe audio chunk using OpenAI Whisper
   */
  async transcribe(audioChunk: AudioChunk): Promise<TranscriptionChunk> {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please set API key.');
    }

    try {
      // Create FormData for multipart upload
      const formData = new FormData();

      // Convert Blob to File with proper extension
      // Use the actual MIME type from the blob, or default to audio/webm
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

      console.log('Audio file details:', {
        size: file.size,
        type: file.type,
        name: file.name,
      });

      // Check minimum file size (empty recordings are ~125 bytes)
      if (file.size < 1000) {
        throw new Error('Recording too short or empty. Please record for at least 1-2 seconds.');
      }

      formData.append('file', file);
      formData.append('model', this.config.get('whisperModel'));
      formData.append('response_format', 'json'); // Use simple json instead of verbose_json

      // Direct fetch to OpenAI API (bypasses SDK CORS issues)
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();

      // For simple json format, we don't get confidence scores
      // Default to 1.0 for now (Phase 2 can use verbose_json if needed)
      const confidence = 1.0;

      const chunk: TranscriptionChunk = {
        text: data.text ? data.text.trim() : '',
        confidence,
        timestamp: audioChunk.timestamp,
      };

      eventBus.emit('transcribed', chunk);

      return chunk;
    } catch (error) {
      console.error('Whisper transcription error:', error);
      eventBus.emit('error', {
        message: 'Transcription failed',
        error,
      });
      throw error;
    }
  }

  async transcribeBlobPartial(blob: Blob): Promise<string> {
    const chunk: AudioChunk = {
      blob,
      timestamp: Date.now(),
      duration: 0,
    };
    const result = await this.transcribe(chunk);
    return result.text || '';
  }

  /**
   * Transcribe multiple audio chunks in sequence
   */
  async transcribeMultiple(
    audioChunks: AudioChunk[]
  ): Promise<TranscriptionChunk[]> {
    const results: TranscriptionChunk[] = [];

    for (const chunk of audioChunks) {
      try {
        const result = await this.transcribe(chunk);
        results.push(result);
      } catch (error) {
        console.error('Failed to transcribe chunk:', error);
        // Continue with next chunk even if one fails
      }
    }

    return results;
  }

  /**
   * Stream transcription (for future real-time implementation)
   * Currently processes chunks sequentially
   */
  async stream(
    audioChunks: AudioChunk[],
    onChunk: (chunk: TranscriptionChunk) => void
  ): Promise<void> {
    for (const audioChunk of audioChunks) {
      try {
        const result = await this.transcribe(audioChunk);
        onChunk(result);
      } catch (error) {
        console.error('Stream transcription error:', error);
        eventBus.emit('error', {
          message: 'Stream transcription failed',
          error,
        });
      }
    }
  }

  /**
   * Combine multiple transcription chunks into single text
   */
  combineChunks(chunks: TranscriptionChunk[]): {
    text: string;
    averageConfidence: number;
  } {
    const text = chunks.map((chunk) => chunk.text).join(' ');

    const averageConfidence =
      chunks.length > 0
        ? chunks.reduce((sum, chunk) => sum + chunk.confidence, 0) /
          chunks.length
        : 0;

    return {
      text,
      averageConfidence,
    };
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    const apiKey = this.config.get('openaiApiKey');
    return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
  }
}

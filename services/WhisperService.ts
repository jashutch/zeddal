// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * WhisperService: Unified transcription service with multiple backends
 * Architecture: Facade pattern - delegates to OpenAI API (default), whisper.cpp, or other backends
 *
 * IMPORTANT: Maintains backward compatibility - all existing functionality preserved
 */

import { eventBus } from '../utils/EventBus';
import { TranscriptionChunk, AudioChunk } from '../utils/Types';
import { Config } from '../utils/Config';
import { IWhisperBackend } from './whisper/IWhisperBackend';
import { OpenAIWhisperBackend } from './whisper/OpenAIWhisperBackend';
import { LocalWhisperBackend } from './whisper/LocalWhisperBackend';

export class WhisperService {
  private config: Config;
  private backend: IWhisperBackend;

  constructor(config: Config) {
    this.config = config;
    this.backend = this.selectBackend();
  }

  /**
   * Select appropriate backend based on configuration
   * Falls back to OpenAI if local backend isn't properly configured
   */
  private selectBackend(): IWhisperBackend {
    const backendType = this.config.get('whisperBackend');

    console.log(`[WhisperService] Requested backend: ${backendType}`);

    // Try to create requested backend
    let backend: IWhisperBackend;

    switch (backendType) {
      case 'local-cpp': {
        const localBackend = new LocalWhisperBackend(this.config);
        if (localBackend.isReady()) {
          console.log('[WhisperService] Using local whisper.cpp backend');
          return localBackend;
        } else {
          console.warn('[WhisperService] Local whisper.cpp not configured, falling back to OpenAI');
          // Fall through to OpenAI
        }
      }
      // Fall through to default if local not ready
      case 'openai':
      default:
        backend = new OpenAIWhisperBackend(this.config);
        console.log('[WhisperService] Using OpenAI Whisper API backend');
        return backend;
    }
  }

  /**
   * Update backend when settings change
   */
  updateBackend(): void {
    const oldBackend = this.backend.getName();
    this.backend = this.selectBackend();
    console.log(`[WhisperService] Backend changed from ${oldBackend} to ${this.backend.getName()}`);
  }

  /**
   * Update API key (for OpenAI backend compatibility)
   * Maintains backward compatibility with existing code
   */
  updateApiKey(apiKey: string): void {
    this.config.set('openaiApiKey', apiKey);
    if (this.config.get('whisperBackend') === 'openai') {
      this.updateBackend();
    }
  }

  /**
   * Transcribe audio chunk using selected backend
   * Maintains existing API signature
   */
  async transcribe(audioChunk: AudioChunk): Promise<TranscriptionChunk> {
    try {
      return await this.backend.transcribe(audioChunk);
    } catch (error) {
      // If local backend fails, try falling back to OpenAI
      if (this.config.get('whisperBackend') === 'local-cpp') {
        console.warn('[WhisperService] Local backend failed, attempting OpenAI fallback');
        try {
          const fallbackBackend = new OpenAIWhisperBackend(this.config);
          if (fallbackBackend.isReady()) {
            return await fallbackBackend.transcribe(audioChunk);
          }
        } catch (fallbackError) {
          console.error('[WhisperService] Fallback also failed:', fallbackError);
        }
      }
      throw error;
    }
  }

  /**
   * Transcribe blob and return text
   * Maintains existing API signature
   */
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
   * Maintains existing API signature
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
        console.error('[WhisperService] Failed to transcribe chunk:', error);
        // Continue with next chunk even if one fails
      }
    }

    return results;
  }

  /**
   * Stream transcription (for future real-time implementation)
   * Currently processes chunks sequentially
   * Maintains existing API signature
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
        console.error('[WhisperService] Stream transcription error:', error);
        eventBus.emit('error', {
          message: 'Stream transcription failed',
          error,
        });
      }
    }
  }

  /**
   * Combine multiple transcription chunks into single text
   * Maintains existing API signature
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
   * Maintains existing API signature
   */
  isReady(): boolean {
    return this.backend.isReady();
  }

  /**
   * Get current backend name (for debugging/display)
   */
  getBackendName(): string {
    return this.backend.getName();
  }
}

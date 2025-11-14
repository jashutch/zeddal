// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * IWhisperBackend: Abstraction interface for Whisper transcription backends
 * Architecture: Allows switching between OpenAI API, whisper.cpp, whisper.py, WASM
 */

import { AudioChunk, TranscriptionChunk } from '../../utils/Types';

export interface IWhisperBackend {
  /**
   * Transcribe an audio chunk to text
   */
  transcribe(audioChunk: AudioChunk): Promise<TranscriptionChunk>;

  /**
   * Check if backend is ready for transcription
   */
  isReady(): boolean;

  /**
   * Get backend name for display
   */
  getName(): string;

  /**
   * Clean up resources (optional)
   */
  cleanup?(): Promise<void>;
}

export type WhisperBackendType = 'openai' | 'local-cpp' | 'local-python' | 'wasm';

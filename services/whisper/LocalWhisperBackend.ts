// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * LocalWhisperBackend: Local transcription using whisper.cpp binary
 * Architecture: Spawns whisper.cpp subprocess for offline transcription
 */

import { IWhisperBackend } from './IWhisperBackend';
import { AudioChunk, TranscriptionChunk } from '../../utils/Types';
import { Config } from '../../utils/Config';
import { eventBus } from '../../utils/EventBus';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class LocalWhisperBackend implements IWhisperBackend {
  private config: Config;
  private tempDir: string;

  constructor(config: Config) {
    this.config = config;
    this.tempDir = path.join(process.env.TMPDIR || '/tmp', 'zeddal-whisper');
    this.ensureTempDir();
  }

  getName(): string {
    return 'Local Whisper.cpp';
  }

  isReady(): boolean {
    const binaryPath = this.config.get('whisperCppPath');
    const modelPath = this.config.get('whisperModelPath');

    if (!binaryPath || !modelPath) {
      return false;
    }

    // Check if binary exists
    try {
      if (!fs.existsSync(binaryPath)) {
        console.warn(`[Local Whisper] Binary not found at: ${binaryPath}`);
        return false;
      }

      // Check if model exists
      if (!fs.existsSync(modelPath)) {
        console.warn(`[Local Whisper] Model not found at: ${modelPath}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Local Whisper] Error checking files:', error);
      return false;
    }
  }

  async transcribe(audioChunk: AudioChunk): Promise<TranscriptionChunk> {
    if (!this.isReady()) {
      throw new Error(
        'Local Whisper not configured. Please set whisper.cpp binary and model path in settings.'
      );
    }

    const tempAudioPath = await this.saveTempAudio(audioChunk);

    try {
      const text = await this.runWhisperCpp(tempAudioPath);

      const chunk: TranscriptionChunk = {
        text: text.trim(),
        confidence: 1.0, // whisper.cpp doesn't provide confidence scores in basic mode
        timestamp: audioChunk.timestamp,
      };

      eventBus.emit('transcribed', chunk);

      return chunk;
    } catch (error) {
      console.error('[Local Whisper] Transcription error:', error);
      eventBus.emit('error', {
        message: 'Local transcription failed',
        error,
      });
      throw error;
    } finally {
      // Clean up temp file
      this.cleanupTempFile(tempAudioPath);
    }
  }

  /**
   * Save audio blob to temporary file
   */
  private async saveTempAudio(audioChunk: AudioChunk): Promise<string> {
    const filename = `audio-${Date.now()}.wav`;
    const filepath = path.join(this.tempDir, filename);

    // Convert blob to buffer
    const arrayBuffer = await audioChunk.blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Write to file
    fs.writeFileSync(filepath, buffer);

    console.log(`[Local Whisper] Saved temp audio: ${filepath} (${buffer.length} bytes)`);

    return filepath;
  }

  /**
   * Run whisper.cpp binary
   */
  private async runWhisperCpp(audioPath: string): Promise<string> {
    const binaryPath = this.config.get('whisperCppPath');
    const modelPath = this.config.get('whisperModelPath');
    const language = this.config.get('whisperLanguage') || 'auto';

    // Build command
    // whisper.cpp command: ./main -m model.bin -f audio.wav
    let command = `"${binaryPath}" -m "${modelPath}" -f "${audioPath}"`;

    // Add language if specified (not auto)
    if (language && language !== 'auto') {
      command += ` -l ${language}`;
    }

    // Add output to stdout (default behavior)
    // Add no timestamps flag for cleaner output
    command += ' -nt';

    console.log(`[Local Whisper] Running: ${command}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 60000, // 60 second timeout
      });

      if (stderr) {
        console.warn(`[Local Whisper] stderr: ${stderr}`);
      }

      // Parse output - whisper.cpp outputs transcription to stdout
      // Format is typically:
      // [00:00:00.000 --> 00:00:05.000]  Transcribed text here
      // We need to extract just the text part

      const text = this.parseWhisperOutput(stdout);

      console.log(`[Local Whisper] Transcribed: "${text}"`);

      return text;
    } catch (error: any) {
      if (error.killed || error.signal === 'SIGTERM') {
        throw new Error('Transcription timed out (60s limit exceeded)');
      }

      throw new Error(`whisper.cpp execution failed: ${error.message}`);
    }
  }

  /**
   * Parse whisper.cpp output to extract text
   */
  private parseWhisperOutput(output: string): string {
    // whisper.cpp output format (with -nt flag):
    // [00:00:00.000 --> 00:00:05.000]  This is the transcribed text
    // [00:00:05.000 --> 00:00:10.000]  More transcribed text

    const lines = output.split('\n');
    const textLines: string[] = [];

    for (const line of lines) {
      // Match lines with timestamps
      const match = line.match(/\[[\d:.]+\s+-->\s+[\d:.]+\]\s+(.+)/);
      if (match && match[1]) {
        textLines.push(match[1].trim());
      } else if (line.trim() && !line.includes('[')) {
        // Also capture non-timestamp lines (plain text output)
        textLines.push(line.trim());
      }
    }

    return textLines.join(' ');
  }

  /**
   * Ensure temp directory exists
   */
  private ensureTempDir(): void {
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
    } catch (error) {
      console.error('[Local Whisper] Failed to create temp directory:', error);
    }
  }

  /**
   * Clean up temporary audio file
   */
  private cleanupTempFile(filepath: string): void {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`[Local Whisper] Cleaned up temp file: ${filepath}`);
      }
    } catch (error) {
      console.warn(`[Local Whisper] Failed to clean up temp file: ${filepath}`, error);
    }
  }

  /**
   * Cleanup all temp files on shutdown
   */
  async cleanup(): Promise<void> {
    try {
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        for (const file of files) {
          const filepath = path.join(this.tempDir, file);
          fs.unlinkSync(filepath);
        }
        fs.rmdirSync(this.tempDir);
        console.log('[Local Whisper] Cleaned up temp directory');
      }
    } catch (error) {
      console.warn('[Local Whisper] Failed to cleanup temp directory:', error);
    }
  }
}

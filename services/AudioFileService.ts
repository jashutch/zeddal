// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * AudioFileService: Manages saving and loading audio recordings
 * Architecture: Persistent audio storage with metadata tracking
 *
 * Features:
 * - Save audio blobs to vault with unique filenames
 * - Load audio files for playback or re-transcription
 * - Generate metadata files alongside audio
 * - Support drag-and-drop workflow
 */

import { App, TFile, normalizePath } from 'obsidian';
import { Config } from '../utils/Config';
import { AudioChunk, SavedAudioFile } from '../utils/Types';

export class AudioFileService {
  private app: App;
  private config: Config;

  constructor(app: App, config: Config) {
    this.app = app;
    this.config = config;
  }

  /**
   * Save audio recording to vault
   * Creates audio file and optional metadata JSON
   */
  async saveRecording(audioChunk: AudioChunk): Promise<SavedAudioFile> {
    const recordingsPath = this.config.get('recordingsPath');

    // Ensure recordings directory exists
    await this.ensureDirectory(recordingsPath);

    // Generate unique filename
    const timestamp = audioChunk.timestamp;
    const date = new Date(timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS

    // Determine file extension from mime type
    const extension = this.getExtensionFromMimeType(audioChunk.blob.type);
    const filename = `recording-${dateStr}-${timeStr}.${extension}`;
    const filePath = normalizePath(`${recordingsPath}/${filename}`);

    // Convert blob to ArrayBuffer
    const arrayBuffer = await audioChunk.blob.arrayBuffer();

    // Write audio file
    await this.app.vault.adapter.writeBinary(filePath, arrayBuffer);

    console.log(`Saved audio recording: ${filePath} (${audioChunk.blob.size} bytes)`);

    const savedFile: SavedAudioFile = {
      filePath,
      timestamp,
      duration: audioChunk.duration,
      mimeType: audioChunk.blob.type,
      size: audioChunk.blob.size,
    };

    // Save metadata JSON for easier lookup
    await this.saveMetadata(savedFile);

    return savedFile;
  }

  /**
   * Load audio file from vault
   */
  async loadRecording(filePath: string): Promise<AudioChunk> {
    const arrayBuffer = await this.app.vault.adapter.readBinary(filePath);
    const mimeType = this.getMimeTypeFromPath(filePath);
    const blob = new Blob([arrayBuffer], { type: mimeType });

    // Try to load metadata for duration
    const metadata = await this.loadMetadata(filePath);

    return {
      blob,
      timestamp: metadata?.timestamp || Date.now(),
      duration: metadata?.duration || 0,
    };
  }

  /**
   * Save metadata JSON alongside audio file
   */
  private async saveMetadata(savedFile: SavedAudioFile): Promise<void> {
    const metadataPath = this.getMetadataPath(savedFile.filePath);
    const metadata = JSON.stringify(savedFile, null, 2);

    try {
      await this.app.vault.adapter.write(metadataPath, metadata);
    } catch (error) {
      console.warn(`Failed to save metadata for ${savedFile.filePath}:`, error);
    }
  }

  /**
   * Load metadata JSON for audio file
   */
  async loadMetadata(filePath: string): Promise<SavedAudioFile | null> {
    const metadataPath = this.getMetadataPath(filePath);

    try {
      const exists = await this.app.vault.adapter.exists(metadataPath);
      if (!exists) {
        return null;
      }

      const content = await this.app.vault.adapter.read(metadataPath);
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to load metadata for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Update metadata with transcription result
   */
  async updateMetadata(filePath: string, updates: Partial<SavedAudioFile>): Promise<void> {
    const existingMetadata = await this.loadMetadata(filePath);

    if (!existingMetadata) {
      console.warn(`No metadata found for ${filePath}`);
      return;
    }

    const updatedMetadata: SavedAudioFile = {
      ...existingMetadata,
      ...updates,
    };

    await this.saveMetadata(updatedMetadata);
  }

  /**
   * Get metadata file path for audio file
   */
  private getMetadataPath(audioPath: string): string {
    return audioPath.replace(/\.(webm|mp3|wav|m4a|ogg)$/, '.metadata.json');
  }

  /**
   * Ensure directory exists, creating if necessary
   */
  private async ensureDirectory(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    const exists = await this.app.vault.adapter.exists(normalizedPath);

    if (!exists) {
      await this.app.vault.createFolder(normalizedPath);
      console.log(`Created recordings directory: ${normalizedPath}`);
    }
  }

  /**
   * Get file extension from MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm'; // Default fallback
  }

  /**
   * Get MIME type from file path
   */
  private getMimeTypeFromPath(path: string): string {
    if (path.endsWith('.webm')) return 'audio/webm;codecs=opus';
    if (path.endsWith('.mp3')) return 'audio/mpeg';
    if (path.endsWith('.wav')) return 'audio/wav';
    if (path.endsWith('.m4a')) return 'audio/mp4';
    if (path.endsWith('.ogg')) return 'audio/ogg;codecs=opus';
    return 'audio/webm;codecs=opus'; // Default fallback
  }

  /**
   * Check if file is an audio recording that can be processed
   */
  isAudioFile(path: string): boolean {
    const audioExtensions = ['.webm', '.mp3', '.wav', '.m4a', '.ogg'];
    return audioExtensions.some(ext => path.toLowerCase().endsWith(ext));
  }

  /**
   * List all recordings in the recordings folder
   */
  async listRecordings(): Promise<SavedAudioFile[]> {
    const recordingsPath = this.config.get('recordingsPath');
    const recordings: SavedAudioFile[] = [];

    try {
      const files = this.app.vault.getFiles();

      for (const file of files) {
        if (file.path.startsWith(recordingsPath) && this.isAudioFile(file.path)) {
          const metadata = await this.loadMetadata(file.path);

          if (metadata) {
            recordings.push(metadata);
          } else {
            // Create basic metadata from file stats
            recordings.push({
              filePath: file.path,
              timestamp: file.stat.ctime,
              duration: 0,
              mimeType: this.getMimeTypeFromPath(file.path),
              size: file.stat.size,
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to list recordings:', error);
    }

    // Sort by timestamp descending (newest first)
    return recordings.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Delete audio file and its metadata
   */
  async deleteRecording(filePath: string): Promise<void> {
    try {
      // Delete audio file
      const audioFile = this.app.vault.getAbstractFileByPath(filePath);
      if (audioFile) {
        await this.app.vault.delete(audioFile);
      }

      // Delete metadata file
      const metadataPath = this.getMetadataPath(filePath);
      const metadataFile = this.app.vault.getAbstractFileByPath(metadataPath);
      if (metadataFile) {
        await this.app.vault.delete(metadataFile);
      }

      console.log(`Deleted recording: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete recording ${filePath}:`, error);
      throw error;
    }
  }
}

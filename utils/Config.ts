/**
 * Config: Settings management for Zeddal
 * Architecture: Type-safe configuration with defaults
 */

import { ZeddalSettings } from './Types';

export const DEFAULT_SETTINGS: ZeddalSettings = {
  openaiApiKey: '',
  openaiModel: 'gpt-4-turbo',
  gptModel: 'gpt-4-turbo', // Alias for clarity
  whisperModel: 'whisper-1',
  embeddingModel: 'text-embedding-3-small',
  llmProvider: 'openai',
  customApiBase: '',
  customTranscriptionUrl: '',
  customEmbeddingUrl: '',
  autoMergeThreshold: 0.85,
  silenceThreshold: 0.01, // RMS threshold for silence detection
  silenceDuration: 1500, // ms of silence before auto-pause
  // Note insertion settings
  defaultSaveLocation: 'ask', // Ask user where to save
  voiceNotesFolder: 'Voice Notes',
  autoRefine: true, // Auto-refine with GPT-4
  autoSaveRaw: true,
  autoContextLinks: true,
  // Audio recording settings
  recordingsPath: 'Voice Notes/Recordings', // Default path for audio files
  // RAG settings
  enableRAG: true, // Enable vector-based context retrieval
  ragTopK: 3, // Retrieve top 3 similar chunks
  ragChunkSize: 500, // Tokens per chunk
  ragChunkOverlap: 50, // Token overlap between chunks
  // MCP settings
  enableMCP: false, // Disabled by default - user must explicitly enable
  mcpServers: [], // No servers configured by default
};

export class Config {
  private settings: ZeddalSettings;

  constructor(settings?: Partial<ZeddalSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  get<K extends keyof ZeddalSettings>(key: K): ZeddalSettings[K] {
    return this.settings[key];
  }

  set<K extends keyof ZeddalSettings>(key: K, value: ZeddalSettings[K]): void {
    this.settings[key] = value;
  }

  getAll(): ZeddalSettings {
    return { ...this.settings };
  }

  update(partial: Partial<ZeddalSettings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  isValid(): boolean {
    return this.settings.openaiApiKey.length > 0;
  }
}

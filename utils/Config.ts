// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

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
  // Q&A Session settings
  enableQAMode: true, // Enable Q&A mode (opt-in per recording)
  defaultLecturerLabel: 'Lecturer',
  defaultStudentLabel: 'Student',
  minPauseDuration: 2.0, // 2 seconds pause for speaker change detection
  autoSummarize: true,
  includeRAGContext: true, // Use vault context for Q&A
  ragTopKForQA: 5, // More context for Q&A sessions
  qaExportFormat: 'both', // Export both markdown and JSON
  qaSaveFolder: 'Voice Notes/Q&A Sessions',
  promptForLabels: true, // Ask user for speaker names
  // Technical Content Formatting settings
  formatTechnicalContent: true, // Enable LaTeX and code formatting
  technicalDomain: 'auto', // Auto-detect domain (math, code, science)
  enableInlineLaTeX: true, // Enable inline LaTeX ($...$)
  enableDisplayLaTeX: true, // Enable display LaTeX ($$...$$)
  enableCodeBlocks: true, // Enable code block formatting
  // Transcript Refinement settings
  enableQuickFixes: true, // Enable rule-based quick fixes
  enableLocalLLM: false, // Disabled by default (requires local LLM setup)
  localLLMProvider: 'ollama', // Default to Ollama
  localLLMBaseUrl: 'http://localhost:11434', // Default Ollama URL
  localLLMModel: 'llama3.2', // Default model
  localLLMApiKey: '', // No API key by default
  // Correction Learning settings
  enableCorrectionLearning: true, // Enable learning from corrections
  showCorrectionWindow: true, // Show correction window after transcription
  autoApplyThreshold: 0.9, // Auto-apply at 90% confidence
  enableCorrectionSharing: false, // Disabled by default (personal only)
  enableCloudBackup: false, // Future feature
  enableFineTuning: false, // Future feature
  showSuggestedCorrections: true, // Show suggestions by default
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

// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * Core type definitions for Zeddal plugin
 * Architecture: Blueprint-driven type system for voice-to-vault workflow
 */

export interface TranscriptionChunk {
  text: string;
  confidence: number;
  timestamp: number;
}

export interface RefinedNote {
  title: string;
  body: string;
  links: string[];
  timestamp?: number;
  originalTranscription?: string;
  confidenceAvg?: number;
  citations?: Citation[];
}

export interface Citation {
  keyword: string;
  url: string;
  label: string;
  insertedAt: number;
}

export interface MergeProposal {
  target: string;
  similarity: number;
  diff: string;
}

export interface HistorySnapshot {
  file: string;
  timestamp: number;
  path: string;
}

export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  confidence: number;
}

/**
 * Technical domain for transcript formatting
 * - math: Mathematics, calculus, algebra, etc.
 * - code: Programming, algorithms, software engineering
 * - science: Chemistry, physics, biology formulas
 * - auto: Automatically detect domain from content
 */
export type TechnicalDomain = 'math' | 'code' | 'science' | 'auto';

export interface ZeddalSettings {
  openaiApiKey: string;
  openaiModel: string;
  gptModel: string; // Alias for openaiModel for clarity
  whisperModel: string;
  embeddingModel: string;
  llmProvider: 'openai' | 'custom';
  customApiBase?: string;
  customTranscriptionUrl?: string;
  customEmbeddingUrl?: string; // For local RAG servers
  autoMergeThreshold: number;
  silenceThreshold: number;
  silenceDuration: number;
  // Note insertion settings
  defaultSaveLocation: 'daily-note' | 'new-note' | 'cursor' | 'ask';
  voiceNotesFolder: string;
  autoRefine: boolean;
  autoSaveRaw: boolean;
  autoContextLinks: boolean;
  // Audio recording settings
  recordingsPath: string; // Path where raw audio files are saved
  // RAG settings
  enableRAG: boolean;
  ragTopK: number; // Number of similar chunks to retrieve
  ragChunkSize: number; // Tokens per chunk
  ragChunkOverlap: number; // Token overlap between chunks
  // MCP settings
  enableMCP: boolean; // Enable Model Context Protocol integration
  mcpServers: MCPServerConfig[]; // Configured MCP servers
  // Q&A Session settings
  enableQAMode: boolean; // Enable Q&A session mode
  defaultLecturerLabel: string; // Default lecturer label
  defaultStudentLabel: string; // Default student label prefix
  minPauseDuration: number; // Seconds to detect speaker change
  autoSummarize: boolean; // Auto-generate summaries
  includeRAGContext: boolean; // Pull context from vault for Q&A
  ragTopKForQA: number; // Context chunks for Q&A sessions
  qaExportFormat: 'markdown' | 'json' | 'both'; // Export format
  qaSaveFolder: string; // Folder for Q&A sessions
  promptForLabels: boolean; // Ask for speaker labels before processing
  // Technical Content Formatting settings
  formatTechnicalContent: boolean; // Enable LaTeX and code formatting
  technicalDomain: TechnicalDomain; // Domain hint for formatting
  enableInlineLaTeX: boolean; // Enable inline LaTeX ($...$)
  enableDisplayLaTeX: boolean; // Enable display LaTeX ($$...$$)
  enableCodeBlocks: boolean; // Enable code block formatting
  // Transcript Refinement settings
  enableQuickFixes: boolean; // Enable rule-based quick fixes
  enableLocalLLM: boolean; // Enable local LLM refinement
  localLLMProvider: 'ollama' | 'llamacpp' | 'lmstudio' | 'openai-compatible' | 'openai'; // LLM provider type
  localLLMBaseUrl: string; // Base URL for local LLM (e.g., http://localhost:11434)
  localLLMModel: string; // Model name (e.g., llama3.2, mistral)
  localLLMApiKey: string; // Optional API key for custom endpoints
  // Correction Learning settings
  enableCorrectionLearning: boolean; // Learn from user corrections
  showCorrectionWindow: boolean; // Show correction window immediately after transcription
  autoApplyThreshold: number; // Confidence threshold for auto-apply (0-1, e.g. 0.9 = 90%)
  enableCorrectionSharing: boolean; // Allow exporting/sharing correction patterns
  enableCloudBackup: boolean; // Future: backup corrections to cloud
  enableFineTuning: boolean; // Future: use corrections for model fine-tuning
  showSuggestedCorrections: boolean; // Show suggestions from learned patterns
}

export interface AudioChunk {
  blob: Blob;
  timestamp: number;
  duration: number;
}

export interface SavedAudioFile {
  filePath: string; // Path to the audio file in vault
  timestamp: number;
  duration: number; // Duration in milliseconds
  mimeType: string; // e.g., 'audio/webm;codecs=opus'
  size: number; // File size in bytes
  transcription?: string; // Optional cached transcription
}

export type EventType =
  | 'transcribed'
  | 'refined'
  | 'merged'
  | 'committed'
  | 'recording-started'
  | 'recording-stopped'
  | 'recording-paused'
  | 'recording-resumed'
  | 'error'
  | 'file-created'
  | 'file-modified'
  | 'content-inserted'
  | 'backup-created';

export interface ZeddalEvent<T = any> {
  type: EventType;
  data: T;
  timestamp: number;
}

/**
 * RAG (Retrieval-Augmented Generation) Types
 */

export interface EmbeddingVector {
  values: number[]; // 1536 dimensions for text-embedding-3-small
  dimensions: number;
}

export interface VaultChunk {
  path: string; // File path
  chunkIndex: number; // Position within file
  text: string; // Chunk content
  embedding: EmbeddingVector;
  lastModified: number; // File modification timestamp
  tokens: number; // Approximate token count
}

export interface SimilarityResult {
  chunk: VaultChunk;
  similarity: number; // Cosine similarity score (0-1)
}

export interface RAGContext {
  chunks: SimilarityResult[];
  totalChunks: number;
  queryTime: number; // ms
}

/**
 * Embedding Provider Interface
 * Allows swapping between OpenAI, custom, or local embedding services
 */
export interface IEmbeddingProvider {
  /**
   * Generate embedding vector for text
   * @param text Input text to embed
   * @returns Embedding vector
   */
  embed(text: string): Promise<EmbeddingVector>;

  /**
   * Batch embed multiple texts (more efficient)
   * @param texts Array of texts to embed
   * @returns Array of embedding vectors
   */
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;

  /**
   * Get the model name/identifier
   */
  getModelName(): string;

  /**
   * Get the dimension size of embeddings
   */
  getDimensions(): number;
}

/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  id: string; // Unique identifier for this server
  name: string; // Display name
  command: string; // Command to run (for stdio transport)
  args?: string[]; // Command arguments
  env?: Record<string, string>; // Environment variables
  enabled: boolean; // Whether this server is active
}

/**
 * MCP Resource from external server
 */
export interface MCPResource {
  uri: string; // Resource URI
  name: string; // Resource name
  description?: string; // Resource description
  mimeType?: string; // MIME type of content
  content: string; // Resource content
}

/**
 * MCP Context retrieved from servers
 */
export interface MCPContext {
  serverId: string; // Which server provided this context
  serverName: string; // Display name of server
  resources: MCPResource[]; // Resources retrieved
  timestamp: number; // When this context was retrieved
}

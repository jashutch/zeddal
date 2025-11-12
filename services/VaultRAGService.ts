// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * VaultRAGService: Retrieval-Augmented Generation for vault context
 * Architecture: Vector-based semantic search with persistent caching
 *
 * Features:
 * - OpenAI or custom/local embedding providers
 * - In-memory vector index with disk persistence
 * - Incremental updates on file changes
 * - Cosine similarity search
 * - Writing style analysis
 */

import { App, TFile } from 'obsidian';
import { Config } from '../utils/Config';
import {
  VaultChunk,
  RAGContext,
  SimilarityResult,
  IEmbeddingProvider,
  EmbeddingVector,
} from '../utils/Types';
import { TextChunker } from '../utils/TextChunker';
import { VectorMath } from '../utils/VectorMath';
import { EmbeddingProviderFactory } from './embeddings/EmbeddingProviderFactory';

interface VaultIndexCache {
  version: number;
  chunks: VaultChunk[];
  lastBuilt: number;
}

export class VaultRAGService {
  private app: App;
  private config: Config;
  private embeddingProvider: IEmbeddingProvider;
  private index: VaultChunk[] = [];
  private isIndexBuilt = false;
  private cacheFilePath: string;
  private pendingCacheSave: number | null = null;
  private isInitializing = false;

  constructor(app: App, config: Config) {
    this.app = app;
    this.config = config;
    this.embeddingProvider = EmbeddingProviderFactory.create(config);

    // Cache file stored in plugin data directory
    const pluginDir = (this.app.vault as any).configDir + '/plugins/zeddal';
    this.cacheFilePath = `${pluginDir}/embeddings-cache.json`;
  }

  /**
   * Build vector index from vault files
   * Loads from cache if available, otherwise indexes from scratch
   */
  async buildIndex(forceRebuild: boolean = false): Promise<void> {
    if (!this.config.get('enableRAG')) {
      console.log('RAG disabled in settings');
      return;
    }

    this.isInitializing = true;

    // Try to load from cache first
    if (!forceRebuild) {
      const loaded = await this.loadIndexFromCache();
      if (loaded) {
        console.log(`Loaded ${this.index.length} chunks from cache`);
        this.isIndexBuilt = true;
        this.isInitializing = false;
        return;
      }
    }

    console.log('Building RAG index from scratch...');

    const startTime = Date.now();
    const markdownFiles = this.app.vault.getMarkdownFiles();

    // Reset index
    this.index = [];

    // Process files in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < markdownFiles.length; i += batchSize) {
      const batch = markdownFiles.slice(i, i + batchSize);
      await this.indexFileBatch(batch);

      // Progress logging
      const progress = Math.min(i + batchSize, markdownFiles.length);
      console.log(`Indexed ${progress}/${markdownFiles.length} files`);
    }

    this.isIndexBuilt = true;
    this.isInitializing = false;

    const duration = Date.now() - startTime;
    console.log(
      `RAG index built: ${this.index.length} chunks from ${markdownFiles.length} files in ${duration}ms`
    );

    // Persist to cache (immediate write for full rebuild)
    await this.saveIndexToCache();
  }

  /**
   * Index a batch of files
   */
  private async indexFileBatch(files: TFile[]): Promise<void> {
    const chunks: VaultChunk[] = [];

    // Read all files and chunk them
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const fileChunks = await this.chunkFile(file, content);
        chunks.push(...fileChunks);
      } catch (error) {
        console.error(`Failed to index file ${file.path}:`, error);
      }
    }

    if (chunks.length === 0) {
      return;
    }

    // Generate embeddings in batch (more efficient)
    try {
      const texts = chunks.map((c) => c.text);
      const embeddings = await this.embeddingProvider.embedBatch(texts);

      // Attach embeddings to chunks
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = embeddings[i];
      }

      // Add to index
      this.index.push(...chunks);
    } catch (error) {
      console.error('Failed to generate embeddings for batch:', error);
      throw error;
    }
  }

  /**
   * Chunk a single file into semantic segments
   */
  private async chunkFile(file: TFile, content: string): Promise<VaultChunk[]> {
    const chunkSize = this.config.get('ragChunkSize');
    const overlap = this.config.get('ragChunkOverlap');

    const textChunks = TextChunker.chunk(content, { chunkSize, overlap });

    return textChunks.map((chunk) => ({
      path: file.path,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      embedding: { values: [], dimensions: 0 }, // Will be filled by batch embedding
      lastModified: file.stat.mtime,
      tokens: chunk.tokens,
    }));
  }

  /**
   * Retrieve relevant context for a transcription
   */
  async retrieveContext(text: string): Promise<string[]> {
    if (!this.config.get('enableRAG')) {
      return [];
    }

    if (!this.isIndexBuilt) {
      console.warn('RAG index not built yet, building now...');
      await this.buildIndex();
    }

    if (this.index.length === 0) {
      return [];
    }

    const startTime = Date.now();

    try {
      // Embed the query text
      const queryEmbedding = await this.embeddingProvider.embed(text);

      // Find top-K similar chunks
      const topK = this.config.get('ragTopK');
      const candidates = this.index.map((chunk) => ({
        embedding: chunk.embedding,
        metadata: chunk,
      }));

      const results = VectorMath.topKSimilar(queryEmbedding, candidates, topK);

      // Extract unique files (avoid duplicates from same file)
      const seenPaths = new Set<string>();
      const contextChunks: string[] = [];

      for (const result of results) {
        const chunk: VaultChunk = result.metadata;
        if (!seenPaths.has(chunk.path)) {
          seenPaths.add(chunk.path);
          contextChunks.push(`From "${chunk.path}":\n${chunk.text}`);
        }
      }

      const queryTime = Date.now() - startTime;
      console.log(
        `RAG retrieved ${contextChunks.length} contexts in ${queryTime}ms`
      );

      return contextChunks;
    } catch (error) {
      console.error('RAG context retrieval failed:', error);
      return []; // Gracefully degrade to no context
    }
  }

  /**
   * Analyze user's writing style from vault
   * Returns a style description for GPT-4 system prompt
   */
  async analyzeStyle(): Promise<string> {
    if (!this.isIndexBuilt || this.index.length === 0) {
      return '';
    }

    // Sample chunks from across the vault
    const sampleSize = Math.min(10, this.index.length);
    const step = Math.floor(this.index.length / sampleSize);
    const samples = [];

    for (let i = 0; i < this.index.length; i += step) {
      if (samples.length >= sampleSize) break;
      samples.push(this.index[i].text);
    }

    // Analyze common patterns
    const avgLength = samples.reduce((sum, s) => sum + s.length, 0) / samples.length;
    const hasLists = samples.some((s) => /^[-*]\s/m.test(s));
    const hasHeadings = samples.some((s) => /^#{1,6}\s/m.test(s));

    const styleNotes = [];

    if (avgLength < 300) {
      styleNotes.push('concise, brief notes');
    } else if (avgLength > 800) {
      styleNotes.push('detailed, comprehensive notes');
    }

    if (hasLists) {
      styleNotes.push('uses bullet lists');
    }

    if (hasHeadings) {
      styleNotes.push('uses headings for structure');
    }

    if (styleNotes.length === 0) {
      return '';
    }

    return `The user's typical note style: ${styleNotes.join(', ')}.`;
  }

  /**
   * Update index for a single file (called on file modification)
   */
  async updateFile(file: TFile): Promise<void> {
    if (!this.config.get('enableRAG') || !this.isIndexBuilt) {
      return;
    }

    // Skip updates during initialization to avoid re-indexing cached files
    if (this.isInitializing) {
      return;
    }

    try {
      // Check if file has actually been modified since last index
      const existingChunks = this.index.filter((chunk) => chunk.path === file.path);
      if (existingChunks.length > 0) {
        const lastIndexed = existingChunks[0].lastModified;
        if (file.stat.mtime <= lastIndexed) {
          // File hasn't changed since last index, skip
          return;
        }
      }

      // Remove old chunks for this file
      this.index = this.index.filter((chunk) => chunk.path !== file.path);

      // Re-index the file
      const content = await this.app.vault.read(file);
      await this.indexFileBatch([file]);

      // Schedule debounced cache save
      this.scheduleCacheSave();

      console.log(`Updated RAG index for ${file.path}`);
    } catch (error) {
      console.error(`Failed to update RAG index for ${file.path}:`, error);
    }
  }

  /**
   * Remove file from index (called on file deletion)
   */
  async removeFile(path: string): Promise<void> {
    if (!this.config.get('enableRAG') || !this.isIndexBuilt) {
      return;
    }

    const beforeCount = this.index.length;
    this.index = this.index.filter((chunk) => chunk.path !== path);
    const afterCount = this.index.length;

    if (beforeCount !== afterCount) {
      this.scheduleCacheSave();
      console.log(`Removed ${beforeCount - afterCount} chunks for ${path}`);
    }
  }

  /**
   * Load index from cache file
   */
  private async loadIndexFromCache(): Promise<boolean> {
    try {
      const cacheExists = await this.app.vault.adapter.exists(this.cacheFilePath);
      if (!cacheExists) {
        return false;
      }

      const cacheData = await this.app.vault.adapter.read(this.cacheFilePath);
      const cache: VaultIndexCache = JSON.parse(cacheData);

      // Validate cache version
      if (cache.version !== 1) {
        console.log('Cache version mismatch, rebuilding index');
        return false;
      }

      // Check if cache is stale (older than 7 days)
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (Date.now() - cache.lastBuilt > maxAge) {
        console.log('Cache is stale, rebuilding index');
        return false;
      }

      this.index = cache.chunks;
      return true;
    } catch (error) {
      console.error('Failed to load RAG cache:', error);
      return false;
    }
  }

  /**
   * Save index to cache file
   */
  private async saveIndexToCache(): Promise<void> {
    try {
      const cache: VaultIndexCache = {
        version: 1,
        chunks: this.index,
        lastBuilt: Date.now(),
      };

      const cacheData = JSON.stringify(cache);
      await this.app.vault.adapter.write(this.cacheFilePath, cacheData);

      console.log('RAG index cached to disk');
    } catch (error) {
      console.error('Failed to save RAG cache:', error);
    }
  }

  /**
   * Schedule a debounced cache save (batches multiple updates)
   * Waits 2 seconds after last change before writing to disk
   */
  private scheduleCacheSave(): void {
    // Cancel any pending save
    if (this.pendingCacheSave !== null) {
      clearTimeout(this.pendingCacheSave);
    }

    // Schedule new save after 2 seconds of inactivity
    this.pendingCacheSave = window.setTimeout(() => {
      this.pendingCacheSave = null;
      this.saveIndexToCache();
    }, 2000);
  }

  /**
   * Clear the entire index and cache
   */
  async clearIndex(): Promise<void> {
    // Cancel any pending cache save
    if (this.pendingCacheSave !== null) {
      clearTimeout(this.pendingCacheSave);
      this.pendingCacheSave = null;
    }

    this.index = [];
    this.isIndexBuilt = false;

    try {
      const exists = await this.app.vault.adapter.exists(this.cacheFilePath);
      if (exists) {
        await this.app.vault.adapter.remove(this.cacheFilePath);
      }
      console.log('RAG index cleared');
    } catch (error) {
      console.error('Failed to clear RAG cache:', error);
    }
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalChunks: number;
    totalFiles: number;
    isBuilt: boolean;
    provider: string;
  } {
    const uniqueFiles = new Set(this.index.map((c) => c.path));

    return {
      totalChunks: this.index.length,
      totalFiles: uniqueFiles.size,
      isBuilt: this.isIndexBuilt,
      provider: this.embeddingProvider.getModelName(),
    };
  }
}

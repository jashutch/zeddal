// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * OpenAIEmbeddingProvider: OpenAI text-embedding-3-small integration
 * Architecture: BYOK (Bring Your Own Key) model using official OpenAI SDK
 */

import { IEmbeddingProvider, EmbeddingVector } from '../../utils/Types';
import { Config } from '../../utils/Config';
import OpenAI from 'openai';
import { OfflineError, isNetworkError } from '../../utils/Errors';

export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  private client: OpenAI;
  private config: Config;
  private model: string;

  constructor(config: Config) {
    this.config = config;
    this.model = config.get('embeddingModel');

    const apiKey = config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    this.client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true, // Required for Obsidian plugin context
    });
  }

  async embed(text: string): Promise<EmbeddingVector> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });

      const embedding = response.data[0].embedding;

      return {
        values: embedding,
        dimensions: embedding.length,
      };
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn('OpenAI embedding skipped: offline detected');
        throw new OfflineError('Offline: skipped embedding generation');
      }
      console.error('OpenAI embedding error:', error);
      throw new Error(`Failed to generate embedding: ${error?.message || error}`);
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    try {
      // OpenAI supports batch embedding (up to 2048 texts per request)
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      });

      return response.data.map((item) => ({
        values: item.embedding,
        dimensions: item.embedding.length,
      }));
    } catch (error) {
      if (isNetworkError(error)) {
        console.warn('OpenAI batch embedding skipped: offline detected');
        throw new OfflineError('Offline: skipped batch embedding generation');
      }
      console.error('OpenAI batch embedding error:', error);
      throw new Error(
        `Failed to generate batch embeddings: ${error?.message || error}`
      );
    }
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    // text-embedding-3-small produces 1536-dimensional vectors
    return 1536;
  }

  /**
   * Update API key when settings change
   */
  updateApiKey(apiKey: string): void {
    this.client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
  }
}

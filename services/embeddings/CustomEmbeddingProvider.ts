/**
 * CustomEmbeddingProvider: Local/self-hosted embedding service
 * Architecture: OpenAI-compatible API for walled infrastructure (DOD/DOJ)
 *
 * Supports:
 * - Local RAG servers (e.g., text-embeddings-inference, sentence-transformers)
 * - Air-gapped deployments
 * - Custom embedding models
 */

import { IEmbeddingProvider, EmbeddingVector } from '../../utils/Types';
import { Config } from '../../utils/Config';

interface CustomEmbeddingRequest {
  input: string | string[];
  model?: string;
}

interface CustomEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class CustomEmbeddingProvider implements IEmbeddingProvider {
  private config: Config;
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.get('customEmbeddingUrl') || config.get('customApiBase') || '';
    this.apiKey = config.get('openaiApiKey') || ''; // May not be needed for local servers
    this.model = config.get('embeddingModel');
    this.dimensions = 1536; // Default, will update from first response

    if (!this.baseUrl) {
      throw new Error('Custom embedding URL not configured');
    }
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const vectors = await this.embedBatch([text]);
    return vectors[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    try {
      const requestBody: CustomEmbeddingRequest = {
        input: texts,
        model: this.model,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Only add Authorization if API key is provided
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Custom embedding server returned ${response.status}: ${errorText}`
        );
      }

      const data: CustomEmbeddingResponse = await response.json();

      // Update dimensions from first response
      if (data.data.length > 0) {
        this.dimensions = data.data[0].embedding.length;
      }

      return data.data.map((item) => ({
        values: item.embedding,
        dimensions: item.embedding.length,
      }));
    } catch (error) {
      console.error('Custom embedding error:', error);
      throw new Error(`Failed to generate embedding from custom server: ${error.message}`);
    }
  }

  getModelName(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Update base URL when settings change
   */
  updateBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Update API key when settings change (optional for local servers)
   */
  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}

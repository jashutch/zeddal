// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * EmbeddingProviderFactory: Factory for creating embedding providers
 * Architecture: Strategy pattern for swappable embedding backends
 */

import { IEmbeddingProvider } from '../../utils/Types';
import { Config } from '../../utils/Config';
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider';
import { CustomEmbeddingProvider } from './CustomEmbeddingProvider';

export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider based on config settings
   */
  static create(config: Config): IEmbeddingProvider {
    const llmProvider = config.get('llmProvider');
    const customEmbeddingUrl = config.get('customEmbeddingUrl');

    // If custom embedding URL is explicitly provided, use custom provider
    if (customEmbeddingUrl && customEmbeddingUrl.trim()) {
      return new CustomEmbeddingProvider(config);
    }

    // If llmProvider is custom and customApiBase exists, use custom provider
    if (llmProvider === 'custom' && config.get('customApiBase')) {
      return new CustomEmbeddingProvider(config);
    }

    // Default to OpenAI
    return new OpenAIEmbeddingProvider(config);
  }
}

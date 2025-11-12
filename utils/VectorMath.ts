// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * VectorMath: Vector operations for embedding similarity
 * Architecture: Pure functions for cosine similarity and vector operations
 */

import { EmbeddingVector } from './Types';

export class VectorMath {
  /**
   * Compute cosine similarity between two embedding vectors
   * Returns a value between -1 (opposite) and 1 (identical)
   * Typically RAG results range from 0.3 to 0.95
   */
  static cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.dimensions !== b.dimensions) {
      throw new Error(
        `Vector dimension mismatch: ${a.dimensions} vs ${b.dimensions}`
      );
    }

    const dotProduct = this.dotProduct(a.values, b.values);
    const magnitudeA = this.magnitude(a.values);
    const magnitudeB = this.magnitude(b.values);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Compute dot product of two vectors
   */
  private static dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Compute magnitude (L2 norm) of a vector
   */
  private static magnitude(v: number[]): number {
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i] * v[i];
    }
    return Math.sqrt(sum);
  }

  /**
   * Normalize a vector to unit length
   */
  static normalize(v: EmbeddingVector): EmbeddingVector {
    const mag = this.magnitude(v.values);
    if (mag === 0) {
      return v;
    }

    return {
      values: v.values.map((val) => val / mag),
      dimensions: v.dimensions,
    };
  }

  /**
   * Find top-K most similar vectors from a list
   */
  static topKSimilar(
    query: EmbeddingVector,
    candidates: Array<{ embedding: EmbeddingVector; metadata: any }>,
    k: number
  ): Array<{ similarity: number; metadata: any }> {
    const similarities = candidates.map((candidate) => ({
      similarity: this.cosineSimilarity(query, candidate.embedding),
      metadata: candidate.metadata,
    }));

    // Sort by similarity (descending) and take top K
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, k);
  }
}

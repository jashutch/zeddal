/**
 * TextChunker: Split text into overlapping chunks for embedding
 * Architecture: Token-aware chunking with configurable overlap
 */

export interface ChunkOptions {
  chunkSize: number; // Target tokens per chunk
  overlap: number; // Token overlap between chunks
}

export interface TextChunk {
  text: string;
  chunkIndex: number;
  tokens: number;
  startChar: number;
  endChar: number;
}

export class TextChunker {
  /**
   * Split text into overlapping chunks
   * Uses approximate token counting (1 token ≈ 4 characters)
   */
  static chunk(text: string, options: ChunkOptions): TextChunk[] {
    const { chunkSize, overlap } = options;

    if (!text || text.trim().length === 0) {
      return [];
    }

    const chunks: TextChunk[] = [];
    const approxCharsPerChunk = chunkSize * 4; // 1 token ≈ 4 chars
    const approxOverlapChars = overlap * 4;

    // Split text into sentences to avoid breaking mid-sentence
    const sentences = this.splitIntoSentences(text);

    let currentChunk = '';
    let currentChunkStartChar = 0;
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

      // If adding this sentence exceeds chunk size, save current chunk
      if (potentialChunk.length > approxCharsPerChunk && currentChunk.length > 0) {
        const tokens = this.estimateTokens(currentChunk);
        chunks.push({
          text: currentChunk,
          chunkIndex,
          tokens,
          startChar: currentChunkStartChar,
          endChar: currentChunkStartChar + currentChunk.length,
        });

        chunkIndex++;

        // Start new chunk with overlap
        const overlapText = this.getOverlapText(currentChunk, approxOverlapChars);
        currentChunk = overlapText + (overlapText ? ' ' : '') + sentence;
        currentChunkStartChar += currentChunk.length - overlapText.length;
      } else {
        currentChunk = potentialChunk;
      }
    }

    // Add final chunk if it has content
    if (currentChunk.trim()) {
      const tokens = this.estimateTokens(currentChunk);
      chunks.push({
        text: currentChunk,
        chunkIndex,
        tokens,
        startChar: currentChunkStartChar,
        endChar: currentChunkStartChar + currentChunk.length,
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences (basic sentence boundary detection)
   */
  private static splitIntoSentences(text: string): string[] {
    // Match sentence boundaries: . ! ? followed by space or end
    const sentenceRegex = /[^.!?]+[.!?]+/g;
    const sentences = text.match(sentenceRegex) || [];

    // If no sentences matched, return the whole text as one sentence
    if (sentences.length === 0) {
      return [text.trim()];
    }

    return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  /**
   * Get overlap text from end of chunk
   */
  private static getOverlapText(chunk: string, overlapChars: number): string {
    if (chunk.length <= overlapChars) {
      return chunk;
    }

    // Try to break at sentence boundary within overlap window
    const overlapCandidate = chunk.slice(-overlapChars);
    const lastSentenceBoundary = Math.max(
      overlapCandidate.lastIndexOf('.'),
      overlapCandidate.lastIndexOf('!'),
      overlapCandidate.lastIndexOf('?')
    );

    if (lastSentenceBoundary > 0) {
      return overlapCandidate.slice(lastSentenceBoundary + 1).trim();
    }

    return overlapCandidate.trim();
  }

  /**
   * Estimate token count
   * Rough heuristic: 1 token ≈ 4 characters
   * This is approximate but sufficient for chunking
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Validate chunk options
   */
  static validateOptions(options: ChunkOptions): void {
    if (options.chunkSize <= 0) {
      throw new Error('Chunk size must be positive');
    }
    if (options.overlap < 0) {
      throw new Error('Overlap cannot be negative');
    }
    if (options.overlap >= options.chunkSize) {
      throw new Error('Overlap must be less than chunk size');
    }
  }
}

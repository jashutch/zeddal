/**
 * LLMRefineService: GPT-4 refinement with RAG context
 * Architecture: Refine transcription using vault context and user style
 * Status: Phase 2 - Implemented
 */

import { Config } from '../utils/Config';
import { RefinedNote } from '../utils/Types';
import { eventBus } from '../utils/EventBus';
import { CitationHelper } from '../utils/CitationHelper';

export class LLMRefineService {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Refine transcription with GPT-4 and optional context
   */
  async refine(
    text: string,
    context: string[] = [],
    userPrompt?: string
  ): Promise<RefinedNote> {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      // Build system prompt
      const systemPrompt = this.buildSystemPrompt(context);

      // Build user message
      const userMessage = userPrompt
        ? `${userPrompt}\n\nTranscription to refine:\n${text}`
        : `Please refine the following voice transcription into a well-structured note:\n\n${text}`;

      // Call GPT-4 API directly (fetch instead of SDK for consistency)
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get('gptModel'),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`GPT-4 API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      const refinedText = data.choices?.[0]?.message?.content?.trim() || text;

      // Generate title
      const title = await this.generateTitle(refinedText);

      // Extract potential wikilinks
      const links = this.extractWikilinks(refinedText);

      const refinedNote: RefinedNote = {
        title,
        body: refinedText,
        links,
        timestamp: Date.now(),
        originalTranscription: text,
        citations: CitationHelper.extract(refinedText),
      };

      eventBus.emit('refined', refinedNote);
      return refinedNote;
    } catch (error) {
      console.error('Refinement error:', error);
      eventBus.emit('error', {
        message: 'Refinement failed',
        error,
      });
      throw error;
    }
  }

  /**
   * Generate note title from content using GPT-4
   */
  async generateTitle(text: string): Promise<string> {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.get('gptModel'),
          messages: [
            {
              role: 'system',
              content: 'You are a title generator. Create concise, descriptive titles (max 8 words) for notes. Respond with ONLY the title, no quotes or formatting.',
            },
            {
              role: 'user',
              content: `Generate a title for this note:\n\n${text.substring(0, 500)}`,
            },
          ],
          temperature: 0.5,
          max_tokens: 50,
        }),
      });

      if (!response.ok) {
        console.warn('Title generation failed, using fallback');
        return this.generateFallbackTitle(text);
      }

      const data = await response.json();
      const title = data.choices?.[0]?.message?.content?.trim();
      return title || this.generateFallbackTitle(text);
    } catch (error) {
      console.error('Title generation error:', error);
      return this.generateFallbackTitle(text);
    }
  }

  /**
   * Simple refinement without GPT-4 (for quick saves)
   */
  async simpleRefine(text: string): Promise<RefinedNote> {
    const title = this.generateFallbackTitle(text);
    const links = this.extractWikilinks(text);

    const refinedNote: RefinedNote = {
      title,
      body: text,
      links,
      timestamp: Date.now(),
      originalTranscription: text,
      citations: CitationHelper.extract(text),
    };

    return refinedNote;
  }

  /**
   * Build system prompt with optional context
   */
 private buildSystemPrompt(context: string[]): string {
    let prompt = `You are an expert note-taking assistant for Obsidian. Your role is to:

1. Transform voice transcriptions into well-structured, readable notes
2. Fix grammar, punctuation, and sentence structure
3. Organize thoughts into clear sections with markdown headings
4. Preserve the speaker's original meaning and intent
5. Use markdown formatting (bold, italics, lists, etc.)
6. Identify key concepts and highlight them appropriately
7. If you introduce facts or data not explicitly present in the raw transcript, cite the exact external source that informed that statement using inline Markdown link syntax: [Source Name](https://example.com). These citations must reference actual sources you used while generating the response; do not invent URLs.
8. When citing broad background knowledge rather than a specific primary source, wrap the hyperlink in italics, e.g., _[Background Source](https://example.com)_, so readers know it is a general reference.`;

    if (context.length > 0) {
      prompt += `\n\n**Context from vault:**\n${context.slice(0, 3).join('\n\n')}`;
      prompt += '\n\nUse this context to inform your refinement and suggest relevant connections.';
    }

    return prompt;
  }

  /**
   * Extract wikilinks from text
   */
  private extractWikilinks(text: string): string[] {
    const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
    const matches = Array.from(text.matchAll(wikilinkRegex));
    return matches.map((match) => match[1]);
  }

  /**
   * Generate fallback title from first sentence
   */
  private generateFallbackTitle(text: string): string {
    // Get first sentence or first 50 chars
    const firstSentence = text.split(/[.!?]\s/)[0];
    const title = firstSentence.substring(0, 60).trim();

    // If too short, use timestamp
    if (title.length < 3) {
      const date = new Date();
      return `Voice Note ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    }

    return title + (firstSentence.length > 60 ? '...' : '');
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    const apiKey = this.config.get('openaiApiKey');
    return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
  }
}

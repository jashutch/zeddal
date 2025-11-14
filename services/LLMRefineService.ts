// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * LLMRefineService: Unified LLM refinement with RAG context
 * Architecture: Support for both OpenAI GPT-4 and local LLMs (Ollama, llama.cpp, etc.)
 * Status: Phase 2 - Implemented with local LLM support
 */

import { Config } from '../utils/Config';
import { RefinedNote } from '../utils/Types';
import { eventBus } from '../utils/EventBus';
import { CitationHelper } from '../utils/CitationHelper';
import { LocalLLMService, LocalLLMProvider } from './LocalLLMService';

export class LLMRefineService {
  private config: Config;
  private localLLMService: LocalLLMService | null = null;

  constructor(config: Config) {
    this.config = config;
    this.initializeLocalLLM();
  }

  /**
   * Initialize local LLM service if enabled
   */
  private initializeLocalLLM(): void {
    if (this.config.get('enableLocalLLM')) {
      const provider: LocalLLMProvider = {
        type: this.config.get('localLLMProvider') as any,
        baseUrl: this.config.get('localLLMBaseUrl'),
        model: this.config.get('localLLMModel'),
        apiKey: this.config.get('localLLMApiKey') || undefined,
      };

      this.localLLMService = new LocalLLMService(provider);
      console.log('[LLMRefineService] Local LLM enabled:', provider.type, provider.model);
    } else {
      this.localLLMService = null;
    }
  }

  /**
   * Update LLM backend when settings change
   */
  updateBackend(): void {
    this.initializeLocalLLM();
    const backend = this.getBackendName();
    console.log(`[LLMRefineService] Backend updated: ${backend}`);
  }

  /**
   * Get current backend name for debugging
   */
  getBackendName(): string {
    if (this.config.get('enableLocalLLM') && this.localLLMService) {
      const provider = this.localLLMService.getProvider();
      return `${provider.type} (${provider.model})`;
    }
    return 'OpenAI GPT-4';
  }

  /**
   * Refine transcription with LLM (local or OpenAI) and optional context
   */
  async refine(
    text: string,
    context: string[] = [],
    userPrompt?: string
  ): Promise<RefinedNote> {
    try {
      let refinedText: string;

      // Try local LLM first if enabled
      if (this.config.get('enableLocalLLM') && this.localLLMService) {
        console.log('[LLMRefineService] Using local LLM for refinement');
        try {
          refinedText = await this.refineWithLocalLLM(text, context, userPrompt);
        } catch (error) {
          console.warn('[LLMRefineService] Local LLM failed, falling back to OpenAI:', error);

          // Fallback to OpenAI
          const apiKey = this.config.get('openaiApiKey');
          if (apiKey) {
            refinedText = await this.refineWithOpenAI(text, context, userPrompt);
          } else {
            throw new Error('Local LLM failed and no OpenAI API key configured for fallback');
          }
        }
      } else {
        // Use OpenAI by default
        console.log('[LLMRefineService] Using OpenAI for refinement');
        refinedText = await this.refineWithOpenAI(text, context, userPrompt);
      }

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
   * Refine using local LLM
   */
  private async refineWithLocalLLM(
    text: string,
    context: string[] = [],
    userPrompt?: string
  ): Promise<string> {
    if (!this.localLLMService) {
      throw new Error('Local LLM service not initialized');
    }

    // Build combined prompt for local LLM
    const systemPrompt = this.buildSystemPrompt(context);
    const userMessage = userPrompt
      ? `${userPrompt}\n\nTranscription to refine:\n${text}`
      : `Please refine the following voice transcription into a well-structured note:\n\n${text}`;

    const fullPrompt = `${systemPrompt}\n\n${userMessage}`;

    // Use LocalLLMService with instruction-based refinement
    const result = await this.localLLMService.refineWithInstruction({
      type: 'voice',
      content: fullPrompt,
      originalText: text,
    });

    if (!result.success) {
      throw new Error(result.error || 'Local LLM refinement failed');
    }

    return result.refinedText;
  }

  /**
   * Refine using OpenAI GPT-4
   */
  private async refineWithOpenAI(
    text: string,
    context: string[] = [],
    userPrompt?: string
  ): Promise<string> {
    const apiKey = this.config.get('openaiApiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt(context);

    // Build user message
    const userMessage = userPrompt
      ? `${userPrompt}\n\nTranscription to refine:\n${text}`
      : `Please refine the following voice transcription into a well-structured note:\n\n${text}`;

    // Call GPT-4 API directly
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
    return data.choices?.[0]?.message?.content?.trim() || text;
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
   * Check if service is ready (either local LLM or OpenAI)
   */
  isReady(): boolean {
    // If local LLM is enabled, check if it's configured
    if (this.config.get('enableLocalLLM')) {
      const baseUrl = this.config.get('localLLMBaseUrl');
      const model = this.config.get('localLLMModel');
      return baseUrl !== '' && model !== '';
    }

    // Otherwise check OpenAI API key
    const apiKey = this.config.get('openaiApiKey');
    return apiKey !== null && apiKey !== undefined && apiKey.length > 0;
  }
}

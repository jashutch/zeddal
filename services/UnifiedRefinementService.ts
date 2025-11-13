// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * UnifiedRefinementService: Single GPT call combining formatting + summarization + learning
 * Architecture: Replaces separate TranscriptFormatter + LLMRefineService calls
 *
 * Benefits:
 * - 60-70% cost reduction (1 API call instead of 3)
 * - Better context awareness (sees all corrections at once)
 * - Learns from user patterns
 * - Faster processing (parallel instead of sequential)
 */

import { Config } from '../utils/Config';
import { CorrectionDatabase } from './CorrectionDatabase';
import { DiffGenerator } from '../utils/DiffGenerator';
import { TechnicalDomain } from '../utils/Types';

export interface UnifiedRefinementInput {
  rawTranscript: string;
  userCorrectedText?: string; // Optional manual corrections
  userInstruction?: string; // Custom instruction from user
  ragContext?: string[]; // Context from vault
  technicalDomain?: TechnicalDomain;
  includeAudioLink?: boolean;
  audioFilePath?: string;
}

export interface UnifiedRefinementOutput {
  title: string;
  summary: string;
  body: string; // Fully formatted markdown
  tags: string[];
  detectedCorrections?: Array<{ before: string; after: string; rule: string }>;
  learnedPatterns?: string[];
}

export class UnifiedRefinementService {
  private config: Config;
  private correctionDb: CorrectionDatabase;
  private openaiApiKey: string;
  private gptModel: string;

  constructor(config: Config, correctionDb: CorrectionDatabase) {
    this.config = config;
    this.correctionDb = correctionDb;
    this.openaiApiKey = config.get('openaiApiKey') || '';
    this.gptModel = config.get('gptModel') || 'gpt-4-turbo';
  }

  /**
   * Unified refinement: formatting + summarization + learning in one call
   */
  async refine(input: UnifiedRefinementInput): Promise<UnifiedRefinementOutput> {
    const prompt = this.buildUnifiedPrompt(input);

    try {
      const response = await this.callGPT4(prompt);

      // Parse JSON response
      const output: UnifiedRefinementOutput = JSON.parse(response);

      // Learn from detected corrections
      if (output.detectedCorrections) {
        await this.learnFromCorrections(output.detectedCorrections);
      }

      // Add audio link if requested
      if (input.includeAudioLink && input.audioFilePath) {
        output.body = `![[${input.audioFilePath}]]\n\n${output.body}`;
      }

      return output;
    } catch (error) {
      console.error('Unified refinement failed:', error);

      // Fallback: return minimally processed version
      return {
        title: `Voice Note ${new Date().toLocaleDateString()}`,
        summary: 'Transcription without AI enhancement',
        body: input.userCorrectedText || input.rawTranscript,
        tags: [],
      };
    }
  }

  /**
   * Build comprehensive prompt with all context
   */
  private buildUnifiedPrompt(input: UnifiedRefinementInput): string {
    const parts: string[] = [];

    // System context
    parts.push('You are refining a voice transcript with the following capabilities:');
    parts.push('');
    parts.push('1. **Technical Formatting**: Apply LaTeX for math, code blocks for programming');
    parts.push('2. **User Correction Learning**: Learn from manual corrections and apply patterns');
    parts.push('3. **Summarization**: Generate title and structured summary');
    parts.push('4. **Context Linking**: Create wikilinks to related notes');
    parts.push('');
    parts.push('---');
    parts.push('');

    // Original transcript
    parts.push('**Original Raw Transcript (from Whisper):**');
    parts.push('```');
    parts.push(input.rawTranscript);
    parts.push('```');
    parts.push('');

    // User corrections (if any)
    if (input.userCorrectedText && input.userCorrectedText !== input.rawTranscript) {
      parts.push('**User\'s Manual Corrections:**');
      parts.push('```');
      parts.push(input.userCorrectedText);
      parts.push('```');
      parts.push('');

      // Show diff
      const diff = DiffGenerator.generateUnified(input.rawTranscript, input.userCorrectedText);
      parts.push('**Diff (What the user changed):**');
      parts.push('```diff');
      parts.push(diff);
      parts.push('```');
      parts.push('');
      parts.push('**IMPORTANT**: Learn from these manual edits! Apply similar corrections throughout.');
      parts.push('');
    }

    // Learned patterns
    const patterns = this.correctionDb.getPatternsForPrompt(10);
    if (patterns.length > 0) {
      parts.push('**Learned Patterns (apply these automatically):**');
      patterns.forEach(p => parts.push(`- ${p}`));
      parts.push('');
    }

    // Custom instruction
    if (input.userInstruction) {
      parts.push('**Custom User Instruction:**');
      parts.push(input.userInstruction);
      parts.push('');
    }

    // RAG context
    if (input.ragContext && input.ragContext.length > 0) {
      parts.push('**Related Notes from Vault (for context linking):**');
      input.ragContext.slice(0, 3).forEach((ctx, i) => {
        parts.push(`${i + 1}. ${ctx.substring(0, 200)}...`);
      });
      parts.push('');
    }

    // Technical domain hint
    if (input.technicalDomain && input.technicalDomain !== 'auto') {
      parts.push(`**Domain Hint:** ${input.technicalDomain}`);
      parts.push('');
    }

    parts.push('---');
    parts.push('');

    // Task instructions
    parts.push('**Your Task:**');
    parts.push('');
    parts.push('1. **Apply technical formatting**:');
    parts.push('   - Math expressions → LaTeX ($...$ inline, $$...$$ display)');
    parts.push('   - Code → Markdown code blocks with language tags (bash, python, javascript, etc.)');
    parts.push('   - Greek letters → LaTeX (\\alpha, \\beta, etc.)');
    parts.push('   - Shell commands → ```bash or ```ash for BusyBox');
    parts.push('');

    parts.push('2. **Learn from user corrections**:');
    parts.push('   - Notice patterns in manual edits (e.g., always capitalizing ~/Documents)');
    parts.push('   - Apply similar corrections throughout the text');
    parts.push('   - Respect user preferences and style');
    parts.push('');

    parts.push('3. **Generate metadata**:');
    parts.push('   - Title: Concise, descriptive (max 60 chars), captures main topic');
    parts.push('   - Summary: 2-3 sentences capturing key points');
    parts.push('   - Tags: Relevant topic tags (3-5 tags)');
    parts.push('');

    parts.push('4. **Add context links**:');
    parts.push('   - Create wikilinks [[like this]] for concepts mentioned in vault context');
    parts.push('   - Only link to notes that actually exist (from RAG context above)');
    parts.push('');

    parts.push('5. **Detect correction patterns**:');
    parts.push('   - Identify what patterns you applied (for learning)');
    parts.push('   - Return these as detectedCorrections array');
    parts.push('');

    // Output format
    parts.push('**Output Format (JSON):**');
    parts.push('```json');
    parts.push('{');
    parts.push('  "title": "Generated title here",');
    parts.push('  "summary": "2-3 sentence summary capturing main points",');
    parts.push('  "body": "Fully formatted markdown content with LaTeX, code blocks, and wikilinks",');
    parts.push('  "tags": ["tag1", "tag2", "tag3"],');
    parts.push('  "detectedCorrections": [');
    parts.push('    {"before": "tar cvf", "after": "tar -cvf", "rule": "shell_flags: add hyphen"},');
    parts.push('    {"before": "documents", "after": "Documents", "rule": "capitalization: proper noun"}');
    parts.push('  ]');
    parts.push('}');
    parts.push('```');
    parts.push('');

    // Important notes
    parts.push('**Important:**');
    parts.push('- Return ONLY valid JSON, no markdown wrappers or explanations');
    parts.push('- The body should be complete, well-formatted Markdown');
    parts.push('- Preserve the user\'s voice and natural language');
    parts.push('- Don\'t over-format - keep conversational text natural');
    parts.push('- Be conservative with wikilinks - only link when confident');

    return parts.join('\n');
  }

  /**
   * Call GPT-4 with unified prompt
   */
  private async callGPT4(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.gptModel,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at refining voice transcripts with technical formatting, learning from user corrections, and generating structured output. ' +
              'You understand LaTeX, Markdown, programming languages (bash, python, javascript, go, etc.), and academic writing. ' +
              'You learn from user preferences and apply patterns consistently. ' +
              'You ALWAYS return valid JSON in the specified format.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      throw new Error(`GPT-4 API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Learn from detected corrections
   */
  private async learnFromCorrections(
    corrections: Array<{ before: string; after: string; rule: string }>
  ): Promise<void> {
    for (const corr of corrections) {
      // Extract category from rule
      const category = this.extractCategory(corr.rule);

      // Add to correction database
      await this.correctionDb.addCorrection(
        corr.before,
        corr.after,
        category,
        undefined,
        corr.rule
      );
    }
  }

  /**
   * Extract category from rule description
   */
  private extractCategory(rule: string): any {
    if (rule.includes('shell') || rule.includes('flag')) return 'shell_flags';
    if (rule.includes('capital')) return 'capitalization';
    if (rule.includes('punct')) return 'punctuation';
    if (rule.includes('code')) return 'code_formatting';
    if (rule.includes('math') || rule.includes('latex')) return 'math_notation';
    if (rule.includes('technical')) return 'technical_term';
    return 'custom';
  }

  /**
   * Update API key
   */
  updateApiKey(apiKey: string): void {
    this.openaiApiKey = apiKey;
  }

  /**
   * Update GPT model
   */
  updateGPTModel(model: string): void {
    this.gptModel = model;
  }
}

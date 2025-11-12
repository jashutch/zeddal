// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * VoiceCommandProcessor: Process voice commands for wikilinks and formatting
 * Architecture: Post-process transcriptions to convert voice commands to markdown
 */

const COMMAND_STOP_WORDS = [
  'and',
  'but',
  'or',
  'so',
  'because',
  'while',
  'when',
  'then',
  'than',
  'the',
  'a',
  'an',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'about',
  'as',
  'of',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'should',
  'could',
  'may',
  'might',
  'can',
  'must',
  'shall',
  'that',
  'this',
  'these',
  'those',
  'there',
  'here',
  'it',
  'he',
  'she',
  'we',
  'they',
  'you',
];

const STOP_PATTERN = `(?:\\s+(?:${COMMAND_STOP_WORDS.join('|')})\\b|[.,;!?]|$)`;

const LINK_COMMAND_REGEX = new RegExp(
  `zeddal\\s+link\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,80}?)\\s+to\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,120}?)(?=${STOP_PATTERN})`,
  'gi'
);

const SIMPLE_LINK_REGEX = new RegExp(
  `zeddal\\s+link\\s+([a-zA-Z0-9][a-zA-Z0-9\\s'\\-]{0,80}?)(?=${STOP_PATTERN})`,
  'gi'
);

const SENTENCE_LINK_REGEX = /(^|\.\s+)link\s+([a-zA-Z0-9\-']+)/gi;

export class VoiceCommandProcessor {
  /**
   * Process transcription text and convert voice commands to markdown
   */
  static process(text: string): string {
    let processed = text;

    // Normalize common misrecognitions of "zeddal"
    processed = this.normalizeWakeWord(processed);

    // Process wikilink commands
    processed = this.processExplicitLinkCommands(processed);
    processed = this.processSimpleLinkCommands(processed);
    processed = this.processSentenceLinkCommands(processed);

    // Normalize brand name mentions
    processed = this.normalizeBrandName(processed);

    return processed;
  }

  /**
   * Normalize common misrecognitions of the "zeddal" wake word
   * Common misrecognitions: zettle,zettel, zetal, zedal, sedal, etc.
   */
  private static normalizeWakeWord(text: string): string {
    // Replace common misrecognitions (including concatenated/hyphenated forms) with "zeddal link"
    return text.replace(
      /(zeddal|zettle|zettel|zetal|zedal|sedal|zettal|zeddle|zedle|zetl)(?:\s*|-)?link(?![a-z])/gi,
      'zeddal link'
    );
  }

  /**
   * Handle "Zeddal link <display> to <existing note>" commands
   */
  private static processExplicitLinkCommands(text: string): string {
    return text.replace(
      LINK_COMMAND_REGEX,
      (_match, displayRaw: string, targetRaw: string) => {
        const display = this.cleanPhrase(displayRaw);
        const target = this.cleanPhrase(targetRaw);

        if (!target) {
          return display || targetRaw;
        }

        return this.formatWikilink(target, display);
      }
    );
  }

  /**
   * Handle "Zeddal link <phrase>" shorthand commands
   */
  private static processSimpleLinkCommands(text: string): string {
    return text.replace(SIMPLE_LINK_REGEX, (_match, phraseRaw: string) => {
      const phrase = this.cleanPhrase(phraseRaw);
      return phrase ? this.formatWikilink(phrase) : phraseRaw;
    });
  }

  /**
   * Handle sentence-starting "Link <word>" fallback
   */
  private static processSentenceLinkCommands(text: string): string {
    return text.replace(
      SENTENCE_LINK_REGEX,
      (match, prefix: string, word: string) => {
        const cleaned = this.cleanPhrase(word, 1);
        return cleaned ? `${prefix}${this.formatWikilink(cleaned)}` : match;
      }
    );
  }

  /**
   * Normalize standalone mentions of the brand name to "Zeddal"
   */
  private static normalizeBrandName(text: string): string {
    return text.replace(
      /\b(zeddal|zettle|zettel|zetal|zedal|sedal|zettal|zeddle|zedle|zetl)\b/gi,
      'Zeddal'
    );
  }

  /**
   * Extract potential wikilinks that user mentioned
   * This helps identify what the user might want to link to
   */
  static extractLinkCandidates(text: string): string[] {
    const candidates: string[] = [];

    const normalized = this.normalizeWakeWord(text);

    // Explicit commands
    for (const match of normalized.matchAll(LINK_COMMAND_REGEX)) {
      const displaySegment = this.cleanPhrase(match[1]);
      const targetSegment = this.cleanPhrase(match[2]);
      if (targetSegment) {
        candidates.push(targetSegment);
      }
      if (displaySegment && displaySegment !== targetSegment) {
        candidates.push(displaySegment);
      }
    }

    // Simple commands
    for (const match of normalized.matchAll(SIMPLE_LINK_REGEX)) {
      const phrase = this.cleanPhrase(match[1]);
      if (phrase) candidates.push(phrase);
    }

    return candidates;
  }

  /**
   * Check if text contains voice commands
   */
  static hasVoiceCommands(text: string): boolean {
    // Normalize first to capture wake-word variants like "ZettelLink"
    const normalized = this.normalizeWakeWord(text);
    const hasWakeWord = /zeddal\s+link/gi.test(normalized);
    SENTENCE_LINK_REGEX.lastIndex = 0;
    const hasSentenceLink = SENTENCE_LINK_REGEX.test(normalized);
    return hasWakeWord || hasSentenceLink;
  }

  /**
   * Preview what commands would be processed
   * Useful for showing user what will happen
   */
  static previewCommands(text: string): { original: string; processed: string }[] {
    const previews: { original: string; processed: string }[] = [];

    const normalized = this.normalizeWakeWord(text);

    for (const match of normalized.matchAll(LINK_COMMAND_REGEX)) {
      const display = this.cleanPhrase(match[1]);
      const target = this.cleanPhrase(match[2]);
      if (!target) continue;

      previews.push({
        original: match[0],
        processed: this.formatWikilink(target, display),
      });
    }

    for (const match of normalized.matchAll(SIMPLE_LINK_REGEX)) {
      const phrase = this.cleanPhrase(match[1]);
      if (!phrase) continue;
      previews.push({
        original: match[0],
        processed: this.formatWikilink(phrase),
      });
    }

    return previews;
  }

  /**
   * Clean a spoken phrase by trimming, collapsing whitespace, and limiting words
   */
  private static cleanPhrase(phrase: string, wordLimit: number = 6): string {
    if (!phrase) return '';
    const trimmed = phrase
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[^a-zA-Z0-9]+/, '')
      .replace(/[^a-zA-Z0-9]+$/, '');

    if (!trimmed) return '';

    return trimmed
      .split(' ')
      .filter(Boolean)
      .slice(0, wordLimit)
      .join(' ');
  }

  /**
   * Format a wikilink, optionally with alias
   */
  private static formatWikilink(target: string, display?: string): string {
    if (!display || display.toLowerCase() === target.toLowerCase()) {
      return `[[${target}]]`;
    }

    return `[[${target}|${display}]]`;
  }
}

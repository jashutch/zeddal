// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { App } from 'obsidian';
import { Config } from '../utils/Config';
import { VaultRAGService, SemanticNoteMatch } from './VaultRAGService';

interface NoteEntry {
  title: string;
  normalized: string;
}

interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

export class ContextLinkService {
  private index: NoteEntry[] = [];
  private isDirty = true;
  private lastBuilt = 0;
  private readonly semanticThreshold = 0.78;
  private readonly maxLinksPerSentence = 3;
  private readonly maxSemanticCandidates = 4;

  constructor(
    private app: App,
    private vaultRAGService: VaultRAGService,
    private config: Config
  ) {}

  markDirty(): void {
    this.isDirty = true;
  }

  private shouldRebuild(): boolean {
    const TEN_MINUTES = 10 * 60 * 1000;
    return this.isDirty || Date.now() - this.lastBuilt > TEN_MINUTES;
  }

  private async ensureIndex(): Promise<void> {
    if (!this.shouldRebuild()) return;
    const files = this.app.vault.getMarkdownFiles();
    this.index = files.map((file) => ({
      title: file.basename,
      normalized: this.normalize(file.basename),
    }));
    this.lastBuilt = Date.now();
    this.isDirty = false;
  }

  async applyContextLinks(text: string): Promise<{ text: string; matches: number }>
  {
    if (!text?.trim()) {
      return { text, matches: 0 };
    }

    await this.ensureIndex();
    let workingText = text;
    let totalMatches = 0;

    const semanticResult = await this.applySemanticLinks(workingText);
    workingText = semanticResult.text;
    totalMatches += semanticResult.matches;

    const exactResult = this.applyExactTitleLinks(workingText);
    workingText = exactResult.text;
    totalMatches += exactResult.matches;

    return { text: workingText, matches: totalMatches };
  }

  private buildRegex(title: string): RegExp {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<!\\[\\[)(${escaped})(?![^\\]]*\\]\])`, 'gi');
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private applyExactTitleLinks(text: string): { text: string; matches: number } {
    if (!this.index.length) {
      return { text, matches: 0 };
    }

    const sortByLength = [...this.index].sort(
      (a, b) => b.title.length - a.title.length
    );

    let output = text;
    let matches = 0;

    for (const entry of sortByLength) {
      if (!entry.title || entry.title.length < 3) continue;
      const pattern = this.buildRegex(entry.title);
      output = output.replace(pattern, (match, captured) => {
        matches += 1;
        const aliasNeeded = captured.toLowerCase() !== entry.title.toLowerCase();
        return aliasNeeded
          ? `[[${entry.title}|${captured}]]`
          : `[[${entry.title}]]`;
      });
    }

    return { text: output, matches };
  }

  private async applySemanticLinks(
    text: string
  ): Promise<{ text: string; matches: number }> {
    if (
      !this.config.get('enableRAG') ||
      !this.vaultRAGService ||
      !this.config.get('autoContextLinks')
    ) {
      return { text, matches: 0 };
    }

    const sentences = this.extractSentences(text);
    if (!sentences.length) {
      return { text, matches: 0 };
    }

    let matches: SemanticNoteMatch[][] = [];
    try {
      matches = await this.vaultRAGService.findSimilarNotesBatch(
        sentences.map((s) => s.text),
        { topK: this.maxSemanticCandidates }
      );
    } catch (error) {
      console.warn('Semantic linking failed:', error);
      return { text, matches: 0 };
    }

    const replacements: Replacement[] = [];

    sentences.forEach((sentence, index) => {
      const candidates = matches[index] || [];
      if (!candidates.length) {
        return;
      }

      let linksAdded = 0;
      for (const candidate of candidates) {
        if (candidate.similarity < this.semanticThreshold) {
          continue;
        }

        const span = this.findAnchorSpan(sentence.text, candidate);
        if (!span) continue;

        const start = sentence.start + span.start;
        const end = sentence.start + span.end;

        if (
          end <= start ||
          this.isInsideExistingLink(text, start) ||
          this.overlapsExisting(start, end, replacements)
        ) {
          continue;
        }

        const alias = text.slice(start, end);
        if (!alias.trim()) {
          continue;
        }

        const needsAlias =
          alias.toLowerCase() !== candidate.noteTitle.toLowerCase();
        const replacement = needsAlias
          ? `[[${candidate.noteTitle}|${alias}]]`
          : `[[${candidate.noteTitle}]]`;

        replacements.push({ start, end, text: replacement });
        linksAdded += 1;

        if (linksAdded >= this.maxLinksPerSentence) {
          break;
        }
      }
    });

    if (!replacements.length) {
      return { text, matches: 0 };
    }

    const updated = this.applyReplacements(text, replacements);
    return { text: updated, matches: replacements.length };
  }

  private extractSentences(text: string): SentenceSpan[] {
    const regex = /[^.!?\n]+[.!?]?/g;
    const sentences: SentenceSpan[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const raw = match[0];
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const leadingWhitespace = raw.indexOf(trimmed);
      const matchIndex = match.index ?? 0;
      const start = matchIndex + (leadingWhitespace >= 0 ? leadingWhitespace : 0);
      const end = start + trimmed.length;

      sentences.push({ text: trimmed, start, end });
    }

    return sentences;
  }

  private findAnchorSpan(
    sentence: string,
    candidate: SemanticNoteMatch
  ): { start: number; end: number } | null {
    const lowerSentence = sentence.toLowerCase();
    const keywords = this.buildKeywordList(candidate);

    for (const keyword of keywords) {
      if (!keyword) continue;
      const idx = lowerSentence.indexOf(keyword);
      if (idx !== -1) {
        return { start: idx, end: idx + keyword.length };
      }
    }

    // Fallback: link the full sentence
    return { start: 0, end: sentence.length };
  }

  private buildKeywordList(candidate: SemanticNoteMatch): string[] {
    const keywords = new Set<string>();
    const pushTokens = (source: string, minLength: number) => {
      if (!source) return;
      const tokens = source
        .toLowerCase()
        .match(/[a-z0-9]{2,}/g);
      if (!tokens) return;
      tokens
        .filter((token) => token.length >= minLength)
        .forEach((token) => keywords.add(token));
    };

    if (candidate.noteTitle) {
      keywords.add(candidate.noteTitle.toLowerCase());
    }
    pushTokens(candidate.noteTitle, 3);
    pushTokens(candidate.chunkText, 5);

    return Array.from(keywords).sort((a, b) => b.length - a.length);
  }

  private isInsideExistingLink(text: string, index: number): boolean {
    const open = text.lastIndexOf('[[', index);
    if (open === -1) {
      return false;
    }
    const close = text.indexOf(']]', open);
    return close !== -1 && close > index;
  }

  private overlapsExisting(
    start: number,
    end: number,
    replacements: Replacement[]
  ): boolean {
    return replacements.some(
      (replacement) => start < replacement.end && end > replacement.start
    );
  }

  private applyReplacements(text: string, replacements: Replacement[]): string {
    const sorted = [...replacements].sort((a, b) => b.start - a.start);
    let output = text;

    for (const replacement of sorted) {
      output =
        output.slice(0, replacement.start) +
        replacement.text +
        output.slice(replacement.end);
    }

    return output;
  }
}

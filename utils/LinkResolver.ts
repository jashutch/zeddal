// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * LinkResolver: Ensures voice command wikilinks target existing vault notes
 */

import { VaultOps } from '../services/VaultOps';
import type { TFile } from 'obsidian';

type NoteIndex = {
  title: string;
  normalized: string;
  regex: RegExp;
  folderPath: string;
};

interface ResolveOptions {
  autoLinkFirstMatch?: boolean;
}

export class LinkResolver {
  /**
   * Resolve wikilinks in text to canonical vault note titles when possible.
   */
  static async resolveExistingNotes(
    text: string,
    vaultOps: VaultOps,
    options: ResolveOptions = {}
  ): Promise<string> {
    try {
      const files = await vaultOps.listMarkdownFiles();
      if (!files || files.length === 0) {
        return text;
      }

      const index = this.buildIndex(files);

      let output = text.replace(
        /\[\[([^\]\|]+)(\|([^\]]+))?\]\]/g,
        (match, rawTarget: string, aliasWithPipe?: string, alias?: string) => {
          const canonical = this.findCanonicalTitle(rawTarget, index);
          if (!canonical) {
            return match;
          }

          if (alias) {
            return `[[${canonical}|${alias.trim()}]]`;
          }

          return `[[${canonical}]]`;
        }
      );

      if (options.autoLinkFirstMatch) {
        output = this.autoLinkFirstMatch(output, index);
      }

      return output;
    } catch (error) {
      console.error('LinkResolver failed to resolve notes:', error);
      return text;
    }
  }

  /**
   * Build searchable index of vault notes.
   */
  private static buildIndex(files: TFile[]): NoteIndex[] {
    const seen = new Set<string>();
    const index: NoteIndex[] = [];

    for (const file of files) {
      const normalized = this.normalize(file.basename);
      if (!normalized || seen.has(normalized)) continue;

      seen.add(normalized);
      index.push({
        title: file.basename,
        normalized,
        regex: this.createMatchRegex(file.basename),
        folderPath: this.getFolderPath(file),
      });
    }

    return index;
  }

  /**
   * Attempt to find the canonical vault title for a spoke target.
   */
  private static findCanonicalTitle(
    target: string,
    notes: NoteIndex[]
  ): string | null {
    const normalizedTarget = this.normalize(target);
    if (!normalizedTarget) return null;

    // Exact normalized match first
    const exact = notes.find((note) => note.normalized === normalizedTarget);
    if (exact) {
      return exact.title;
    }

    // Fuzzy match: Contains / StartsWith
    const containsMatch = notes.find(
      (note) =>
        note.normalized.includes(normalizedTarget) ||
        normalizedTarget.includes(note.normalized)
    );

    if (containsMatch) {
      return containsMatch.title;
    }

    return null;
  }

  /**
   * Normalize phrases for loose comparison.
   */
  private static normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\[\]\(\)\{\}\.,'"`]/g, '')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Attempt to link the earliest plain-text occurrence of a vault note
   */
  private static autoLinkFirstMatch(text: string, notes: NoteIndex[]): string {
    if (!notes.length || !text) return text;

    const existingRanges = this.findExistingLinkRanges(text);
    let bestMatch:
      | { start: number; end: number; title: string; original: string }
      | null = null;

    for (const note of notes) {
      note.regex.lastIndex = 0;
      const match = note.regex.exec(text);
      if (!match) continue;

      const start = match.index;
      const end = start + match[0].length;

      if (this.isInsideExistingLink(start, existingRanges)) continue;

      if (!bestMatch || start < bestMatch.start) {
        bestMatch = {
          start,
          end,
          title: note.title,
          original: match[0],
        };
      }
    }

    if (!bestMatch) return text;

    const before = text.slice(0, bestMatch.start);
    const after = text.slice(bestMatch.end);
    const needsAlias =
      bestMatch.original.toLowerCase() !== bestMatch.title.toLowerCase();
    const link = needsAlias
      ? `[[${bestMatch.title}|${bestMatch.original}]]`
      : `[[${bestMatch.title}]]`;

    return `${before}${link}${after}`;
  }

  private static findExistingLinkRanges(text: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const regex = /\[\[[^\]]+\]\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
    return ranges;
  }

  private static isInsideExistingLink(
    index: number,
    ranges: Array<{ start: number; end: number }>
  ): boolean {
    return ranges.some((range) => index >= range.start && index <= range.end);
  }

  private static createMatchRegex(title: string): RegExp {
    const escaped = title
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${escaped}\\b`, 'i');
  }

  private static getFolderPath(file: TFile): string {
    const path = file.path || '';
    const slashIndex = path.lastIndexOf('/');
    if (slashIndex === -1) {
      return '';
    }
    return path.substring(0, slashIndex);
  }

  /**
   * Suggest a folder based on the first matching note reference in content
   */
  static async suggestFolderForContent(
    text: string,
    vaultOps: VaultOps
  ): Promise<string | null> {
    if (!text || !text.trim()) return null;

    try {
      const files = await vaultOps.listMarkdownFiles();
      if (!files || files.length === 0) {
        return null;
      }

      const index = this.buildIndex(files);
      const ranges = this.findExistingLinkRanges(text);
      let best:
        | {
            start: number;
            folder: string;
          }
        | null = null;

      for (const note of index) {
        note.regex.lastIndex = 0;
        const match = note.regex.exec(text);
        if (!match) continue;

        const start = match.index;
        if (this.isInsideExistingLink(start, ranges)) continue;

        if (!best || start < best.start) {
          best = {
            start,
            folder: note.folderPath,
          };
        }
      }

      if (!best) return null;
      return best.folder || null;
    } catch (error) {
      console.error('LinkResolver.suggestFolderForContent failed:', error);
      return null;
    }
  }
}

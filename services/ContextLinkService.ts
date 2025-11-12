// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { App } from 'obsidian';

interface NoteEntry {
  title: string;
  normalized: string;
}

export class ContextLinkService {
  private index: NoteEntry[] = [];
  private isDirty = true;
  private lastBuilt = 0;

  constructor(private app: App) {}

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

  private buildRegex(title: string): RegExp {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<!\\[\\[)(${escaped})(?![^\\]]*\\]\])`, 'gi');
  }

  private normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

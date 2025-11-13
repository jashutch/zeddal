// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * DiffGenerator: Generate human-readable diffs between text versions
 * Architecture: Simple line-by-line diff for transcription corrections
 */

export interface DiffChange {
  type: 'add' | 'remove' | 'unchanged';
  line: number;
  content: string;
}

export interface DiffResult {
  changes: DiffChange[];
  summary: {
    additions: number;
    removals: number;
    modifications: number;
  };
}

export class DiffGenerator {
  /**
   * Generate diff between two texts
   */
  static generate(original: string, modified: string): DiffResult {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const changes: DiffChange[] = [];
    let additions = 0;
    let removals = 0;
    let modifications = 0;

    // Simple line-by-line diff
    const maxLines = Math.max(originalLines.length, modifiedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];

      if (origLine === modLine) {
        // Unchanged
        changes.push({
          type: 'unchanged',
          line: i + 1,
          content: origLine || '',
        });
      } else if (origLine === undefined) {
        // Addition
        changes.push({
          type: 'add',
          line: i + 1,
          content: modLine,
        });
        additions++;
      } else if (modLine === undefined) {
        // Removal
        changes.push({
          type: 'remove',
          line: i + 1,
          content: origLine,
        });
        removals++;
      } else {
        // Modification (show as remove + add)
        changes.push({
          type: 'remove',
          line: i + 1,
          content: origLine,
        });
        changes.push({
          type: 'add',
          line: i + 1,
          content: modLine,
        });
        modifications++;
      }
    }

    return {
      changes,
      summary: {
        additions,
        removals,
        modifications,
      },
    };
  }

  /**
   * Generate unified diff format (for display)
   */
  static generateUnified(original: string, modified: string, contextLines: number = 3): string {
    const diff = this.generate(original, modified);
    const lines: string[] = [];

    lines.push('--- Original');
    lines.push('+++ Modified');
    lines.push('');

    for (const change of diff.changes) {
      switch (change.type) {
        case 'remove':
          lines.push(`- ${change.content}`);
          break;
        case 'add':
          lines.push(`+ ${change.content}`);
          break;
        case 'unchanged':
          lines.push(`  ${change.content}`);
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate compact summary of changes
   */
  static generateSummary(original: string, modified: string): string {
    const diff = this.generate(original, modified);
    const { additions, removals, modifications } = diff.summary;

    const parts: string[] = [];

    if (modifications > 0) {
      parts.push(`${modifications} line(s) modified`);
    }
    if (additions > 0) {
      parts.push(`${additions} line(s) added`);
    }
    if (removals > 0) {
      parts.push(`${removals} line(s) removed`);
    }

    if (parts.length === 0) {
      return 'No changes detected';
    }

    return parts.join(', ');
  }

  /**
   * Extract specific changes (for learning)
   */
  static extractChanges(original: string, modified: string): Array<{ before: string; after: string }> {
    const changes: Array<{ before: string; after: string }> = [];

    // Word-level diff
    const originalWords = original.split(/\s+/);
    const modifiedWords = modified.split(/\s+/);

    // Find changed words
    for (let i = 0; i < Math.min(originalWords.length, modifiedWords.length); i++) {
      if (originalWords[i] !== modifiedWords[i]) {
        changes.push({
          before: originalWords[i],
          after: modifiedWords[i],
        });
      }
    }

    return changes;
  }

  /**
   * Detect common correction patterns
   */
  static detectPatterns(original: string, modified: string): {
    category: string;
    pattern: string;
  }[] {
    const patterns: { category: string; pattern: string }[] = [];
    const changes = this.extractChanges(original, modified);

    for (const change of changes) {
      // Detect shell flags
      if (/^[a-z]+$/.test(change.before) && change.after === `-${change.before}`) {
        patterns.push({
          category: 'shell_flags',
          pattern: `Added hyphen to command flags: ${change.before} → ${change.after}`,
        });
      }

      // Detect capitalization
      if (change.before.toLowerCase() === change.after.toLowerCase()) {
        patterns.push({
          category: 'capitalization',
          pattern: `Changed capitalization: ${change.before} → ${change.after}`,
        });
      }

      // Detect path corrections
      if (change.before.includes('~') || change.after.includes('~')) {
        patterns.push({
          category: 'capitalization',
          pattern: `Corrected path: ${change.before} → ${change.after}`,
        });
      }
    }

    return patterns;
  }

  /**
   * Generate HTML diff (for rich display)
   */
  static generateHTML(original: string, modified: string): string {
    const diff = this.generate(original, modified);
    const lines: string[] = [];

    lines.push('<div class="zeddal-diff">');

    for (const change of diff.changes) {
      const escapedContent = this.escapeHTML(change.content);

      switch (change.type) {
        case 'remove':
          lines.push(`<div class="diff-remove">- ${escapedContent}</div>`);
          break;
        case 'add':
          lines.push(`<div class="diff-add">+ ${escapedContent}</div>`);
          break;
        case 'unchanged':
          lines.push(`<div class="diff-unchanged">  ${escapedContent}</div>`);
          break;
      }
    }

    lines.push('</div>');

    return lines.join('\n');
  }

  /**
   * Escape HTML
   */
  private static escapeHTML(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

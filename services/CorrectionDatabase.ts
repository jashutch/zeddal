// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * CorrectionDatabase: Learning system for user transcript corrections
 * Architecture: Local storage of correction patterns with confidence scoring
 *
 * Features:
 * - Store user corrections as patterns
 * - Learn from repeated corrections
 * - Auto-apply high-confidence patterns
 * - Export/import for sharing
 * - Analytics and insights
 */

import { App } from 'obsidian';

export type CorrectionCategory =
  | 'shell_flags'
  | 'capitalization'
  | 'punctuation'
  | 'technical_term'
  | 'code_formatting'
  | 'math_notation'
  | 'custom';

export interface CorrectionPattern {
  id: string;
  timestamp: number;
  category: CorrectionCategory;

  // The actual correction
  before: string;
  after: string;
  context?: string; // Surrounding text for context

  // Metadata
  frequency: number; // How many times user makes this correction
  confidence: number; // 0-1 score
  autoApply: boolean; // Apply automatically in future?
  lastUsed: number; // Timestamp of last use

  // Learning
  userInstruction?: string; // What user said when correcting
  relatedPatterns?: string[]; // IDs of similar corrections

  // Privacy
  isShared: boolean; // Share with community?
  isLocal: boolean; // Store locally only?
}

export interface CorrectionAnalytics {
  totalCorrections: number;
  topPatterns: {
    pattern: CorrectionPattern;
    frequency: number;
  }[];
  autoApplyRate: number;
  manualEditRate: number;
  categoryBreakdown: Record<CorrectionCategory, number>;
  lastUpdated: number;
}

export interface CorrectionSuggestion {
  pattern: CorrectionPattern;
  match: string;
  replacement: string;
  confidence: number;
  position: { start: number; end: number };
}

export class CorrectionDatabase {
  private app: App;
  private patterns: Map<string, CorrectionPattern> = new Map();
  private dbPath: string;
  private autoSaveInterval: number | null = null;

  constructor(app: App, dbPath: string = '.zeddal/corrections.json') {
    this.app = app;
    this.dbPath = dbPath;
  }

  /**
   * Initialize the database (load from disk)
   */
  async initialize(): Promise<void> {
    try {
      const data = await this.app.vault.adapter.read(this.dbPath);
      const parsed = JSON.parse(data);

      // Convert array to Map
      if (Array.isArray(parsed.patterns)) {
        parsed.patterns.forEach((p: CorrectionPattern) => {
          this.patterns.set(p.id, p);
        });
      }

      console.log(`Loaded ${this.patterns.size} correction patterns`);
    } catch (error) {
      // Database doesn't exist yet, create it
      console.log('Creating new correction database');
      await this.save();
    }

    // Auto-save every 5 minutes
    this.autoSaveInterval = window.setInterval(() => {
      this.save();
    }, 5 * 60 * 1000);
  }

  /**
   * Add or update a correction pattern
   */
  async addCorrection(
    before: string,
    after: string,
    category: CorrectionCategory,
    context?: string,
    userInstruction?: string
  ): Promise<CorrectionPattern> {
    // Check if similar pattern exists
    const existing = this.findSimilarPattern(before, after);

    if (existing) {
      // Update frequency and confidence
      existing.frequency++;
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
      existing.lastUsed = Date.now();

      // Auto-apply if confidence is high enough
      if (existing.confidence >= 0.9 && !existing.autoApply) {
        existing.autoApply = true;
        console.log(`Auto-apply enabled for pattern: ${before} → ${after}`);
      }

      this.patterns.set(existing.id, existing);
      await this.save();
      return existing;
    }

    // Create new pattern
    const pattern: CorrectionPattern = {
      id: this.generateId(),
      timestamp: Date.now(),
      category,
      before,
      after,
      context,
      frequency: 1,
      confidence: 0.5, // Start with medium confidence
      autoApply: false,
      lastUsed: Date.now(),
      userInstruction,
      isShared: false,
      isLocal: true,
    };

    this.patterns.set(pattern.id, pattern);
    await this.save();
    return pattern;
  }

  /**
   * Find patterns that match the given text
   */
  findMatches(text: string): CorrectionSuggestion[] {
    const suggestions: CorrectionSuggestion[] = [];

    for (const pattern of this.patterns.values()) {
      // Only suggest if confidence is reasonable
      if (pattern.confidence < 0.5) continue;

      // Simple string matching (could be enhanced with regex)
      let index = text.indexOf(pattern.before);
      while (index !== -1) {
        suggestions.push({
          pattern,
          match: pattern.before,
          replacement: pattern.after,
          confidence: pattern.confidence,
          position: { start: index, end: index + pattern.before.length },
        });

        index = text.indexOf(pattern.before, index + 1);
      }
    }

    // Sort by confidence (highest first)
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get auto-apply patterns
   */
  getAutoApplyPatterns(): CorrectionPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.autoApply);
  }

  /**
   * Apply auto-apply patterns to text
   */
  applyAutoCorrections(text: string): { text: string; applied: CorrectionPattern[] } {
    let correctedText = text;
    const applied: CorrectionPattern[] = [];

    const autoPatterns = this.getAutoApplyPatterns();
    for (const pattern of autoPatterns) {
      if (correctedText.includes(pattern.before)) {
        correctedText = correctedText.replace(new RegExp(this.escapeRegex(pattern.before), 'g'), pattern.after);
        applied.push(pattern);

        // Update usage stats
        pattern.lastUsed = Date.now();
        pattern.frequency++;
      }
    }

    if (applied.length > 0) {
      this.save(); // Save updated stats
    }

    return { text: correctedText, applied };
  }

  /**
   * Get analytics
   */
  getAnalytics(): CorrectionAnalytics {
    const patterns = Array.from(this.patterns.values());

    const categoryBreakdown: Record<CorrectionCategory, number> = {
      shell_flags: 0,
      capitalization: 0,
      punctuation: 0,
      technical_term: 0,
      code_formatting: 0,
      math_notation: 0,
      custom: 0,
    };

    patterns.forEach(p => {
      categoryBreakdown[p.category]++;
    });

    const autoApplyCount = patterns.filter(p => p.autoApply).length;
    const totalCorrections = patterns.reduce((sum, p) => sum + p.frequency, 0);

    return {
      totalCorrections,
      topPatterns: patterns
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10)
        .map(pattern => ({ pattern, frequency: pattern.frequency })),
      autoApplyRate: patterns.length > 0 ? autoApplyCount / patterns.length : 0,
      manualEditRate: 1 - (patterns.length > 0 ? autoApplyCount / patterns.length : 0),
      categoryBreakdown,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get patterns for GPT prompt (few-shot learning)
   */
  getPatternsForPrompt(limit: number = 10): string[] {
    const patterns = Array.from(this.patterns.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return patterns.map(p => {
      let desc = `"${p.before}" → "${p.after}"`;
      if (p.context) {
        desc += ` (context: ${p.context})`;
      }
      desc += ` [${p.category}, confidence: ${(p.confidence * 100).toFixed(0)}%]`;
      return desc;
    });
  }

  /**
   * Export patterns for sharing
   */
  exportPatterns(includePrivate: boolean = false): string {
    const patterns = Array.from(this.patterns.values())
      .filter(p => includePrivate || p.isShared);

    return JSON.stringify({
      version: '1.0.0',
      exported: Date.now(),
      patterns,
    }, null, 2);
  }

  /**
   * Import patterns from JSON
   */
  async importPatterns(json: string, merge: boolean = true): Promise<number> {
    const data = JSON.parse(json);
    const imported: CorrectionPattern[] = data.patterns || [];

    let count = 0;
    for (const pattern of imported) {
      if (!merge || !this.patterns.has(pattern.id)) {
        this.patterns.set(pattern.id, pattern);
        count++;
      }
    }

    await this.save();
    return count;
  }

  /**
   * Delete a pattern
   */
  async deletePattern(id: string): Promise<boolean> {
    const deleted = this.patterns.delete(id);
    if (deleted) {
      await this.save();
    }
    return deleted;
  }

  /**
   * Clear all patterns
   */
  async clearAll(): Promise<void> {
    this.patterns.clear();
    await this.save();
  }

  /**
   * Update pattern auto-apply setting
   */
  async setAutoApply(id: string, autoApply: boolean): Promise<void> {
    const pattern = this.patterns.get(id);
    if (pattern) {
      pattern.autoApply = autoApply;
      await this.save();
    }
  }

  /**
   * Save database to disk
   */
  private async save(): Promise<void> {
    const data = {
      version: '1.0.0',
      lastSaved: Date.now(),
      patterns: Array.from(this.patterns.values()),
    };

    try {
      // Ensure directory exists
      const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf('/'));
      try {
        await this.app.vault.adapter.mkdir(dir);
      } catch (e) {
        // Directory might already exist
      }

      await this.app.vault.adapter.write(this.dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save correction database:', error);
    }
  }

  /**
   * Find similar pattern
   */
  private findSimilarPattern(before: string, after: string): CorrectionPattern | null {
    for (const pattern of this.patterns.values()) {
      if (pattern.before === before && pattern.after === after) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Cleanup on close
   */
  async destroy(): Promise<void> {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    await this.save();
  }
}

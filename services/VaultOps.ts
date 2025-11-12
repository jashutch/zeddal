// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * VaultOps: Safe vault file operations
 * Architecture: Read/write with Obsidian API and history tracking
 * Status: Phase 2 - Implemented
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { eventBus } from '../utils/EventBus';

export class VaultOps {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Read file content by path
   */
  async read(filePath: string): Promise<string> {
    const normalizedPath = normalizePath(filePath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return await this.app.vault.read(file);
  }

  /**
   * Write file with backup (overwrites existing)
   */
  async write(filePath: string, content: string): Promise<TFile> {
    const normalizedPath = normalizePath(filePath);
    const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (existingFile && existingFile instanceof TFile) {
      // Create backup before overwriting
      const existingContent = await this.app.vault.read(existingFile);
      await this.createBackup(normalizedPath, existingContent);

      // Overwrite existing file
      await this.app.vault.modify(existingFile, content);
      eventBus.emit('file-modified', { path: normalizedPath, content });
      return existingFile;
    } else {
      // Create new file
      return await this.create(normalizedPath, content);
    }
  }

  /**
   * Create new file (ensures parent folders exist)
   */
  async create(filePath: string, content: string): Promise<TFile> {
    const normalizedPath = normalizePath(filePath);

    // Ensure parent folder exists
    const parentPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
    if (parentPath) {
      await this.ensureFolderExists(parentPath);
    }

    // Check if file already exists
    const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (existingFile) {
      throw new Error(`File already exists: ${filePath}`);
    }

    const file = await this.app.vault.create(normalizedPath, content);
    eventBus.emit('file-created', { path: normalizedPath, content });
    return file;
  }

  /**
   * Append to existing file (creates if doesn't exist)
   */
  async append(filePath: string, content: string, separator: string = '\n\n'): Promise<TFile> {
    const normalizedPath = normalizePath(filePath);
    const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (existingFile && existingFile instanceof TFile) {
      // Create backup before modifying
      const existingContent = await this.app.vault.read(existingFile);
      await this.createBackup(normalizedPath, existingContent);

      // Append content
      const newContent = existingContent + separator + content;
      await this.app.vault.modify(existingFile, newContent);
      eventBus.emit('file-modified', { path: normalizedPath, content: newContent });
      return existingFile;
    } else {
      // Create new file
      return await this.create(normalizedPath, content);
    }
  }

  /**
   * Insert at cursor position in active file
   */
  async insertAtCursor(content: string): Promise<void> {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf) {
      throw new Error('No active leaf found');
    }

    const view = activeLeaf.view;
    if (view.getViewType() !== 'markdown') {
      throw new Error('Active view is not a markdown editor');
    }

    // Access the editor through the view state
    const editor = (view as any).editor;
    if (!editor) {
      throw new Error('No editor found in active markdown view');
    }

    const cursor = editor.getCursor();
    editor.replaceRange(content, cursor);
    eventBus.emit('content-inserted', { content, position: cursor });
  }

  /**
   * Get the folder path for the currently active file, if any
   */
  getActiveFolderPath(): string | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return null;
    }

    const path = activeFile.path || '';
    const segments = path.split('/');
    segments.pop(); // remove filename
    const folderPath = segments.join('/');

    return folderPath || null;
  }

  /**
   * Get vault root path
   */
  getVaultRoot(): string {
    const rootPath = this.app.vault.getRoot().path || '';
    if (!rootPath || rootPath === '/' || rootPath === '\\') {
      return '';
    }
    return rootPath;
  }

  /**
   * Create a new daily note or append to existing
   */
  async createOrAppendDailyNote(content: string): Promise<TFile> {
    const dailyNotesFolder = 'Daily Notes'; // TODO: Make this configurable
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const filePath = `${dailyNotesFolder}/${dateStr}.md`;

    return await this.append(filePath, content);
  }

  /**
   * List all markdown files in vault
   */
  async listMarkdownFiles(): Promise<TFile[]> {
    return this.app.vault.getMarkdownFiles();
  }

  /**
   * Search for files by name pattern
   */
  async findFilesByName(pattern: string): Promise<TFile[]> {
    const allFiles = await this.listMarkdownFiles();
    const regex = new RegExp(pattern, 'i');
    return allFiles.filter((file) => regex.test(file.name));
  }

  /**
   * Ensure folder exists (creates if missing)
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);
    const existingFolder = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!existingFolder) {
      await this.app.vault.createFolder(normalizedPath);
    } else if (!(existingFolder instanceof TFolder)) {
      throw new Error(`Path exists but is not a folder: ${folderPath}`);
    }
  }

  /**
   * Create backup with timestamp
   */
  private async createBackup(filePath: string, content: string): Promise<void> {
    const timestamp = Date.now();
    const backupPath = `${filePath}.${timestamp}.bak`;

    try {
      await this.app.vault.adapter.write(backupPath, content);
      eventBus.emit('backup-created', { original: filePath, backup: backupPath });
    } catch (error) {
      console.error('Failed to create backup:', error);
      // Don't throw - backup failure shouldn't block the operation
    }
  }

  /**
   * Get file by path
   */
  getFile(filePath: string): TFile | null {
    const normalizedPath = normalizePath(filePath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    return file instanceof TFile ? file : null;
  }

  /**
   * Check if file exists
   */
  exists(filePath: string): boolean {
    const normalizedPath = normalizePath(filePath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    return file instanceof TFile;
  }
}

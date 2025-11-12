// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { App, Modal, Notice, Setting } from 'obsidian';
import ZeddalPlugin from '../main';
import { ContextLinkService } from '../services/ContextLinkService';

interface LinkCandidate {
  noteTitle: string;
  occurrences: string[];
}

export class LinkInspectorModal extends Modal {
  private candidates: LinkCandidate[] = [];

  constructor(
    app: App,
    private plugin: ZeddalPlugin,
    private contextLinkService: ContextLinkService
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-record-modal');
    contentEl.createEl('h2', { text: 'Zeddal Link Inspector' });

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      contentEl.createEl('p', { text: 'Open a note to inspect contextual links.' });
      return;
    }

    const raw = await this.app.vault.read(activeFile);
    const linked = await this.contextLinkService.applyContextLinks(raw);
    const matches = linked.matches;

    if (!matches) {
      contentEl.createEl('p', { text: 'No link opportunities detected.' });
      return;
    }

    const preview = contentEl.createDiv('zeddal-refined-result');
    preview.createEl('h3', { text: 'Suggested Links:' });
    preview.createEl('p', {
      text: 'Click "Apply" to update the note with these wikilinks. A backup will be created automatically.',
      cls: 'setting-item-description',
    });

    const previewBlock = preview.createEl('pre', {
      text: linked.text,
      cls: 'zeddal-transcription-text',
    });
    previewBlock.style.maxHeight = '260px';
    previewBlock.style.overflow = 'auto';

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Apply to note')
          .setCta()
          .onClick(async () => {
            const existingContent = await this.plugin.app.vault.read(activeFile);
            const backupPath = `${activeFile.path}.${Date.now()}.bak`;
            await this.plugin.app.vault.adapter.write(backupPath, existingContent);
            await this.plugin.app.vault.modify(activeFile, linked.text);
            this.contextLinkService.markDirty();
            new Notice(`Links applied. Backup created at ${backupPath}`);
            this.close();
          })
      )
      .addExtraButton((btn) =>
        btn
          .setIcon('cross')
          .setTooltip('Cancel')
          .onClick(() => this.close())
      );
  }
}

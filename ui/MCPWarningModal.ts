// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { App, Modal } from 'obsidian';

interface MCPWarningModalOptions {
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export class MCPWarningModal extends Modal {
  constructor(app: App, private options: MCPWarningModalOptions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-record-modal');

    contentEl.createEl('h2', { text: 'Enable MCP? Review Security Risks' });
    contentEl.createEl('p', {
      text: 'MCP servers run external code with access to your vault context. Only proceed if you fully trust the servers you configure.',
      cls: 'setting-item-description',
    });

    const list = contentEl.createEl('ul', { cls: 'zeddal-warning-list' });
    list.createEl('li', {
      text: 'External MCP processes can read or write shared data. Never expose API keys, classified notes, or credentials unless absolutely necessary.',
    });
    list.createEl('li', {
      text: 'A compromised MCP server can exfiltrate notes or inject malicious responses into your refinement flow.',
    });
    list.createEl('li', {
      text: 'Run MCP servers in sandboxed environments and audit their source before connecting.',
    });

    contentEl.createEl('p', {
      text: 'If you acknowledge these risks and still want to continue, click “Enable MCP” below.',
      cls: 'setting-item-description',
    });

    const actions = contentEl.createDiv('zeddal-modal-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.options.onCancel?.();
      this.close();
    };

    const confirmBtn = actions.createEl('button', {
      text: 'Enable MCP',
      cls: 'mod-warning',
    });
    confirmBtn.onclick = async () => {
      await this.options.onConfirm();
      this.close();
    };
  }
}

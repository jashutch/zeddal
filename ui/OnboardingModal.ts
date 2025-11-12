// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { App, Modal, Notice, Setting } from 'obsidian';
import ZeddalPlugin from '../main';

export class OnboardingModal extends Modal {
  private plugin: ZeddalPlugin;

  constructor(app: App, plugin: ZeddalPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-record-modal');

    contentEl.createEl('h2', { text: 'Welcome to Zeddal' });
    contentEl.createEl('p', {
      text:
        'To keep your data private and costs under your control, Zeddal requires you to bring your own API key. You can use OpenAI or point to a custom self-hosted endpoint.',
      cls: 'setting-item-description',
    });

    let provider = this.plugin.settings.llmProvider || 'openai';
    let apiKey = this.plugin.settings.openaiApiKey || '';
    let customBase = this.plugin.settings.customApiBase || '';
    let customTranscribe = this.plugin.settings.customTranscriptionUrl || '';

    new Setting(contentEl)
      .setName('Provider')
      .setDesc('Choose OpenAI or a custom OpenAI-compatible endpoint')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('openai', 'OpenAI (api.openai.com)')
          .addOption('custom', 'Custom / Self-hosted')
          .setValue(provider)
          .onChange((value) => {
            provider = value as 'openai' | 'custom';
            customSection.toggleClass('is-hidden', provider !== 'custom');
          });
      });

    new Setting(contentEl)
      .setName('API Key')
      .setDesc('Paste the key issued by your provider. This is stored locally inside Obsidian.')
      .addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(apiKey)
          .onChange((value) => (apiKey = value.trim()))
      );

    const customSection = contentEl.createDiv('zeddal-onboarding-custom');
    if (provider !== 'custom') customSection.addClass('is-hidden');

    new Setting(customSection)
      .setName('Custom API base URL')
      .setDesc('Example: https://my-llm.example.com/v1')
      .addText((text) =>
        text
          .setPlaceholder('https://hosted-llm.example.com/v1')
          .setValue(customBase)
          .onChange((value) => (customBase = value.trim()))
      );

    new Setting(customSection)
      .setName('Custom transcription endpoint')
      .setDesc('If your Whisper server uses a different URL, add it here')
      .addText((text) =>
        text
          .setPlaceholder('https://my-llm.example.com/audio/transcriptions')
          .setValue(customTranscribe)
          .onChange((value) => (customTranscribe = value.trim()))
      );

    const actions = contentEl.createDiv('zeddal-controls');
    const docsLink = actions.createEl('button', { text: 'How to get a key' });
    docsLink.onclick = () => {
      window.open('https://platform.openai.com/account/api-keys', '_blank');
    };

    const saveBtn = actions.createEl('button', {
      text: 'Save & Continue',
      cls: 'mod-cta',
    });
    saveBtn.onclick = async () => {
      if (provider === 'openai' && !apiKey) {
        new Notice('Please provide an API key.');
        return;
      }

      this.plugin.settings.llmProvider = provider;
      this.plugin.settings.openaiApiKey = apiKey;
      this.plugin.settings.customApiBase = customBase;
      this.plugin.settings.customTranscriptionUrl = customTranscribe;
      await this.plugin.saveSettings();
      new Notice('Zeddal is ready. You can adjust these settings later.');
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * Zeddal: Speak your mind
 * Main plugin entry point
 * Architecture: Orchestrates RecorderService, WhisperService, and UI components
 */

import { Plugin, PluginSettingTab, Setting, App, TFile } from 'obsidian';
import { Config, DEFAULT_SETTINGS } from './utils/Config';
import { ZeddalSettings } from './utils/Types';
import { RecorderService } from './services/RecorderService';
import { WhisperService } from './services/WhisperService';
import { LLMRefineService } from './services/LLMRefineService';
import { VaultRAGService } from './services/VaultRAGService';
import { MCPClientService } from './services/MCPClientService';
import { AudioFileService } from './services/AudioFileService';
import { VaultOps } from './services/VaultOps';
import { MicButton } from './ui/MicButton';
import { RecordModal } from './ui/RecordModal';
import { Toast } from './ui/Toast';
import { eventBus } from './utils/EventBus';
import { OnboardingModal } from './ui/OnboardingModal';
import { ContextLinkService } from './services/ContextLinkService';
import { LinkInspectorModal } from './ui/LinkInspectorModal';
import { RecordingHistoryModal } from './ui/RecordingHistoryModal';
import { StatusBar } from './ui/StatusBar';
import { MCPWarningModal } from './ui/MCPWarningModal';

export default class ZeddalPlugin extends Plugin {
  settings: ZeddalSettings;
  toast: Toast; // Public so settings UI can access
  recorderService: RecorderService; // Public for RecordingHistoryModal
  whisperService: WhisperService; // Public for RecordingHistoryModal
  llmRefineService: LLMRefineService; // Public for RecordingHistoryModal
  vaultRAGService: VaultRAGService; // Public for RecordingHistoryModal
  mcpClientService: MCPClientService; // Public for RecordModal
  vaultOps: VaultOps; // Public for RecordingHistoryModal
  contextLinkService: ContextLinkService; // Public for RecordingHistoryModal
  private config: Config;
  private audioFileService: AudioFileService;
  private micButton: MicButton;
  statusBar: StatusBar;

  async onload() {
    console.log('Loading Zeddal plugin...');

    // Load settings
    await this.loadSettings();

    // Initialize config
    this.config = new Config(this.settings);

    // Initialize services
    this.whisperService = new WhisperService(this.config);
    this.recorderService = new RecorderService(this.config);
    this.llmRefineService = new LLMRefineService(this.config);
    this.vaultRAGService = new VaultRAGService(this.app, this.config);
    this.mcpClientService = new MCPClientService(this.config);
    this.audioFileService = new AudioFileService(this.app, this.config);
    this.vaultOps = new VaultOps(this.app);
    this.toast = new Toast();
    this.contextLinkService = new ContextLinkService(this.app);
    this.statusBar = new StatusBar(this.app, () => this.handleStatusBarRecordRequest());

    // Initialize RAG index (async, don't block plugin load)
    this.initializeRAGIndex();

    // Initialize MCP connections (async, don't block plugin load)
    this.initializeMCP();

    // Setup vault file listeners for incremental RAG updates
    this.setupVaultListeners();

    // Setup drag-and-drop handler for audio files
    this.setupAudioFileDropHandler();

    // Initialize UI
    this.micButton = new MicButton(
      this,
      this.recorderService,
      this.whisperService,
      this.llmRefineService,
      this.vaultOps,
      this.toast,
      this.contextLinkService,
      this.vaultRAGService,
      this.audioFileService
    );
    this.micButton.addToRibbon();

    // Add command
    this.addCommand({
      id: 'start-recording',
      name: 'Start voice recording',
      callback: () => {
        // Trigger the same action as ribbon button
        this.micButton.startRecording(new MouseEvent('click'));
      },
    });

    this.addCommand({
      id: 'link-inspector',
      name: 'Zeddal: Inspect contextual links in current note',
      callback: () => {
        const modal = new LinkInspectorModal(this.app, this, this.contextLinkService);
        modal.open();
      },
    });

    this.addCommand({
      id: 'recording-history',
      name: 'Zeddal: Browse recording history',
      callback: () => {
        const modal = new RecordingHistoryModal(
          this.app,
          this,
          this.audioFileService,
          this.toast
        );
        modal.open();
      },
    });

    // Register file menu for audio files
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && this.audioFileService.isAudioFile(file.path)) {
          menu.addItem((item) => {
            item
              .setTitle('🎙️ Re-process with Zeddal')
              .setIcon('microphone')
              .onClick(async () => {
                await this.reprocessAudioFile(file.path);
              });
          });
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new ZeddalSettingTab(this.app, this));

    // Setup global error handler
    this.setupErrorHandling();

    // Show onboarding if user hasn't set credentials
    this.showOnboardingIfNeeded();

    console.log('Zeddal plugin loaded successfully');
  }

  async onunload() {
    console.log('Unloading Zeddal plugin...');

    // Cleanup services
    if (this.recorderService) {
      this.recorderService.stop();
    }

    // Disconnect MCP clients
    if (this.mcpClientService) {
      await this.mcpClientService.disconnect();
    }

    // Cleanup UI
    if (this.micButton) {
      this.micButton.remove();
    }

    if (this.toast) {
      this.toast.destroy();
    }

    if (this.statusBar) {
      this.statusBar.destroy();
    }

    // Clear event bus
    eventBus.clear();

    console.log('Zeddal plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.config.update(this.settings);

    // Update services with new settings
    if (this.whisperService) {
      this.whisperService.updateApiKey(this.settings.openaiApiKey);
    }
  }

  private setupErrorHandling() {
    eventBus.on('error', (event) => {
      const { message, error } = event.data;
      console.error('Zeddal error:', message, error);
      this.toast.error(message);
    });
  }

  private showOnboardingIfNeeded(): void {
    if (!this.settings.openaiApiKey || !this.settings.openaiApiKey.trim()) {
      const modal = new OnboardingModal(this.app, this);
      modal.open();
    }
  }

  private handleStatusBarRecordRequest(): void {
    if (!this.micButton) {
      console.warn('Status bar record requested before mic button initialized');
      this.toast?.warning?.('Recorder not ready yet');
      return;
    }
    this.micButton.startRecording();
  }

  /**
   * Initialize RAG index in background
   */
  private async initializeRAGIndex(): Promise<void> {
    if (!this.settings.enableRAG) {
      console.log('RAG is disabled in settings');
      return;
    }

    try {
      console.log('Building RAG index...');
      await this.vaultRAGService.buildIndex();
      const stats = this.vaultRAGService.getStats();
      console.log(
        `RAG index ready: ${stats.totalChunks} chunks from ${stats.totalFiles} files`
      );
    } catch (error) {
      console.error('Failed to build RAG index:', error);
      this.toast.error('Failed to initialize RAG: ' + error.message);
    }
  }

  /**
   * Initialize MCP client connections
   * Non-blocking - failures won't prevent plugin from working
   */
  private async initializeMCP(): Promise<void> {
    if (!this.settings.enableMCP) {
      console.log('MCP is disabled in settings');
      return;
    }

    try {
      console.log('Initializing MCP connections...');
      await this.mcpClientService.initialize();
      const status = this.mcpClientService.getStatus();
      const connectedServers = status.filter(s => s.connected);
      if (connectedServers.length > 0) {
        console.log(
          `MCP ready: Connected to ${connectedServers.length} server(s)`
        );
      } else {
        console.log('MCP: No servers connected');
      }
    } catch (error) {
      console.error('Failed to initialize MCP:', error);
      // Don't show toast error - MCP is optional enhancement
      // Plugin should continue working without it
    }
  }

  /**
   * Setup vault listeners for incremental RAG updates
   */
  private setupVaultListeners(): void {
    if (!this.settings.enableRAG) {
      return;
    }

    // Update index when files are modified
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultRAGService.updateFile(file);
        }
      })
    );

    // Update index when files are created
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultRAGService.updateFile(file);
        }
      })
    );

    // Remove from index when files are deleted
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultRAGService.removeFile(file.path);
        }
      })
    );

    // Rebuild index when files are renamed (remove old, add new)
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.vaultRAGService.removeFile(oldPath);
          await this.vaultRAGService.updateFile(file);
        }
      })
    );
  }

  /**
   * Setup drag-and-drop handler for audio files
   * Allows users to drag audio files into Obsidian and process them
   */
  private setupAudioFileDropHandler(): void {
    this.registerDomEvent(document, 'drop', async (evt: DragEvent) => {
      // Check if files were dropped
      if (!evt.dataTransfer?.files || evt.dataTransfer.files.length === 0) {
        return;
      }

      // Check if any dropped files are audio files
      const files = Array.from(evt.dataTransfer.files);
      const audioFiles = files.filter(file => {
        const name = file.name.toLowerCase();
        return name.endsWith('.webm') ||
               name.endsWith('.mp3') ||
               name.endsWith('.wav') ||
               name.endsWith('.m4a') ||
               name.endsWith('.ogg');
      });

      // If no audio files, let Obsidian handle the drop normally
      if (audioFiles.length === 0) {
        return;
      }

      // Prevent default drop behavior for audio files
      evt.preventDefault();
      evt.stopPropagation();

      // Process the first audio file
      const audioFile = audioFiles[0];

      try {
        // Check API key
        if (!this.whisperService.isReady()) {
          this.toast.warning('Please configure OpenAI API key in settings');
          return;
        }

        // Show toast for multiple files
        if (audioFiles.length > 1) {
          this.toast.warning(`Processing first audio file: ${audioFile.name}`);
        }

        // Save the dropped audio file to the recordings folder
        this.toast.info(`Importing audio file: ${audioFile.name}`);

        // Convert File to Blob
        const blob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });

        // Create AudioChunk
        const audioChunk = {
          blob,
          timestamp: Date.now(),
          duration: 0, // We don't know duration from drag-and-drop
        };

        // Save to recordings folder
        const savedAudioFile = await this.audioFileService.saveRecording(audioChunk);

        // Open RecordModal with existing audio file
        const modal = new RecordModal(
          this.app,
          this.recorderService,
          this.whisperService,
          this.llmRefineService,
          this.vaultOps,
          this.toast,
          this,
          this.contextLinkService,
          this.vaultRAGService,
          this.mcpClientService,
          this.audioFileService,
          savedAudioFile  // Pass existing audio file
        );
        modal.open();

        this.toast.success('Audio file imported successfully');
      } catch (error) {
        console.error('Failed to process dropped audio file:', error);
        this.toast.error('Failed to import audio file: ' + error.message);
      }
    });

    console.log('Audio file drag-and-drop handler registered');
  }

  /**
   * Re-process an existing audio file from the vault
   * Used by file menu context menu and commands
   */
  async reprocessAudioFile(filePath: string): Promise<void> {
    try {
      // Check API key
      if (!this.whisperService.isReady()) {
        this.toast.warning('Please configure OpenAI API key in settings');
        return;
      }

      // Check if file is an audio file
      if (!this.audioFileService.isAudioFile(filePath)) {
        this.toast.error('Selected file is not a supported audio format');
        return;
      }

      this.toast.info('Loading audio file...');

      // Load the audio file and metadata
      const audioChunk = await this.audioFileService.loadRecording(filePath);
      const metadata = await this.audioFileService.loadMetadata(filePath);

      // Create SavedAudioFile object
      const savedAudioFile = metadata || {
        filePath,
        timestamp: audioChunk.timestamp,
        duration: audioChunk.duration,
        mimeType: audioChunk.blob.type,
        size: audioChunk.blob.size,
      };

      // Open RecordModal with existing audio file
      const modal = new RecordModal(
        this.app,
        this.recorderService,
        this.whisperService,
        this.llmRefineService,
        this.vaultOps,
        this.toast,
        this,
        this.contextLinkService,
        this.vaultRAGService,
        this.mcpClientService,
        this.audioFileService,
        savedAudioFile
      );
      modal.open();

      this.toast.success('Audio file loaded for re-processing');
    } catch (error) {
      console.error('Failed to re-process audio file:', error);
      this.toast.error('Failed to load audio file: ' + error.message);
    }
  }
}

/**
 * Settings tab for Zeddal configuration
 */
class ZeddalSettingTab extends PluginSettingTab {
  plugin: ZeddalPlugin;

  constructor(app: App, plugin: ZeddalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Zeddal Settings' });
    containerEl.createEl('p', {
      text: 'Configure OpenAI API access for voice transcription and refinement.',
      cls: 'setting-item-description',
    });

    // OpenAI API Key
    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Your OpenAI API key for Whisper and GPT-4 access')
      .addText((text) =>
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose OpenAI or a custom OpenAI-compatible endpoint')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('openai', 'OpenAI (api.openai.com)')
          .addOption('custom', 'Custom / Self-hosted')
          .setValue(this.plugin.settings.llmProvider)
          .onChange(async (value) => {
            this.plugin.settings.llmProvider = value as 'openai' | 'custom';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Custom API base URL')
      .setDesc('Required if provider is set to custom (e.g., https://my-llm.example.com/v1)')
      .addText((text) =>
        text
          .setPlaceholder('https://my-llm.example.com/v1')
          .setValue(this.plugin.settings.customApiBase || '')
          .onChange(async (value) => {
            this.plugin.settings.customApiBase = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Custom transcription endpoint')
      .setDesc('Optional override if your Whisper endpoint differs from /audio/transcriptions')
      .addText((text) =>
        text
          .setPlaceholder('https://my-llm.example.com/audio/transcriptions')
          .setValue(this.plugin.settings.customTranscriptionUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.customTranscriptionUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // OpenAI Model
    new Setting(containerEl)
      .setName('GPT Model')
      .setDesc('Model for note refinement')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('gpt-4-turbo', 'GPT-4 Turbo')
          .addOption('gpt-4', 'GPT-4')
          .addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
          .setValue(this.plugin.settings.openaiModel)
          .onChange(async (value) => {
            this.plugin.settings.openaiModel = value;
            await this.plugin.saveSettings();
          })
      );

    // Whisper Model
    new Setting(containerEl)
      .setName('Whisper Model')
      .setDesc('Model for audio transcription')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('whisper-1', 'Whisper-1')
          .setValue(this.plugin.settings.whisperModel)
          .onChange(async (value) => {
            this.plugin.settings.whisperModel = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Recording Settings' });

    // Silence Threshold
    new Setting(containerEl)
      .setName('Silence Threshold')
      .setDesc('RMS level below which audio is considered silent (0.0-1.0)')
      .addSlider((slider) =>
        slider
          .setLimits(0, 0.1, 0.001)
          .setValue(this.plugin.settings.silenceThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.silenceThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    // Silence Duration
    new Setting(containerEl)
      .setName('Silence Duration')
      .setDesc('Milliseconds of silence before auto-pause')
      .addSlider((slider) =>
        slider
          .setLimits(500, 5000, 100)
          .setValue(this.plugin.settings.silenceDuration)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.silenceDuration = value;
            await this.plugin.saveSettings();
          })
      );

    // Recordings Path
    new Setting(containerEl)
      .setName('Recordings Path')
      .setDesc('Folder path where raw audio recordings will be saved (e.g., Voice Notes/Recordings)')
      .addText((text) =>
        text
          .setPlaceholder('Voice Notes/Recordings')
          .setValue(this.plugin.settings.recordingsPath)
          .onChange(async (value) => {
            this.plugin.settings.recordingsPath = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Merge Settings' });

    // Auto-merge Threshold
    new Setting(containerEl)
      .setName('Auto-merge Threshold')
      .setDesc('Similarity threshold for automatic note merging (0.0-1.0)')
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 1.0, 0.05)
          .setValue(this.plugin.settings.autoMergeThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.autoMergeThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Note Insertion Settings' });

    // Auto-refine with GPT-4
    new Setting(containerEl)
      .setName('Auto-refine with GPT-4')
      .setDesc('Automatically refine transcriptions with GPT-4 before saving')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoRefine)
          .onChange(async (value) => {
            this.plugin.settings.autoRefine = value;
            await this.plugin.saveSettings();
          })
      );

    // Auto-save raw transcript
    new Setting(containerEl)
      .setName('Auto-save raw transcript')
      .setDesc('Automatically save the unedited transcript before refinement (ideal for evidentiary use)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSaveRaw)
          .onChange(async (value) => {
            this.plugin.settings.autoSaveRaw = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Contextual auto-linking')
      .setDesc('Automatically scan your vault for matching notes and insert wikilinks inside summaries')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoContextLinks)
          .onChange(async (value) => {
            this.plugin.settings.autoContextLinks = value;
            await this.plugin.saveSettings();
          })
      );

    // Default save location
    new Setting(containerEl)
      .setName('Default Save Location')
      .setDesc('Where to save voice notes by default')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('ask', 'Ask each time')
          .addOption('new-note', 'New note in folder')
          .addOption('daily-note', 'Append to daily note')
          .addOption('cursor', 'Insert at cursor')
          .setValue(this.plugin.settings.defaultSaveLocation)
          .onChange(async (value: any) => {
            this.plugin.settings.defaultSaveLocation = value;
            await this.plugin.saveSettings();
          })
      );

    // Voice notes folder
    new Setting(containerEl)
      .setName('Voice Notes Folder')
      .setDesc('Folder for saving new voice notes')
      .addText((text) =>
        text
          .setPlaceholder('Voice Notes')
          .setValue(this.plugin.settings.voiceNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.voiceNotesFolder = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'RAG Settings (Retrieval-Augmented Generation)' });
    containerEl.createEl('p', {
      text: 'Use vault context to inform GPT-4 refinement style and tone. Requires embedding generation (~$0.13 one-time cost for 1000 notes).',
      cls: 'setting-item-description',
    });

    // Enable RAG
    new Setting(containerEl)
      .setName('Enable RAG')
      .setDesc('Use vector embeddings to provide vault context during refinement')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableRAG).onChange(async (value) => {
          this.plugin.settings.enableRAG = value;
          await this.plugin.saveSettings();
        })
      );

    // Custom Embedding URL
    new Setting(containerEl)
      .setName('Custom embedding endpoint')
      .setDesc(
        'Optional: URL for local/self-hosted embedding server (e.g., for DOD/DOJ walled infrastructure). Leave blank to use OpenAI.'
      )
      .addText((text) =>
        text
          .setPlaceholder('https://my-embedding-server.example.com/embeddings')
          .setValue(this.plugin.settings.customEmbeddingUrl || '')
          .onChange(async (value) => {
            this.plugin.settings.customEmbeddingUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // RAG Top-K
    new Setting(containerEl)
      .setName('Context chunks')
      .setDesc('Number of similar vault chunks to retrieve (1-10)')
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.ragTopK)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.ragTopK = value;
            await this.plugin.saveSettings();
          })
      );

    // RAG rebuild button
    new Setting(containerEl)
      .setName('Rebuild RAG index')
      .setDesc('Force rebuild of the vector index (use after changing embedding settings)')
      .addButton((button) =>
        button
          .setButtonText('Rebuild Index')
          .onClick(async () => {
            button.setButtonText('Building...');
            button.setDisabled(true);
            try {
              // Access vaultRAGService through plugin instance
              await (this.plugin as any).vaultRAGService.buildIndex(true);
              const stats = (this.plugin as any).vaultRAGService.getStats();
              button.setButtonText('Rebuild Index');
              button.setDisabled(false);
              this.plugin.toast.success(
                `Index rebuilt: ${stats.totalChunks} chunks from ${stats.totalFiles} files`
              );
            } catch (error) {
              button.setButtonText('Rebuild Index');
              button.setDisabled(false);
              this.plugin.toast.error('Failed to rebuild index: ' + error.message);
            }
          })
      );

    containerEl.createEl('h3', { text: 'MCP Settings (Model Context Protocol)' });
    containerEl.createEl('p', {
      text: 'Connect to external MCP servers to fetch additional context during refinement. MCP provides access to external data sources, APIs, and services.',
      cls: 'setting-item-description',
    });

    // Enable MCP
    new Setting(containerEl)
      .setName('Enable MCP')
      .setDesc('Enable Model Context Protocol integration for external context retrieval')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableMCP).onChange(async (value) => {
          if (value) {
            toggle.setValue(false);
            const modal = new MCPWarningModal(this.app, {
              onConfirm: async () => {
                toggle.setValue(true);
                await this.applyMCPSetting(true);
                this.display();
              },
              onCancel: () => {
                this.plugin.toast.info('MCP remains disabled until you accept the security notice.');
              },
            });
            modal.open();
          } else {
            await this.applyMCPSetting(false);
            toggle.setValue(false);
            this.display();
          }
        })
      );

    // Only show server management if MCP is enabled
    if (this.plugin.settings.enableMCP) {
      containerEl.createEl('h4', { text: 'MCP Servers' });

      // Display existing servers
      if (this.plugin.settings.mcpServers.length === 0) {
        containerEl.createEl('p', {
          text: 'No MCP servers configured. Add a server below to get started.',
          cls: 'setting-item-description',
        });
      } else {
        this.plugin.settings.mcpServers.forEach((server, index) => {
          const serverSetting = new Setting(containerEl)
            .setName(server.name)
            .setDesc(`Command: ${server.command}${server.args ? ' ' + server.args.join(' ') : ''}`)
            .addToggle((toggle) =>
              toggle.setValue(server.enabled).onChange(async (value) => {
                this.plugin.settings.mcpServers[index].enabled = value;
                await this.plugin.saveSettings();
                await this.plugin.mcpClientService.reconnect();
                this.plugin.toast.info(
                  value ? `Server "${server.name}" enabled` : `Server "${server.name}" disabled`
                );
              })
            )
            .addButton((button) =>
              button
                .setButtonText('Remove')
                .setWarning()
                .onClick(async () => {
                  this.plugin.settings.mcpServers.splice(index, 1);
                  await this.plugin.saveSettings();
                  await this.plugin.mcpClientService.reconnect();
                  this.plugin.toast.info(`Server "${server.name}" removed`);
                  this.display();
                })
            );
        });
      }

      // Add new server section
      containerEl.createEl('h4', { text: 'Add New MCP Server' });

      let newServerName = '';
      let newServerCommand = '';
      let newServerArgs = '';
      let newServerEnv = '';

      new Setting(containerEl)
        .setName('Server Name')
        .setDesc('Display name for this server')
        .addText((text) =>
          text
            .setPlaceholder('My MCP Server')
            .onChange((value) => {
              newServerName = value;
            })
        );

      new Setting(containerEl)
        .setName('Command')
        .setDesc('Command to run the MCP server (e.g., "npx", "python", "/path/to/server")')
        .addText((text) =>
          text
            .setPlaceholder('npx')
            .onChange((value) => {
              newServerCommand = value;
            })
        );

      new Setting(containerEl)
        .setName('Arguments')
        .setDesc('Space-separated command arguments (e.g., "-r @modelcontextprotocol/server-everything")')
        .addText((text) =>
          text
            .setPlaceholder('-r @modelcontextprotocol/server-everything')
            .onChange((value) => {
              newServerArgs = value;
            })
        );

      new Setting(containerEl)
        .setName('Environment Variables')
        .setDesc('Optional: JSON object of environment variables (e.g., {"API_KEY": "xyz"})')
        .addTextArea((text) => {
          text
            .setPlaceholder('{"API_KEY": "your-key"}')
            .onChange((value) => {
              newServerEnv = value;
            });
          text.inputEl.rows = 3;
        });

      new Setting(containerEl)
        .setName('Add Server')
        .addButton((button) =>
          button
            .setButtonText('Add MCP Server')
            .setCta()
            .onClick(async () => {
              if (!newServerName || !newServerCommand) {
                this.plugin.toast.warning('Server name and command are required');
                return;
              }

              // Parse args
              const args = newServerArgs
                .split(' ')
                .map((arg) => arg.trim())
                .filter((arg) => arg.length > 0);

              // Parse env
              let env: Record<string, string> = {};
              if (newServerEnv) {
                try {
                  env = JSON.parse(newServerEnv);
                } catch (error) {
                  this.plugin.toast.error('Invalid JSON for environment variables');
                  return;
                }
              }

              // Add new server
              const newServer = {
                id: `mcp-${Date.now()}`,
                name: newServerName,
                command: newServerCommand,
                args: args.length > 0 ? args : undefined,
                env: Object.keys(env).length > 0 ? env : undefined,
                enabled: true,
              };

              this.plugin.settings.mcpServers.push(newServer);
              await this.plugin.saveSettings();
              await this.plugin.mcpClientService.reconnect();
              this.plugin.toast.success(`MCP server "${newServerName}" added`);
              this.display();
            })
        );

      // Connection status
      containerEl.createEl('h4', { text: 'Connection Status' });
      const statusContainer = containerEl.createDiv();
      const status = this.plugin.mcpClientService.getStatus();

      if (status.length === 0) {
        statusContainer.createEl('p', {
          text: 'No servers configured',
          cls: 'setting-item-description',
        });
      } else {
        status.forEach((server) => {
          const statusEl = statusContainer.createDiv();
          statusEl.style.padding = '8px 12px';
          statusEl.style.marginBottom = '8px';
          statusEl.style.borderRadius = '4px';
          statusEl.style.backgroundColor = server.connected
            ? 'rgba(61, 213, 152, 0.12)'
            : 'rgba(167, 169, 172, 0.12)';

          const statusText = statusEl.createEl('span');
          statusText.style.color = server.connected ? '#3dd598' : 'var(--text-muted)';
          statusText.textContent = `${server.connected ? '✓' : '✗'} ${server.serverName}: ${
            server.connected ? 'Connected' : 'Disconnected'
          }`;
        });
      }
    }
  }

  private async applyMCPSetting(value: boolean): Promise<void> {
    this.plugin.settings.enableMCP = value;
    await this.plugin.saveSettings();

    if (value) {
      await this.plugin.mcpClientService.initialize();
      this.plugin.toast.success('MCP enabled - connecting to servers...');
    } else {
      await this.plugin.mcpClientService.disconnect();
      this.plugin.toast.info('MCP disabled');
    }
  }
}

/**
 * RecordModal: Recording interface with live progress
 * Architecture: Modal showing confidence %, duration, pause/resume/stop controls
 */

import { Modal, App } from 'obsidian';
import { RecorderService } from '../services/RecorderService';
import { WhisperService } from '../services/WhisperService';
import { LLMRefineService } from '../services/LLMRefineService';
import { VaultRAGService } from '../services/VaultRAGService';
import { MCPClientService } from '../services/MCPClientService';
import { AudioFileService } from '../services/AudioFileService';
import { VaultOps } from '../services/VaultOps';
import { eventBus } from '../utils/EventBus';
import { RecordingState, AudioChunk, RefinedNote, ZeddalSettings, SavedAudioFile } from '../utils/Types';
import { Toast } from './Toast';
import { VoiceCommandProcessor } from '../utils/VoiceCommandProcessor';
import { LinkResolver } from '../utils/LinkResolver';
import ZeddalPlugin from '../main';
import { ContextLinkService } from '../services/ContextLinkService';
import { mapConfidenceToStatus } from '../utils/ConfidenceStatus';
import { TelemetrySnapshot } from '../services/RecordingTelemetry';
import { StatusBar } from './StatusBar';

export class RecordModal extends Modal {
  private recorderService: RecorderService;
  private whisperService: WhisperService;
  private llmRefineService: LLMRefineService;
  private vaultRAGService: VaultRAGService;
  private mcpClientService: MCPClientService;
  private audioFileService: AudioFileService;
  private vaultOps: VaultOps;
  private toast: Toast;
  private isRecording = false;
  private isProcessing = false; // Prevent duplicate transcription
  private unsubscribers: Array<() => void> = []; // Track event unsubscribers
  private currentTranscription: string = '';

  // UI Elements
  private statusEl: HTMLElement;
  private confidenceEl: HTMLElement;
  private speakingEl: HTMLElement;
  private recordingEl: HTMLElement;
  private progressBar: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private updateInterval: number | null = null;
  private equalizerBars: HTMLElement[] = [];
  private equalizerContainer: HTMLElement | null = null;
  private equalizerWrapper: HTMLElement | null = null;
  private linkCount = 0;
  private lastUpdated: Date | null = null;
  private lastTelemetrySnapshot: TelemetrySnapshot = {
    speakingTimeMs: 0,
    totalRecordingTimeMs: 0,
  };
  private savedAudioFile: SavedAudioFile | null = null;
  private audioPlayer: HTMLAudioElement | null = null;

  constructor(
    app: App,
    recorderService: RecorderService,
    whisperService: WhisperService,
    llmRefineService: LLMRefineService,
    vaultOps: VaultOps,
    toast: Toast,
    private plugin: ZeddalPlugin,
    private contextLinkService: ContextLinkService,
    vaultRAGService: VaultRAGService,
    mcpClientService: MCPClientService,
    audioFileService: AudioFileService,
    savedAudioFile?: SavedAudioFile
  ) {
    super(app);
    this.recorderService = recorderService;
    this.whisperService = whisperService;
    this.llmRefineService = llmRefineService;
    this.vaultRAGService = vaultRAGService;
    this.mcpClientService = mcpClientService;
    this.audioFileService = audioFileService;
    this.vaultOps = vaultOps;
    this.toast = toast;
    this.savedAudioFile = savedAudioFile || null;
  }

  onOpen(): void {
    // If opening with existing audio file (drag-and-drop scenario),
    // skip recording and go directly to transcription
    if (this.savedAudioFile) {
      this.renderTranscriptionUI();
      this.processExistingAudio();
    } else {
      this.renderRecordingUI();
      this.setupEventListeners();
      this.startRecording();
    }
  }

  onClose(): void {
    this.cleanup();
    this.teardownEventListeners();
    this.statusBar()?.setState('idle', 'Ready');
  }

  /**
   * Start recording
   */
  private async startRecording(): Promise<void> {
    try {
      await this.recorderService.start();
      this.isRecording = true;
      this.startUIUpdates();
      this.lastUpdated = new Date();
      this.statusBar()?.setState('listening', 'Listening…');
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.toast.error('Failed to access microphone');
      this.close();
    }
  }

  /**
   * Stop recording and transcribe
   */
  private stopRecording(): void {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.recorderService.stop();
    this.statusEl.textContent = 'Processing...';
    this.pauseBtn.disabled = true;
    this.stopBtn.disabled = true;
    this.setEqualizerPaused(true);
    this.statusBar()?.setState('processing', 'Processing…');
  }

  /**
   * Toggle pause/resume
   */
  private togglePause(): void {
    const state = this.recorderService.getState();

    if (state.isPaused) {
      this.recorderService.resume();
      this.pauseBtn.textContent = 'Pause';
      this.statusEl.innerHTML =
        '<span class="zeddal-recording-pulse"></span> Recording...';
      this.setEqualizerPaused(false);
    } else {
      this.recorderService.pause();
      this.pauseBtn.textContent = 'Resume';
      this.statusEl.textContent = '⏸ Paused';
      this.setEqualizerPaused(true);
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for recording stopped
    const unsubStop = eventBus.on('recording-stopped', async (event) => {
      if (this.isProcessing) {
        console.log('Already processing, ignoring duplicate event');
        return;
      }
      this.isProcessing = true;
      const { audioChunk } = event.data as { audioChunk: AudioChunk };
      await this.handleTranscription(audioChunk);
    });
    this.unsubscribers.push(unsubStop);

    // Listen for errors
    const unsubError = eventBus.on('error', (event) => {
      console.error('Recording error:', event.data);
      this.toast.error(event.data.message || 'An error occurred');
      this.close();
    });
    this.unsubscribers.push(unsubError);

  }

  /**
   * Handle transcription of recorded audio
   */
  private async handleTranscription(audioChunk: AudioChunk): Promise<void> {
    try {
      const fileSizeMB = (audioChunk.blob.size / (1024 * 1024)).toFixed(1);
      const durationSec = Math.floor(audioChunk.duration / 1000);
      this.statusEl.textContent = `Transcribing audio (${fileSizeMB} MB, ~${durationSec}s)...`;

      if (!this.whisperService.isReady()) {
        throw new Error('Whisper service not configured. Please add OpenAI API key.');
      }

      this.statusBar()?.setState('processing', 'Processing…');

      const transcription = await this.whisperService.transcribe(audioChunk);

      // Process voice commands (convert "zeddal link word" to [[word]])
      const processedText = VoiceCommandProcessor.process(transcription.text);
      const resolvedText = await LinkResolver.resolveExistingNotes(
        processedText,
        this.vaultOps,
        { autoLinkFirstMatch: true }
      );
      const contextLinked = this.pluginSettings().autoContextLinks
        ? await this.contextLinkService.applyContextLinks(resolvedText)
        : { text: resolvedText, matches: 0 };
      this.currentTranscription = contextLinked.text;
      this.linkCount = this.countLinks(this.currentTranscription);
      this.statusBar()?.setLinkCount(this.linkCount);

      console.log('Transcription result:', transcription);
      console.log('Processed text:', processedText);

      // Show command preview if voice commands detected
      if (VoiceCommandProcessor.hasVoiceCommands(transcription.text)) {
        const commands = VoiceCommandProcessor.previewCommands(transcription.text);
        console.log('Voice commands detected:', commands);
        this.toast.info(`Detected ${commands.length} link command(s)`);
      }

      // Display transcription result in modal
      if (this.statusEl) {
        this.statusEl.textContent = '✓ Transcription Complete';
        if (this.statusEl.style) {
          this.statusEl.style.color = 'var(--text-accent)';
        }
      }

      // Show the transcription text in the modal
      const resultContainer = this.contentEl.createDiv('zeddal-result');
      resultContainer.createEl('h3', { text: 'Transcription:' });
      const textEl = resultContainer.createEl('p', {
        text: this.currentTranscription || transcription.text || '(no speech detected)',
        cls: 'zeddal-transcription-text'
      });
      textEl.style.whiteSpace = 'pre-wrap';
      textEl.style.padding = '12px';
      textEl.style.backgroundColor = 'var(--background-secondary)';
      textEl.style.borderRadius = '6px';
      textEl.style.marginTop = '12px';
      this.renderLinkSummary(resultContainer, this.linkCount, 'Links detected');

      // Replace the control buttons with new actions (only if they exist from recording UI)
      if (this.pauseBtn) {
        this.pauseBtn.style.display = 'none';
      }
      if (this.stopBtn) {
        this.stopBtn.remove();
      }
      this.destroyEqualizer();

      const actionsContainer = this.contentEl.createDiv('zeddal-actions');
      actionsContainer.style.display = 'flex';
      actionsContainer.style.gap = '8px';
      actionsContainer.style.marginTop = '16px';

      // Play Recording button (if audio was saved)
      if (this.savedAudioFile) {
        const playBtn = actionsContainer.createEl('button', {
          text: '▶ Play Recording',
          cls: 'mod-cta'
        });
        playBtn.onclick = () => this.playAudio();
      }

      // Copy button
      const copyBtn = actionsContainer.createEl('button', {
        text: 'Copy',
        cls: 'mod-cta'
      });
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(this.currentTranscription);
        this.toast.success('Copied to clipboard!');
      };

      // Save as-is button
      const saveRawBtn = actionsContainer.createEl('button', {
        text: 'Save Raw Copy',
        cls: 'mod-cta'
      });
      saveRawBtn.onclick = () => this.quickSaveRawCopy();

      if (this.pluginSettings().autoSaveRaw) {
        await this.autoSaveRawTranscript();
      }

      // Refine & Save button
      const refineBtn = actionsContainer.createEl('button', {
        text: 'Refine & Save',
        cls: 'mod-cta'
      });
      refineBtn.onclick = () => this.showSaveOptions(true);

      const rerecordBtn = actionsContainer.createEl('button', {
        text: 'Re-record',
        cls: 'mod-warning'
      });
      rerecordBtn.onclick = () => this.restartRecordingSession();

      // Close button
      const closeBtn = actionsContainer.createEl('button', {
        text: 'Close',
      });
      closeBtn.onclick = () => this.close();

      this.lastUpdated = new Date();
      this.statusBar()?.setState('saved', 'Saved successfully');
      setTimeout(() => this.statusBar()?.setState('idle', 'Ready'), 4000);

      this.toast.success('Transcription complete!');
    } catch (error) {
      console.error('Transcription failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error details:', errorMessage);
      this.toast.error(`Transcription failed: ${errorMessage}`);
      this.close();
    }
  }

  /**
   * Show save location options
   */
  private async showSaveOptions(refine: boolean): Promise<void> {
    // Clear existing UI
    this.contentEl.empty();
    this.contentEl.addClass('zeddal-save-modal');
    this.destroyEqualizer();

    const title = this.contentEl.createEl('h2', {
      text: refine ? 'Refining & Saving...' : 'Choose Save Location'
    });

    let noteToSave = this.currentTranscription;
    let noteTitle = '';

    // If refining, show progress
    if (refine) {
      this.statusEl = this.contentEl.createDiv('zeddal-status');

      // Retrieve RAG context if enabled
      let ragContext: string[] = [];
      let ragFolders: string[] = [];
      if (this.pluginSettings().enableRAG) {
        this.statusEl.textContent = '🔍 Analyzing vault context...';
        try {
          ragContext = await this.vaultRAGService.retrieveContext(this.currentTranscription);
          if (ragContext.length > 0) {
            // Extract folder names from context for display
            ragFolders = ragContext.map(ctx => {
              const match = ctx.match(/From "(.+)":/);
              if (match) {
                const path = match[1];
                return path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'Root';
              }
              return 'Unknown';
            });
            const uniqueFolders = [...new Set(ragFolders)];
            this.statusEl.textContent = `✓ Found ${ragContext.length} similar notes in: ${uniqueFolders.join(', ')}`;
            await new Promise(resolve => setTimeout(resolve, 1200)); // Brief pause to show status
          } else {
            this.statusEl.textContent = 'ℹ️ No similar notes found (using general refinement)';
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        } catch (error) {
          console.error('RAG context retrieval failed:', error);
          // Continue without context on error
        }
      }

      // Retrieve MCP context if enabled
      let mcpContext: string[] = [];
      if (this.pluginSettings().enableMCP && this.mcpClientService.isReady()) {
        this.statusEl.textContent = '🔌 Fetching MCP context...';
        try {
          const mcpContexts = await this.mcpClientService.retrieveContext(this.currentTranscription);
          if (mcpContexts.length > 0) {
            // Convert MCP contexts to string format
            mcpContext = mcpContexts.flatMap(ctx =>
              ctx.resources.map(resource =>
                `From MCP server "${ctx.serverName}" (${resource.name}):\n${resource.content}`
              )
            );
            const serverNames = mcpContexts.map(ctx => ctx.serverName).join(', ');
            const totalResources = mcpContexts.reduce((sum, ctx) => sum + ctx.resources.length, 0);
            this.statusEl.textContent = `✓ Retrieved ${totalResources} resource(s) from ${mcpContexts.length} MCP server(s): ${serverNames}`;
            await new Promise(resolve => setTimeout(resolve, 1200));
          }
        } catch (error) {
          console.error('MCP context retrieval failed:', error);
          // Continue without MCP - don't block refinement
        }
      }

      // Combine RAG and MCP context
      const combinedContext = [...ragContext, ...mcpContext];

      this.statusEl.textContent = '✨ Refining with GPT-4 (Step 1/2: Analyzing)...';

      try {
        // Show progress during refinement
        setTimeout(() => {
          if (this.statusEl) {
            this.statusEl.textContent = '✨ Refining with GPT-4 (Step 2/2: Generating)...';
          }
        }, 1500);

        const refined = await this.llmRefineService.refine(this.currentTranscription, combinedContext);
        noteToSave = await LinkResolver.resolveExistingNotes(refined.body, this.vaultOps, {
          autoLinkFirstMatch: true,
        });
        noteTitle = refined.title;

        const wordCount = noteToSave.split(/\s+/).length;
        const contextSummary = `${ragContext.length} RAG + ${mcpContext.length} MCP chunks`;
        this.statusEl.textContent = `✓ Refinement complete (${wordCount} words, ${contextSummary} used)`;
        this.statusEl.style.color = 'var(--text-accent)';

        // Show refined result
        const refinedContainer = this.contentEl.createDiv('zeddal-refined-result');
        refinedContainer.createEl('h3', { text: 'Refined Note:' });
        const refinedText = refinedContainer.createEl('p', {
          text: noteToSave,
          cls: 'zeddal-transcription-text'
        });
        refinedText.style.whiteSpace = 'pre-wrap';
        refinedText.style.padding = '12px';
        refinedText.style.backgroundColor = 'var(--background-secondary)';
        refinedText.style.borderRadius = '6px';
        refinedText.style.marginBottom = '16px';
        refinedText.style.maxHeight = '300px';
        refinedText.style.overflow = 'auto';
        const refinedLinkCount = this.countLinks(noteToSave);
        this.renderLinkSummary(refinedContainer, refinedLinkCount, 'Links ready to save');
      } catch (error) {
        console.error('Refinement failed:', error);
        this.toast.error('Refinement failed. Saving raw transcription instead.');
        noteToSave = this.currentTranscription;
      }

      title.textContent = 'Choose Save Location';
    }

    // Title input section
    const titleSection = this.contentEl.createDiv('zeddal-title-section');
    titleSection.style.marginBottom = '16px';

    const titleLabel = titleSection.createEl('label', {
      text: 'Note Title (for new notes):',
      cls: 'zeddal-title-label'
    });
    titleLabel.style.display = 'block';
    titleLabel.style.marginBottom = '8px';
    titleLabel.style.fontWeight = '500';

    const titleInput = titleSection.createEl('input', {
      type: 'text',
      placeholder: 'Enter custom title or leave blank for auto-generated',
      value: noteTitle,
      cls: 'zeddal-title-input'
    });
    titleInput.style.width = '100%';
    titleInput.style.padding = '8px 12px';
    titleInput.style.border = '1px solid var(--background-modifier-border)';
    titleInput.style.borderRadius = '4px';
    titleInput.style.backgroundColor = 'var(--background-primary)';
    titleInput.style.color = 'var(--text-normal)';
    titleInput.style.fontSize = '14px';

    // Allow Enter key to save as new note
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const customTitle = titleInput.value.trim();
        this.saveAsNewNote(noteToSave, customTitle || noteTitle);
      }
    });

    // Save location options
    const optionsContainer = this.contentEl.createDiv('zeddal-save-options');

    const newNoteBtn = optionsContainer.createEl('button', {
      text: 'New Note',
      cls: 'mod-cta'
    });
    newNoteBtn.onclick = () => {
      const customTitle = titleInput.value.trim();
      this.saveAsNewNote(noteToSave, customTitle || noteTitle);
    };

    const dailyNoteBtn = optionsContainer.createEl('button', {
      text: 'Append to Daily Note',
      cls: 'mod-cta'
    });
    dailyNoteBtn.onclick = () => this.appendToDailyNote(noteToSave);

    const cursorBtn = optionsContainer.createEl('button', {
      text: 'Insert at Cursor',
      cls: 'mod-cta'
    });
    cursorBtn.onclick = () => this.insertAtCursor(noteToSave);

    const cancelBtn = optionsContainer.createEl('button', {
      text: 'Cancel'
    });
    cancelBtn.onclick = () => this.close();

    // Focus the title input for easy editing
    setTimeout(() => titleInput.focus(), 100);
  }

  /**
   * Save as new note
   */
  private async saveAsNewNote(content: string, title?: string): Promise<void> {
    try {
      // Sanitize filename by removing invalid characters
      let fileName = title || `Voice Note ${new Date().toISOString().split('T')[0]}`;
      fileName = this.sanitizeFileName(fileName);

      const folderPath = await this.determineTargetFolder(content);
      const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
      const contentWithMeta = this.appendTelemetryMetadata(content);

      await this.vaultOps.create(filePath, contentWithMeta);
      this.contextLinkService.markDirty();
      this.statusBar()?.flagRawSaved();

      // Enhanced success message showing folder location
      const folderDisplay = folderPath || 'Root';
      this.toast.success(`✓ Created note in ${folderDisplay}/`);
      this.close();
    } catch (error) {
      console.error('Failed to create note:', error);
      if (error instanceof Error && error.message.includes('already exists')) {
        // Try with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `Voice Note ${timestamp}`;
        const folderPath = await this.determineTargetFolder(content);
        const filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;
        await this.vaultOps.create(filePath, this.appendTelemetryMetadata(content));
        this.contextLinkService.markDirty();
        this.toast.success(`Created note: ${fileName}`);
        this.close();
      } else {
        this.toast.error('Failed to create note');
      }
    }
  }

  /**
   * Sanitize filename by removing invalid characters
   */
  private sanitizeFileName(fileName: string): string {
    // Remove or replace invalid characters: \ / : * ? " < > |
    return fileName
      .replace(/[\\/:*?"<>|]/g, '-')  // Replace invalid chars with dash
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .replace(/^\.+/, '')             // Remove leading dots
      .trim();
  }

  /**
   * Append to daily note
   */
  private async appendToDailyNote(content: string): Promise<void> {
    try {
      await this.vaultOps.createOrAppendDailyNote(this.appendTelemetryMetadata(content));
      this.contextLinkService.markDirty();
      this.toast.success('Appended to daily note');
      this.close();
    } catch (error) {
      console.error('Failed to append to daily note:', error);
      this.toast.error('Failed to append to daily note');
    }
  }

  /**
   * Insert at cursor position
   */
  private async insertAtCursor(content: string): Promise<void> {
    try {
      await this.vaultOps.insertAtCursor(this.appendTelemetryMetadata(content));
      this.contextLinkService.markDirty();
      this.toast.success('Inserted at cursor');
      this.close();
    } catch (error) {
      console.error('Failed to insert at cursor:', error);
      this.toast.error('Failed to insert at cursor. Is a note open?');
    }
  }

  /**
   * Start UI updates
   */
  private startUIUpdates(): void {
    this.updateInterval = window.setInterval(() => {
      if (!this.isRecording) return;

      const state = this.recorderService.getState();
      this.updateUI(state);
    }, 100); // Update every 100ms for smooth progress
  }

  /**
   * Update UI with current state
   */
  private updateUI(state: RecordingState): void {
    // Update trust status display and subtle progress cues
    this.renderConfidenceStatus(state.confidence);
    const confidencePercent = Math.round(state.confidence * 100);
    this.progressBar.style.width = `${confidencePercent}%`;
    if (confidencePercent > 70) {
      this.progressBar.style.backgroundColor = 'var(--text-accent)';
    } else if (confidencePercent > 40) {
      this.progressBar.style.backgroundColor = 'var(--text-warning)';
    } else {
      this.progressBar.style.backgroundColor = 'var(--text-error)';
    }

    // Update telemetry displays
    const telemetry = this.recorderService.getTelemetrySnapshot();
    this.lastTelemetrySnapshot = telemetry;
    this.speakingEl.textContent = this.formatSeconds(telemetry.speakingTimeMs);
    this.recordingEl.textContent = this.formatSeconds(telemetry.totalRecordingTimeMs);
    this.statusBar()?.updateTelemetry(telemetry);

    this.updateEqualizer(state.confidence);
  }

  /**
   * Cleanup on close
   */
  private cleanup(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.isRecording) {
      this.recorderService.stop();
    }

    this.destroyEqualizer();
  }

  /**
   * Create the live equalizer visualization
   */
  private createEqualizer(parent: HTMLElement): void {
    this.equalizerWrapper = parent.createDiv('zeddal-eq-wrapper');
    const wrapper = this.equalizerWrapper;
    const label = wrapper.createEl('div', { text: 'Live capture', cls: 'zeddal-eq-label' });
    label.setAttr('aria-hidden', 'true');

    this.equalizerContainer = wrapper.createDiv('zeddal-equalizer');
    this.equalizerBars = [];

    for (let i = 0; i < 14; i++) {
      const bar = this.equalizerContainer.createDiv('zeddal-equalizer-bar');
      bar.style.height = `${10 + i % 4 * 5}%`;
      this.equalizerBars.push(bar);
    }
  }

  /**
   * Destroy equalizer DOM references
   */
  private destroyEqualizer(): void {
    this.equalizerBars = [];
    if (this.equalizerWrapper) {
      this.equalizerWrapper.remove();
      this.equalizerWrapper = null;
    }
    if (this.equalizerContainer) {
      this.equalizerContainer.remove();
      this.equalizerContainer = null;
    }
  }

  /**
   * Update equalizer bars based on confidence level
   */
  private updateEqualizer(level: number): void {
    if (!this.equalizerContainer || this.equalizerBars.length === 0) return;
    if (this.equalizerContainer.classList.contains('is-paused')) return;

    const clamped = Math.max(0, Math.min(1, level));

    this.equalizerBars.forEach((bar, index) => {
      const noise = (Math.sin(Date.now() / 180 + index) + 1) / 2;
      const variance = 0.35 + noise * 0.65;
      const height = Math.max(10, Math.min(96, (clamped * 90 * variance) + 8));
      bar.style.height = `${height}%`;
      bar.style.opacity = `${0.35 + clamped * 0.65}`;
    });
  }

  /**
   * Set equalizer paused state
   */
  private setEqualizerPaused(paused: boolean): void {
    if (!this.equalizerContainer) return;
    this.equalizerContainer.classList.toggle('is-paused', paused);
    if (paused) {
      this.equalizerBars.forEach((bar, idx) => {
        bar.style.height = `${10 + (idx % 3) * 4}%`;
      });
    }
  }

  /**
   * Determine best folder location for a new note
   * Uses RAG-based semantic similarity to find the folder with most related content
   */
  private async determineTargetFolder(content: string): Promise<string | null> {
    // Use RAG to find semantically similar notes
    try {
      const similarContexts = await this.vaultRAGService.retrieveContext(content);

      if (similarContexts.length > 0) {
        // Extract folder paths from similar notes
        const folderCounts = new Map<string, number>();

        for (const context of similarContexts) {
          // Extract file path from context (format: 'From "path/to/file.md":\n...')
          const pathMatch = context.match(/From "(.+)":/);
          if (pathMatch) {
            const filePath = pathMatch[1];
            // Get folder path (everything before the last /)
            const folderPath = filePath.includes('/')
              ? filePath.substring(0, filePath.lastIndexOf('/'))
              : '';

            // Count occurrences of each folder
            const count = folderCounts.get(folderPath) || 0;
            folderCounts.set(folderPath, count + 1);
          }
        }

        // Find folder with most similar content
        let maxCount = 0;
        let bestFolder: string | null = null;

        for (const [folder, count] of folderCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            bestFolder = folder;
          }
        }

        if (bestFolder !== null) {
          console.log(`RAG determined best folder: "${bestFolder}" with ${maxCount} similar notes`);
          return bestFolder || null; // Return null if root folder (empty string)
        }
      }
    } catch (error) {
      console.error('Failed to determine folder using RAG:', error);
    }

    // Fallback: try LinkResolver
    const contextualFolder = await LinkResolver.suggestFolderForContent(
      this.currentTranscription || content,
      this.vaultOps
    );

    if (contextualFolder) {
      return contextualFolder;
    }

    // Fallback: use active folder if available
    const activeFolder = this.vaultOps.getActiveFolderPath();
    if (activeFolder) {
      return activeFolder;
    }

    // Final fallback: voice notes folder from settings
    return this.plugin.settings.voiceNotesFolder || null;
  }

  /**
   * Render the core recording UI shell
   */
  private renderRecordingUI(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.removeClass('zeddal-save-modal');
    contentEl.addClass('zeddal-record-modal');

    const title = contentEl.createEl('h2', { text: 'Zeddal Recording' });
    title.addClass('zeddal-modal-title');

    this.statusEl = contentEl.createDiv('zeddal-status');
    this.statusEl.innerHTML = '<span class="zeddal-recording-pulse"></span> Recording...';

    this.createEqualizer(contentEl);

    const progressContainer = contentEl.createDiv('zeddal-progress-container');
    this.progressBar = progressContainer.createDiv('zeddal-progress-bar');

    const metricsContainer = contentEl.createDiv('zeddal-metrics');

    const speakingContainer = metricsContainer.createDiv('zeddal-metric');
    speakingContainer.createEl('label', { text: 'Speaking (s)' });
    this.speakingEl = speakingContainer.createEl('span', {
      text: '0.00s',
      cls: 'zeddal-metric-value',
    });

    const recordedContainer = metricsContainer.createDiv('zeddal-metric');
    recordedContainer.createEl('label', { text: 'Recorded (s)' });
    this.recordingEl = recordedContainer.createEl('span', {
      text: '0.00s',
      cls: 'zeddal-metric-value',
    });

    const confidenceContainer = metricsContainer.createDiv('zeddal-metric');
    confidenceContainer.createEl('label', { text: 'Audio clarity' });
    this.confidenceEl = confidenceContainer.createDiv('zeddal-confidence-status');

    const controls = contentEl.createDiv('zeddal-controls');

    this.pauseBtn = controls.createEl('button', {
      text: 'Pause',
      cls: 'mod-cta',
    });
    this.pauseBtn.onclick = () => this.togglePause();

    this.stopBtn = controls.createEl('button', {
      text: 'Stop & Transcribe',
      cls: 'mod-warning',
    });
    this.stopBtn.onclick = () => this.stopRecording();

  }

  /**
   * Render minimal UI for existing audio transcription
   */
  private renderTranscriptionUI(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-modal');

    contentEl.createEl('h2', { text: 'Process Audio Recording' });

    this.statusEl = contentEl.createDiv('zeddal-status');
    this.statusEl.textContent = 'Loading audio...';
  }

  /**
   * Process existing audio file (drag-and-drop scenario)
   */
  private async processExistingAudio(): Promise<void> {
    if (!this.savedAudioFile) {
      this.toast.error('No audio file provided');
      this.close();
      return;
    }

    try {
      // Load audio chunk from file
      const audioChunk = await this.audioFileService.loadRecording(this.savedAudioFile.filePath);

      // Process transcription
      await this.handleTranscription(audioChunk);
    } catch (error) {
      console.error('Failed to process existing audio:', error);
      this.toast.error('Failed to process audio file');
      this.close();
    }
  }

  /**
   * Play audio recording
   */
  private async playAudio(): Promise<void> {
    if (!this.savedAudioFile) {
      this.toast.error('No audio file available');
      return;
    }

    try {
      // Cleanup existing player if any
      if (this.audioPlayer) {
        this.audioPlayer.pause();
        this.audioPlayer.remove();
        this.audioPlayer = null;
      }

      // Load audio file
      const audioChunk = await this.audioFileService.loadRecording(this.savedAudioFile.filePath);
      const audioUrl = URL.createObjectURL(audioChunk.blob);

      // Create audio player
      this.audioPlayer = new Audio(audioUrl);
      this.audioPlayer.controls = true;
      this.audioPlayer.style.width = '100%';
      this.audioPlayer.style.marginTop = '12px';

      // Add to modal
      const audioContainer = this.contentEl.querySelector('.zeddal-result');
      if (audioContainer) {
        audioContainer.appendChild(this.audioPlayer);
      } else {
        this.contentEl.appendChild(this.audioPlayer);
      }

      // Play audio
      await this.audioPlayer.play();
      this.toast.success('Playing recording');

      // Cleanup URL when done
      this.audioPlayer.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
    } catch (error) {
      console.error('Failed to play audio:', error);
      this.toast.error('Failed to play recording');
    }
  }

  /**
   * Teardown event listeners
   */
  private teardownEventListeners(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];

    // Cleanup audio player
    if (this.audioPlayer) {
      this.audioPlayer.pause();
      this.audioPlayer.remove();
      this.audioPlayer = null;
    }
  }

  /**
   * Restart the recording session
   */
  private async restartRecordingSession(): Promise<void> {
    this.cleanup();
    this.teardownEventListeners();
    this.destroyEqualizer();
    this.isProcessing = false;
    this.isRecording = false;
    this.currentTranscription = '';
    this.linkCount = 0;
    this.renderRecordingUI();
    this.setupEventListeners();
    try {
      await this.startRecording();
      this.toast.info('Ready for a new take');
    } catch (error) {
      console.error('Failed to restart recording:', error);
      this.toast.error('Unable to restart recording session');
      this.close();
    }
  }

  /**
   * Render link summary magic-moment indicator
   */
  private renderLinkSummary(container: HTMLElement, count: number, label: string): void {
    const summary = container.createDiv('zeddal-link-summary');
    summary.textContent =
      count > 0 ? `✨ ${label}: ${count} ${count === 1 ? 'link' : 'links'}` : `✨ ${label}: none yet`;
  }

  /**
   * Count wikilinks in given text
   */
  private countLinks(text: string): number {
    if (!text) return 0;
    const matches = text.match(/\[\[[^\]]+\]\]/g);
    return matches ? matches.length : 0;
  }

  private async autoSaveRawTranscript(): Promise<void> {
    await this.writeRawFile(this.currentTranscription, true);
  }

  private async quickSaveRawCopy(): Promise<void> {
    await this.writeRawFile(this.currentTranscription, false);
  }

  private async writeRawFile(content: string, silent = false): Promise<void> {
    if (!content?.trim()) return;

    try {
      const title = this.generateRawTitle(content);
      const heading = `# ${title}\n\n`;
      const body = this.appendTelemetryMetadata(heading + content);
      const timestamp = new Date().toLocaleString();
      let fileName = this.sanitizeFileName(`RAW - ${title} - ${timestamp}`);

      const folderPath = await this.determineTargetFolder(content);
      let filePath = folderPath ? `${folderPath}/${fileName}.md` : `${fileName}.md`;

      try {
        await this.vaultOps.create(filePath, body);
      } catch (error) {
        const fallback = `${fileName}-${Date.now()}`;
        filePath = folderPath ? `${folderPath}/${fallback}.md` : `${fallback}.md`;
        await this.vaultOps.create(filePath, body);
      }

      this.contextLinkService.markDirty();
      if (!silent) {
        this.toast.info(`Raw note saved: ${fileName}`);
      }
    } catch (error) {
      console.error('Raw save failed:', error);
      if (!silent) {
        this.toast.error('Unable to save raw note');
      }
    }
  }

  private generateRawTitle(content: string): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    if (!clean) {
      const date = new Date();
      return `Voice Note ${date.toLocaleDateString()}`;
    }

    const sentence = clean.split(/(?<=[.!?])\s+/)[0] || clean;
    const snippet = sentence.substring(0, 60).trim();
    return snippet || `Voice Note ${new Date().toLocaleDateString()}`;
  }

  private pluginSettings(): ZeddalSettings {
    return this.plugin?.settings || ({} as ZeddalSettings);
  }

  private renderConfidenceStatus(score: number): void {
    if (!this.confidenceEl) return;
    const status = mapConfidenceToStatus(score);
    const timestamp = this.lastUpdated
      ? this.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    this.confidenceEl.empty();

    const row = this.confidenceEl.createDiv({ cls: 'zeddal-status-row' });
    row.createSpan({ text: 'Audio clarity: ', cls: 'zeddal-status-label' });
    row.createSpan({
      text: status.label,
      cls: `zeddal-status-chip zeddal-status-${status.color}`,
    });

    const helpIcon = row.createSpan({ text: ' ⓘ', cls: 'zeddal-status-help' });
    helpIcon.setAttr('title', `${status.helpText}\nConfidence: ${(score * 100).toFixed(1)}%`);

    if (timestamp) {
      const ts = this.confidenceEl.createDiv({ cls: 'zeddal-status-timestamp' });
      ts.textContent = `Last updated: ${timestamp}`;
    }
  }

  private appendTelemetryMetadata(content: string): string {
    const speaking = this.formatSeconds(this.lastTelemetrySnapshot.speakingTimeMs);
    const recorded = this.formatSeconds(this.lastTelemetrySnapshot.totalRecordingTimeMs);
    const meta = `> Transcription meta\n> Speaking: ${speaking}\n> Recorded: ${recorded}`;
    const trimmed = content.trimEnd();
    return `${trimmed}\n\n${meta}`;
  }

  private formatSeconds(ms: number): string {
    const seconds = Math.max(0, ms / 1000);
    return `${seconds.toFixed(2)}s`;
  }

  private statusBar(): StatusBar | null {
    return this.plugin?.statusBar ?? null;
  }
}

// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * RecordingHistoryModal: Browse and manage saved audio recordings
 * Architecture: List view with search, playback, and re-processing
 */

import { Modal, App, Setting } from 'obsidian';
import { AudioFileService } from '../services/AudioFileService';
import { SavedAudioFile } from '../utils/Types';
import { Toast } from './Toast';
import ZeddalPlugin from '../main';
import { RecordModal } from './RecordModal';

export class RecordingHistoryModal extends Modal {
  private audioFileService: AudioFileService;
  private toast: Toast;
  private plugin: ZeddalPlugin;
  private recordings: SavedAudioFile[] = [];
  private filteredRecordings: SavedAudioFile[] = [];
  private searchQuery: string = '';
  private currentAudioPlayer: HTMLAudioElement | null = null;

  constructor(app: App, plugin: ZeddalPlugin, audioFileService: AudioFileService, toast: Toast) {
    super(app);
    this.plugin = plugin;
    this.audioFileService = audioFileService;
    this.toast = toast;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('zeddal-history-modal');

    // Title
    const titleContainer = contentEl.createDiv('zeddal-history-header');
    titleContainer.createEl('h2', { text: 'Recording History' });

    // Search bar
    const searchContainer = contentEl.createDiv('zeddal-history-search');
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: '🔍 Search recordings...',
    });
    searchInput.addClass('zeddal-history-search-input');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.filterAndRenderRecordings();
    });

    // Loading indicator
    const loadingEl = contentEl.createDiv('zeddal-history-loading');
    loadingEl.setText('Loading recordings...');

    try {
      // Load recordings
      this.recordings = await this.audioFileService.listRecordings();
      this.filteredRecordings = [...this.recordings];

      // Remove loading indicator
      loadingEl.remove();

      // Render recordings
      this.renderRecordings(contentEl);

      // Action buttons
      this.renderActions(contentEl);
    } catch (error) {
      console.error('Failed to load recordings:', error);
      loadingEl.setText('Failed to load recordings');
      this.toast.error('Failed to load recording history');
    }
  }

  onClose(): void {
    // Stop any playing audio
    if (this.currentAudioPlayer) {
      this.currentAudioPlayer.pause();
      this.currentAudioPlayer.remove();
      this.currentAudioPlayer = null;
    }

    const { contentEl } = this;
    contentEl.empty();
  }

  private filterAndRenderRecordings(): void {
    // Filter recordings based on search query
    if (this.searchQuery.trim() === '') {
      this.filteredRecordings = [...this.recordings];
    } else {
      this.filteredRecordings = this.recordings.filter(recording => {
        const fileName = recording.filePath.toLowerCase();
        const transcription = (recording.transcription || '').toLowerCase();
        return fileName.includes(this.searchQuery) || transcription.includes(this.searchQuery);
      });
    }

    // Re-render the list
    const listContainer = this.contentEl.querySelector('.zeddal-history-list');
    if (listContainer) {
      listContainer.remove();
    }

    this.renderRecordings(this.contentEl);
  }

  private renderRecordings(container: HTMLElement): void {
    const listContainer = container.createDiv('zeddal-history-list');

    if (this.filteredRecordings.length === 0) {
      const emptyState = listContainer.createDiv('zeddal-history-empty');
      emptyState.createEl('p', {
        text: this.searchQuery
          ? 'No recordings match your search'
          : 'No recordings found. Start recording to see your history!'
      });
      return;
    }

    // Group recordings by date
    const grouped = this.groupRecordingsByDate(this.filteredRecordings);

    for (const [dateLabel, recordings] of Object.entries(grouped)) {
      // Date header
      const dateHeader = listContainer.createDiv('zeddal-history-date-header');
      dateHeader.createEl('h3', { text: dateLabel });

      // Recording items
      for (const recording of recordings) {
        this.renderRecordingItem(listContainer, recording);
      }
    }
  }

  private renderRecordingItem(container: HTMLElement, recording: SavedAudioFile): void {
    const item = container.createDiv('zeddal-history-item');

    // Icon and info
    const infoContainer = item.createDiv('zeddal-history-item-info');
    infoContainer.createEl('span', { text: '🎙️', cls: 'zeddal-history-item-icon' });

    const details = infoContainer.createDiv('zeddal-history-item-details');

    // File name (without extension and path)
    const fileName = recording.filePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Recording';
    details.createEl('div', { text: fileName, cls: 'zeddal-history-item-title' });

    // Metadata
    const metadata = details.createDiv('zeddal-history-item-metadata');
    const durationText = this.formatDuration(recording.duration);
    const sizeText = this.formatFileSize(recording.size);
    const folder = recording.filePath.includes('/')
      ? recording.filePath.substring(0, recording.filePath.lastIndexOf('/'))
      : 'Root';

    metadata.createEl('span', { text: `${durationText} • ${sizeText} • ${folder}` });

    // Actions
    const actions = item.createDiv('zeddal-history-item-actions');

    // Play button
    const playBtn = actions.createEl('button', {
      text: '▶ Play',
      cls: 'mod-cta',
    });
    playBtn.addEventListener('click', () => this.playRecording(recording, playBtn));

    // Re-process button
    const reprocessBtn = actions.createEl('button', {
      text: '📝 Re-process',
    });
    reprocessBtn.addEventListener('click', () => this.reprocessRecording(recording));

    // Delete button
    const deleteBtn = actions.createEl('button', {
      text: '🗑️ Delete',
      cls: 'mod-warning',
    });
    deleteBtn.addEventListener('click', () => this.deleteRecording(recording, item));
  }

  private async playRecording(recording: SavedAudioFile, button: HTMLButtonElement): Promise<void> {
    try {
      // Stop any currently playing audio
      if (this.currentAudioPlayer) {
        this.currentAudioPlayer.pause();
        this.currentAudioPlayer.remove();
        this.currentAudioPlayer = null;
      }

      // Load and play audio
      const audioChunk = await this.audioFileService.loadRecording(recording.filePath);
      const audioUrl = URL.createObjectURL(audioChunk.blob);

      this.currentAudioPlayer = new Audio(audioUrl);
      this.currentAudioPlayer.addEventListener('ended', () => {
        URL.revokeObjectURL(audioUrl);
        button.setText('▶ Play');
      });

      button.setText('⏸ Playing...');
      await this.currentAudioPlayer.play();

    } catch (error) {
      console.error('Failed to play recording:', error);
      this.toast.error('Failed to play recording');
      button.setText('▶ Play');
    }
  }

  private async reprocessRecording(recording: SavedAudioFile): Promise<void> {
    try {
      this.toast.info('Opening recording for re-processing...');

      // Close history modal
      this.close();

      // Open RecordModal with existing audio file
      const modal = new RecordModal(
        this.app,
        this.plugin.recorderService,
        this.plugin.whisperService,
        this.plugin.llmRefineService,
        this.plugin.vaultOps,
        this.toast,
        this.plugin,
        this.plugin.contextLinkService,
        this.plugin.vaultRAGService,
        this.plugin.mcpClientService,
        this.audioFileService,
        this.plugin.qaSessionService,
        this.plugin.transcriptFormatter,
        this.plugin.correctionDb,
        this.plugin.unifiedRefinement,
        recording  // Pass the saved audio file
      );
      modal.open();

    } catch (error) {
      console.error('Failed to re-process recording:', error);
      this.toast.error('Failed to open recording');
    }
  }

  private async deleteRecording(recording: SavedAudioFile, itemEl: HTMLElement): Promise<void> {
    const confirmed = confirm(`Delete recording "${recording.filePath.split('/').pop()}"?\n\nThis cannot be undone.`);

    if (!confirmed) {
      return;
    }

    try {
      await this.audioFileService.deleteRecording(recording.filePath);

      // Remove from list
      this.recordings = this.recordings.filter(r => r.filePath !== recording.filePath);
      this.filteredRecordings = this.filteredRecordings.filter(r => r.filePath !== recording.filePath);

      // Remove from UI
      itemEl.remove();

      this.toast.success('Recording deleted');

      // Show empty state if no recordings left
      if (this.filteredRecordings.length === 0) {
        const listContainer = this.contentEl.querySelector('.zeddal-history-list');
        if (listContainer) {
          listContainer.remove();
        }
        this.renderRecordings(this.contentEl);
      }

    } catch (error) {
      console.error('Failed to delete recording:', error);
      this.toast.error('Failed to delete recording');
    }
  }

  private renderActions(container: HTMLElement): void {
    const actionsContainer = container.createDiv('zeddal-history-actions');

    const importBtn = actionsContainer.createEl('button', {
      text: '📂 Import Audio File',
      cls: 'mod-cta',
    });
    importBtn.addEventListener('click', () => {
      this.toast.info('Drag and drop audio files into Obsidian to import them');
      this.close();
    });

    const closeBtn = actionsContainer.createEl('button', {
      text: 'Close',
    });
    closeBtn.addEventListener('click', () => this.close());
  }

  private groupRecordingsByDate(recordings: SavedAudioFile[]): Record<string, SavedAudioFile[]> {
    const groups: Record<string, SavedAudioFile[]> = {
      'Today': [],
      'Yesterday': [],
      'This Week': [],
      'This Month': [],
      'Older': [],
    };

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const oneWeekMs = 7 * oneDayMs;
    const oneMonthMs = 30 * oneDayMs;

    for (const recording of recordings) {
      const age = now - recording.timestamp;

      if (age < oneDayMs) {
        groups['Today'].push(recording);
      } else if (age < 2 * oneDayMs) {
        groups['Yesterday'].push(recording);
      } else if (age < oneWeekMs) {
        groups['This Week'].push(recording);
      } else if (age < oneMonthMs) {
        groups['This Month'].push(recording);
      } else {
        groups['Older'].push(recording);
      }
    }

    // Remove empty groups
    for (const key of Object.keys(groups)) {
      if (groups[key].length === 0) {
        delete groups[key];
      }
    }

    return groups;
  }

  private formatDuration(ms: number): string {
    if (ms === 0) return 'Unknown';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) {
      return `${remainingSeconds}s`;
    }

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }
}

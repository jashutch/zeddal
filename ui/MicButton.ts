// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * MicButton: Ribbon icon to trigger recording modal
 * Architecture: Simple toggle for RecordModal with visual feedback
 */

import { Plugin } from 'obsidian';
import ZeddalPlugin from '../main';
import { RecordModal } from './RecordModal';
import { RecorderService } from '../services/RecorderService';
import { WhisperService } from '../services/WhisperService';
import { LLMRefineService } from '../services/LLMRefineService';
import { VaultRAGService } from '../services/VaultRAGService';
import { AudioFileService } from '../services/AudioFileService';
import { VaultOps } from '../services/VaultOps';
import { Toast } from './Toast';
import { ContextLinkService } from '../services/ContextLinkService';

export class MicButton {
  private plugin: ZeddalPlugin;
  private recorderService: RecorderService;
  private whisperService: WhisperService;
  private llmRefineService: LLMRefineService;
  private vaultRAGService: VaultRAGService;
  private audioFileService: AudioFileService;
  private vaultOps: VaultOps;
  private toast: Toast;
  private contextLinkService: ContextLinkService;
  private ribbonIcon: HTMLElement | null = null;

  constructor(
    plugin: ZeddalPlugin,
    recorderService: RecorderService,
    whisperService: WhisperService,
    llmRefineService: LLMRefineService,
    vaultOps: VaultOps,
    toast: Toast,
    contextLinkService: ContextLinkService,
    vaultRAGService: VaultRAGService,
    audioFileService: AudioFileService
  ) {
    this.plugin = plugin;
    this.recorderService = recorderService;
    this.whisperService = whisperService;
    this.llmRefineService = llmRefineService;
    this.vaultOps = vaultOps;
    this.toast = toast;
    this.contextLinkService = contextLinkService;
    this.vaultRAGService = vaultRAGService;
    this.audioFileService = audioFileService;
  }

  /**
   * Add microphone button to ribbon
   */
  addToRibbon(): void {
    this.ribbonIcon = this.plugin.addRibbonIcon(
      'microphone',
      'Zeddal: Record voice note',
      (evt: MouseEvent) => {
        this.startRecording(evt);
      }
    );

    this.ribbonIcon.addClass('zeddal-ribbon-icon');
  }

  /**
   * Handle button click
   */
  startRecording(evt?: MouseEvent): void {
    // Check if Whisper service is configured
    if (!this.whisperService.isReady()) {
      this.toast.warning('Please configure OpenAI API key in settings');
      return;
    }

    // Open recording modal
    const modal = new RecordModal(
      this.plugin.app,
      this.recorderService,
      this.whisperService,
      this.llmRefineService,
      this.vaultOps,
      this.toast,
      this.plugin,
      this.contextLinkService,
      this.vaultRAGService,
      this.plugin.mcpClientService,
      this.audioFileService
    );
    modal.open();
  }

  /**
   * Remove button from ribbon
   */
  remove(): void {
    if (this.ribbonIcon) {
      this.ribbonIcon.remove();
      this.ribbonIcon = null;
    }
  }

  /**
   * Update button state (for future use)
   */
  setActive(active: boolean): void {
    if (this.ribbonIcon) {
      if (active) {
        this.ribbonIcon.addClass('zeddal-ribbon-active');
      } else {
        this.ribbonIcon.removeClass('zeddal-ribbon-active');
      }
    }
  }
}

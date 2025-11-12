import { App } from 'obsidian';
import { eventBus } from '../utils/EventBus';
import { TelemetrySnapshot } from '../services/RecordingTelemetry';

export type StatusBarState = 'idle' | 'listening' | 'processing' | 'saved' | 'error';

export class StatusBar {
  private container: HTMLElement;
  private topRow: HTMLElement;
  private stateDot: HTMLElement;
  private stateText: HTMLElement;
  private metricsText: HTMLElement;
  private badgesContainer: HTMLElement;
  private recordButton: HTMLButtonElement;
  private telemetrySnapshot: TelemetrySnapshot = {
    speakingTimeMs: 0,
    totalRecordingTimeMs: 0,
  };
  private currentState: StatusBarState = 'idle';
  private lastLinkCount = 0;
  private lastRawSaved = false;
  private isRecording = false;
  private dragState = {
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
  };

  constructor(private app: App, private onRecordRequest?: () => void) {
    this.container = createDiv({ cls: 'zeddal-status-bar' });
    this.topRow = this.container.createDiv({ cls: 'zeddal-status-top' });
    this.stateDot = this.topRow.createDiv({ cls: 'zeddal-status-dot' });
    this.stateText = this.topRow.createSpan({ cls: 'zeddal-status-text', text: 'Ready' });
    this.recordButton = this.topRow.createEl('button', {
      cls: 'zeddal-status-record',
      text: '● Record',
    });
    this.metricsText = this.container.createSpan({ cls: 'zeddal-status-metrics', text: '' });
    this.badgesContainer = this.container.createDiv({ cls: 'zeddal-status-badges' });

    const root = document.body.querySelector('.modals-container') || document.body;
    root.appendChild(this.container);

    this.registerListeners();
    this.render();
    this.enableDragging();
    this.registerButtonHandlers();
    this.resetRecordButton();
  }

  destroy(): void {
    this.container?.removeEventListener('pointerdown', this.handlePointerDown);
    this.detachGlobalDragListeners();
    this.container?.remove();
  }

  updateTelemetry(snapshot: TelemetrySnapshot): void {
    this.telemetrySnapshot = snapshot;
    this.renderMetrics();
  }

  setLinkCount(count: number): void {
    this.lastLinkCount = count;
    this.renderBadges();
  }

  flagRawSaved(): void {
    this.lastRawSaved = true;
    this.renderBadges();
    setTimeout(() => {
      this.lastRawSaved = false;
      this.renderBadges();
    }, 4000);
  }

  setState(state: StatusBarState, message?: string): void {
    this.currentState = state;
    if (message) {
      this.stateText.textContent = message;
    }
    this.renderState();
  }

  private registerListeners(): void {
    eventBus.on('recording-started', () => {
      this.isRecording = true;
      this.setState('listening', 'Listening…');
      this.updateRecordButton('Recording…', true);
    });

    eventBus.on('recording-paused', () => {
      this.setState('idle', 'Paused');
      this.updateRecordButton('Resume in modal', true);
    });

    eventBus.on('recording-resumed', () => {
      this.setState('listening', 'Listening…');
      this.updateRecordButton('Recording…', true);
    });

    eventBus.on('recording-stopped', () => {
      this.isRecording = false;
      this.setState('processing', 'Processing…');
      this.updateRecordButton('Processing…', true);
    });

    eventBus.on('refined', () => {
      this.setState('saved', 'Saved successfully');
      this.resetRecordButton();
      setTimeout(() => this.setState('idle', 'Ready'), 4000);
    });

    eventBus.on('error', (event) => {
      this.setState('error', event.data?.message || 'Error');
      this.isRecording = false;
      this.resetRecordButton();
    });
  }

  private render(): void {
    this.renderState();
    this.renderMetrics();
    this.renderBadges();
  }

  private renderState(): void {
    this.stateDot.setAttr('data-state', this.currentState);
    if (this.currentState === 'idle' && !this.stateText.textContent) {
      this.stateText.textContent = 'Ready';
    }
  }

  private renderMetrics(): void {
    const { speakingTimeMs, totalRecordingTimeMs } = this.telemetrySnapshot;
    this.metricsText.textContent = `Speaking ${this.formatSeconds(
      speakingTimeMs
    )} · Recorded ${this.formatSeconds(totalRecordingTimeMs)}`;
  }

  private renderBadges(): void {
    this.badgesContainer.empty();
    if (this.lastLinkCount > 0) {
      this.badgesContainer.createSpan({
        cls: 'zeddal-status-badge',
        text: `${this.lastLinkCount} links inserted`,
      });
    }

    if (this.lastRawSaved) {
      this.badgesContainer.createSpan({
        cls: 'zeddal-status-badge',
        text: 'Raw snapshot saved',
      });
    }
  }

  private formatSeconds(ms: number): string {
    const seconds = Math.max(0, ms / 1000);
    return `${seconds.toFixed(1)}s`;
  }

  private enableDragging(): void {
    this.container.addEventListener('pointerdown', this.handlePointerDown);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.zeddal-status-record')) {
      return;
    }

    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    this.dragState.isDragging = true;
    const rect = this.getContainerRect();
    this.dragState.offsetX = event.clientX - rect.left;
    this.dragState.offsetY = event.clientY - rect.top;
    this.container.classList.add('is-dragging');
    this.attachGlobalDragListeners();
    event.preventDefault();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragState.isDragging) return;
    event.preventDefault();
    this.updatePosition(event.clientX, event.clientY);
  };

  private handlePointerUp = (): void => {
    if (!this.dragState.isDragging) return;
    this.dragState.isDragging = false;
    this.container.classList.remove('is-dragging');
    this.detachGlobalDragListeners();
  };

  private attachGlobalDragListeners(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointermove', this.handlePointerMove);
    document.addEventListener('pointerup', this.handlePointerUp);
  }

  private detachGlobalDragListeners(): void {
    if (typeof document === 'undefined') return;
    document.removeEventListener('pointermove', this.handlePointerMove);
    document.removeEventListener('pointerup', this.handlePointerUp);
  }

  private updatePosition(clientX: number, clientY: number): void {
    const margin = 12;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
    const rect = this.getContainerRect();
    const width = rect.width || 260;
    const height = rect.height || 80;

    const rawX = clientX - this.dragState.offsetX;
    const rawY = clientY - this.dragState.offsetY;
    const maxX = Math.max(margin, viewportWidth - width - margin);
    const maxY = Math.max(margin, viewportHeight - height - margin);
    const x = this.clamp(rawX, margin, maxX);
    const y = this.clamp(rawY, margin, maxY);

    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.container.style.right = 'auto';
    this.container.style.bottom = 'auto';
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
  }

  private getContainerRect(): { left: number; top: number; width: number; height: number } {
    const rect = this.container.getBoundingClientRect?.();
    if (rect) {
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }

    const parse = (value: string | undefined, fallback: number) => {
      const parsed = value ? parseFloat(value) : NaN;
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      left: parse(this.container.style.left, 0),
      top: parse(this.container.style.top, 0),
      width: parse(this.container.style.width, 260),
      height: parse(this.container.style.height, 80),
    };
  }

  private registerButtonHandlers(): void {
    this.recordButton.addEventListener('pointerdown', (evt) => {
      evt.stopPropagation();
    });

    this.recordButton.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (this.isRecording || this.recordButton.disabled) {
        return;
      }
      this.onRecordRequest?.();
    });
  }

  private updateRecordButton(label: string, disabled: boolean): void {
    this.recordButton.textContent = label;
    this.recordButton.disabled = disabled;
  }

  private resetRecordButton(): void {
    this.isRecording = false;
    this.updateRecordButton('● Record', false);
  }
}

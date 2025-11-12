export interface VadFrame {
  isSpeech: boolean;
  durationMs: number;
}

export interface TelemetrySnapshot {
  speakingTimeMs: number;
  totalRecordingTimeMs: number;
}

const defaultNow = typeof performance !== 'undefined' && performance.now
  ? () => performance.now()
  : () => Date.now();

export class RecordingTelemetry {
  private speakingTimeMs = 0;
  private totalRecordingTimeMs = 0;
  private startTimestamp = 0;
  private pausedAt: number | null = null;

  constructor(private now: () => number = defaultNow) {}

  start(): void {
    this.speakingTimeMs = 0;
    this.totalRecordingTimeMs = 0;
    this.startTimestamp = this.now();
    this.pausedAt = null;
  }

  pause(): void {
    if (this.pausedAt !== null) return;
    this.flushTotals();
    this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    const pauseDuration = this.now() - this.pausedAt;
    this.startTimestamp += pauseDuration;
    this.pausedAt = null;
  }

  stop(): void {
    this.flushTotals();
  }

  ingestFrame(frame: VadFrame): void {
    if (frame.isSpeech) {
      this.speakingTimeMs += frame.durationMs;
    }
    this.flushTotals();
  }

  snapshot(): TelemetrySnapshot {
    this.flushTotals();
    return {
      speakingTimeMs: this.speakingTimeMs,
      totalRecordingTimeMs: this.totalRecordingTimeMs,
    };
  }

  private flushTotals(): void {
    if (!this.startTimestamp) return;
    const reference = this.pausedAt ?? this.now();
    this.totalRecordingTimeMs = Math.max(0, reference - this.startTimestamp);
  }
}

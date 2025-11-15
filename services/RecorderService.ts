// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * RecorderService: Audio recording with RMS-based silence detection
 * Architecture: Manages MediaRecorder, AudioContext analysis, and auto-pause on silence
 */

import { eventBus } from '../utils/EventBus';
import { AudioChunk, RecordingState } from '../utils/Types';
import { RecordingTelemetry, TelemetrySnapshot } from './RecordingTelemetry';
import { Config } from '../utils/Config';

export class RecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private chunks: Blob[] = [];
  private state: RecordingState;
  private silenceTimer: number | null = null;
  private animationFrameId: number | null = null;
  private config: Config;
  private stream: MediaStream | null = null;
  private telemetry = new RecordingTelemetry();

  constructor(config: Config) {
    this.config = config;
    this.state = {
      isRecording: false,
      isPaused: false,
      duration: 0,
      confidence: 1.0,
    };
  }

  /**
   * Start recording from microphone
   */
  async start(): Promise<void> {
    try {
      // Request microphone access
      console.log('Requesting microphone access...');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Verify audio tracks are active
      const audioTracks = this.stream.getAudioTracks();
      console.log('Audio tracks found:', audioTracks.length);
      audioTracks.forEach((track, i) => {
        console.log(`Track ${i}:`, {
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        });
      });

      // Setup AudioContext for RMS analysis
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);

      // Setup MediaRecorder
      const mimeType = this.getSupportedMimeType();
      console.log('Using MediaRecorder MIME type:', mimeType);
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: mimeType,
      });

      this.chunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        // Debug logging disabled to prevent console spam
        // console.log('Data available:', event.data.size, 'bytes');
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingStop();
      };

      this.mediaRecorder.start(800); // Frequent chunks for streaming

      this.state.isRecording = true;
      this.state.isPaused = false;
      this.state.duration = 0;
      this.telemetry.start();

      eventBus.emit('recording-started', { state: this.state });

      // Start RMS monitoring
      this.monitorRMS();
    } catch (error) {
      eventBus.emit('error', { message: 'Failed to start recording', error });
      throw error;
    }
  }

  /**
   * Stop recording and return audio blob
   */
  stop(): void {
    if (!this.mediaRecorder || !this.state.isRecording) {
      return;
    }

    this.state.isRecording = false;
    this.state.isPaused = false;

    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.telemetry.stop();
    this.stopMonitoring();
    // Note: cleanup() is called in handleRecordingStop() after blob is created
  }

  /**
   * Pause recording
   */
  pause(): void {
    if (!this.mediaRecorder || !this.state.isRecording || this.state.isPaused) {
      return;
    }

    if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.state.isPaused = true;
      eventBus.emit('recording-paused', { state: this.state });
      this.telemetry.pause();
    }
  }

  /**
   * Resume recording
   */
  resume(): void {
    if (!this.mediaRecorder || !this.state.isRecording || !this.state.isPaused) {
      return;
    }

    if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.state.isPaused = false;
      eventBus.emit('recording-resumed', { state: this.state });

      // Clear silence timer on manual resume
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }

      this.telemetry.resume();
    }
  }

  /**
   * Get current recording state
   */
  getState(): RecordingState {
    return { ...this.state };
  }

  getTelemetrySnapshot(): TelemetrySnapshot {
    return this.telemetry.snapshot();
  }

  /**
   * Monitor RMS levels for silence detection and auto-pause
   */
  private monitorRMS(): void {
    if (!this.analyser) return;

    const bufferLength = this.analyser.fftSize;
    const dataArray = new Float32Array(bufferLength);
    const silenceThreshold = this.config.get('silenceThreshold');
    const silenceDuration = this.config.get('silenceDuration');

    const frameDurationMs = 50;
    const checkRMS = () => {
      if (!this.analyser || !this.state.isRecording) return;

      this.analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square)
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Debug logging disabled to prevent console spam
      // Uncomment for debugging audio quality issues:
      // if (Date.now() % 1000 < 50) {
      //   console.log('RMS level:', rms.toFixed(4), 'Confidence:', (rms * 10).toFixed(2));
      // }

      // Update confidence based on RMS (normalize to 0-1 range)
      this.state.confidence = Math.min(1.0, rms * 10);

      const vadThreshold = this.config.get('silenceThreshold');
      const isSpeech = rms >= vadThreshold;
      this.telemetry.ingestFrame({ isSpeech, durationMs: frameDurationMs });

      // Silence detection - DISABLED FOR NOW (causes recording issues)
      // TODO: Phase 2 - Fix pause/resume to not break MediaRecorder
      /*
      if (rms < silenceThreshold && !this.state.isPaused) {
        if (!this.silenceTimer) {
          this.silenceTimer = window.setTimeout(() => {
            if (this.state.isRecording && !this.state.isPaused) {
              console.log('Auto-pausing due to silence');
              this.pause();
            }
          }, silenceDuration);
        }
      } else if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
      */

      // Update duration
      if (!this.state.isPaused) {
        this.state.duration += 50; // Update every 50ms
      }

      this.animationFrameId = requestAnimationFrame(checkRMS);
    };

    checkRMS();
  }

  /**
   * Stop RMS monitoring
   */
  private stopMonitoring(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Handle recording stop and emit audio chunk
   */
  private handleRecordingStop(): void {
    console.log('Creating blob from', this.chunks.length, 'chunks');
    const totalSize = this.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    console.log('Total audio data:', totalSize, 'bytes');

    const blob = new Blob(this.chunks, {
      type: this.getSupportedMimeType(),
    });

    console.log('Final blob size:', blob.size, 'bytes');

    const audioChunk: AudioChunk = {
      blob,
      timestamp: Date.now(),
      duration: this.state.duration,
    };

    eventBus.emit('recording-stopped', { audioChunk, state: this.state });

    // Cleanup resources after blob is created and event is emitted
    this.cleanup();
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.mediaRecorder = null;
    this.chunks = [];
  }

  /**
   * Get supported MIME type for recording
   */
  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return '';
  }
}

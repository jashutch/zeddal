// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { RecordingTelemetry } from '../services/RecordingTelemetry';

describe('RecordingTelemetry', () => {
  const createClock = (ticks: number[]) => {
    let index = 0;
    return () => ticks[Math.min(index++, ticks.length - 1)];
  };

  it('sums speaking time when VAD true', () => {
    const telemetry = new RecordingTelemetry(() => 0);
    telemetry.start();
    telemetry.ingestFrame({ isSpeech: true, durationMs: 20 });
    telemetry.ingestFrame({ isSpeech: false, durationMs: 20 });
    telemetry.ingestFrame({ isSpeech: true, durationMs: 40 });
    expect(telemetry.snapshot().speakingTimeMs).toBe(60);
  });

  it('handles pause and resume without losing totals', () => {
    const telemetry = new RecordingTelemetry(createClock([0, 1000, 2000, 4000, 6000]));
    telemetry.start();
    telemetry.pause(); // 1000
    telemetry.resume(); // resume at 2000 -> start shifts forward 1000
    telemetry.ingestFrame({ isSpeech: true, durationMs: 1000 });
    telemetry.stop();
    const snap = telemetry.snapshot();
    expect(snap.totalRecordingTimeMs).toBeCloseTo(4000, -2);
    expect(snap.speakingTimeMs).toBe(1000);
  });

  it('keeps drift under 1% over long durations', () => {
    const step = 5;
    let current = 0;
    const telemetry = new RecordingTelemetry(() => (current += step));
    telemetry.start();
    const frames = (10 * 60 * 1000) / step;
    for (let i = 0; i < frames; i++) {
      telemetry.ingestFrame({ isSpeech: i % 2 === 0, durationMs: step });
    }
    const snap = telemetry.snapshot();
    const expected = 10 * 60 * 1000;
    const error = Math.abs(snap.totalRecordingTimeMs - expected);
    expect(error).toBeLessThan(expected * 0.01);
  });
});

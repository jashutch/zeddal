// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

export type ConfidenceStatus = {
  label: 'Ready to share' | 'A quick skim is recommended' | 'We flagged a few uncertain words.' | 'Audio quality or unclear speech affected accuracy.';
  color: 'success' | 'info' | 'warning' | 'danger';
  helpText: string;
};

export const mapConfidenceToStatus = (score: number): ConfidenceStatus => {
  const value = Math.max(0, Math.min(1, score || 0));
  if (value >= 0.85) {
    return {
      label: 'Ready to share',
      color: 'success',
      helpText: 'Transcription looks excellent. You can confidently share it as-is.',
    };
  }

  if (value >= 0.7) {
    return {
      label: 'A quick skim is recommended',
      color: 'info',
      helpText: 'Most of the transcript looks solid. Give it a quick skim before sharing.',
    };
  }

  if (value >= 0.5) {
    return {
      label: 'We flagged a few uncertain words.',
      color: 'warning',
      helpText: 'Some words need a closer look. Review the highlighted segments below.',
    };
  }

  return {
    label: 'Audio quality or unclear speech affected accuracy.',
    color: 'danger',
    helpText: 'Audio was difficult to process. Carefully verify the transcript.',
  };
};

// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

import { mapConfidenceToStatus } from '../utils/ConfidenceStatus';

describe('mapConfidenceToStatus', () => {
  it('returns ready to share for >= 0.85', () => {
    expect(mapConfidenceToStatus(0.9).label).toBe('Ready to share');
    expect(mapConfidenceToStatus(0.85).label).toBe('Ready to share');
  });

  it('returns quick skim for >= 0.7', () => {
    expect(mapConfidenceToStatus(0.84).label).toBe('A quick skim is recommended');
    expect(mapConfidenceToStatus(0.7).label).toBe('A quick skim is recommended');
  });

  it('returns flagged words for >= 0.5', () => {
    expect(mapConfidenceToStatus(0.69).label).toBe('We flagged a few uncertain words.');
    expect(mapConfidenceToStatus(0.5).label).toBe('We flagged a few uncertain words.');
  });

  it('returns audio quality affected below 0.5', () => {
    expect(mapConfidenceToStatus(0.49).label).toBe('Audio quality or unclear speech affected accuracy.');
    expect(mapConfidenceToStatus(-0.2).label).toBe('Audio quality or unclear speech affected accuracy.');
  });
});

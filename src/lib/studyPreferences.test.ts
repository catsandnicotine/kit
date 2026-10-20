import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STUDY_PREFERENCES,
  loadStudyPreferences,
  normalizeStudyPreferences,
  saveStudyPreferences,
} from './studyPreferences';

describe('study preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      clear: () => values.clear(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses safe defaults for missing or malformed values', () => {
    expect(normalizeStudyPreferences(null)).toEqual(DEFAULT_STUDY_PREFERENCES);
    expect(normalizeStudyPreferences({ againSteps: [], desiredRetention: 4 })).toEqual({
      ...DEFAULT_STUDY_PREFERENCES,
      desiredRetention: 0.99,
    });
  });

  it('round-trips normalized preferences', () => {
    saveStudyPreferences({
      againSteps: [2.4, -1, 15],
      graduatingInterval: 2.2,
      easyInterval: 6,
      desiredRetention: 0.85,
    });

    expect(loadStudyPreferences()).toEqual({
      againSteps: [2, 15],
      graduatingInterval: 2,
      easyInterval: 6,
      desiredRetention: 0.85,
    });
  });
});

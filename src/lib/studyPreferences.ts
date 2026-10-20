/** App-wide study defaults used when a new deck is created. */
export interface StudyPreferences {
  againSteps: number[];
  graduatingInterval: number;
  easyInterval: number;
  desiredRetention: number;
}

export const DEFAULT_STUDY_PREFERENCES: Readonly<StudyPreferences> = {
  againSteps: [1, 10],
  graduatingInterval: 1,
  easyInterval: 4,
  desiredRetention: 0.9,
};

const STORAGE_KEY = 'kit_study_preferences_v1';

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

/** Sanitize untrusted persisted preferences and fill missing fields. */
export function normalizeStudyPreferences(value: unknown): StudyPreferences {
  const candidate = value && typeof value === 'object'
    ? value as Partial<StudyPreferences>
    : {};
  const againSteps = Array.isArray(candidate.againSteps)
    ? candidate.againSteps
        .filter((step): step is number => typeof step === 'number' && Number.isFinite(step) && step > 0)
        .map(step => Math.round(step))
        .slice(0, 8)
    : [];
  const retention = typeof candidate.desiredRetention === 'number' && Number.isFinite(candidate.desiredRetention)
    ? Math.min(0.99, Math.max(0.7, candidate.desiredRetention))
    : DEFAULT_STUDY_PREFERENCES.desiredRetention;

  return {
    againSteps: againSteps.length > 0 ? againSteps : [...DEFAULT_STUDY_PREFERENCES.againSteps],
    graduatingInterval: positiveInteger(
      candidate.graduatingInterval,
      DEFAULT_STUDY_PREFERENCES.graduatingInterval,
    ),
    easyInterval: positiveInteger(candidate.easyInterval, DEFAULT_STUDY_PREFERENCES.easyInterval),
    desiredRetention: retention,
  };
}

/** Load app-wide study defaults. Malformed or unavailable storage is harmless. */
export function loadStudyPreferences(): StudyPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeStudyPreferences(JSON.parse(raw)) : normalizeStudyPreferences(null);
  } catch {
    return normalizeStudyPreferences(null);
  }
}

/** Persist app-wide study defaults for future deck creation. */
export function saveStudyPreferences(preferences: StudyPreferences): StudyPreferences {
  const normalized = normalizeStudyPreferences(preferences);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The in-memory UI remains usable when storage is unavailable.
  }
  return normalized;
}

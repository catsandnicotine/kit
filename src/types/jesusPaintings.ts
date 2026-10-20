/** A museum record with an explicitly reusable image of a painting. */
export interface JesusPainting {
  id: string;
  title: string;
  artist: string;
  artistContext?: string;
  date: string;
  year: number | null;
  origin: string;
  originKind: string;
  provenance: string;
  museum: string;
  city: string;
  accession: string;
  medium: string;
  sourceUrl: string;
  metadataUrl: string;
  imageUrl: string;
  rights: 'CC0';
  rightsEvidence: string;
  rightsUrl: string;
  subjectEvidence: string;
}

/** Search coverage retained alongside the distributable deck. */
export interface JesusPaintingCatalogue {
  schemaVersion: number;
  checkedOn: string;
  scope: string;
  coverage: Array<{ museum: string; method: string; terms?: string[]; examined: number; matchedObjectCount?: number; unavailableObjectIds?: number[] }>;
  paintings: JesusPainting[];
  exclusions?: {
    subjectReview: Record<string, string>;
    unavailableImages: Array<{ id: string; imageUrl: string; reason: string }>;
  };
}

/** Consecutive taps on the version label. */
export interface EasterEggTapState {
  count: number;
  lastTapAt: number;
}

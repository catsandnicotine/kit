/**
 * deckRegistry — manages the local list of known decks and their metadata.
 *
 * The registry is a small JSON file stored locally (not synced to iCloud).
 * It tracks which decks exist, their cached names/counts, and whether
 * their iCloud data is downloaded.
 *
 * On app launch, the registry is reconciled with iCloud to discover
 * new decks from other devices or detect deletions.
 */

import type { DeckRegistry, DeckRegistryEntry, GlobalTag } from './types';
import { generateDeviceId } from './hlc';

// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------

let registry: DeckRegistry | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the deck registry from a JSON string.
 * If no persisted registry exists, creates a new one with a fresh device ID.
 *
 * @param json - Persisted registry JSON, or null for a fresh registry.
 * @returns The initialized registry.
 */
export function initRegistry(json: string | null): DeckRegistry {
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.v === 1 && parsed.deviceId && parsed.decks) {
        registry = parsed as DeckRegistry;
        return registry;
      }
    } catch {
      // Fall through to create new
    }
  }

  registry = {
    v: 1,
    deviceId: generateDeviceId(),
    decks: {},
  };
  return registry;
}

/**
 * Get the current in-memory registry.
 *
 * @returns The registry, or null if not initialized.
 */
export function getRegistry(): DeckRegistry | null {
  return registry;
}

/**
 * Get this device's stable identifier.
 *
 * @returns Device ID string, or empty string if registry not initialized.
 */
export function getDeviceId(): string {
  return registry?.deviceId ?? '';
}

/**
 * Serialize the registry to JSON for persistence.
 *
 * @returns JSON string.
 */
export function serializeRegistry(): string {
  if (!registry) {
    registry = initRegistry(null);
  }
  return JSON.stringify(registry);
}

/**
 * Get all non-deleted deck entries, sorted by name.
 *
 * @returns Array of registry entries.
 */
export function getAllDeckEntries(): DeckRegistryEntry[] {
  if (!registry) return [];
  return Object.values(registry.decks)
    .filter(e => !e.deleted)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a single deck entry.
 *
 * @param deckId - Deck UUID.
 * @returns The entry, or undefined if not found.
 */
export function getDeckEntry(deckId: string): DeckRegistryEntry | undefined {
  return registry?.decks[deckId];
}

/**
 * Add or update a deck in the registry.
 *
 * @param entry - The deck entry to upsert.
 */
export function upsertDeckEntry(entry: DeckRegistryEntry): void {
  if (!registry) {
    registry = initRegistry(null);
  }
  registry.decks[entry.deckId] = entry;
}

/**
 * Remove a deck from the registry entirely.
 *
 * @param deckId - Deck UUID.
 */
export function removeDeckEntry(deckId: string): void {
  if (registry) {
    delete registry.decks[deckId];
  }
}

/**
 * Mark a deck as soft-deleted.
 *
 * @param deckId - Deck UUID.
 */
export function softDeleteDeck(deckId: string): void {
  const entry = registry?.decks[deckId];
  if (entry) {
    entry.deleted = true;
  }
}

/**
 * Update cached metadata for a deck.
 *
 * @param deckId    - Deck UUID.
 * @param name      - Updated deck name.
 * @param cardCount - Updated total card count.
 * @param counts    - Optional detailed card counts (new, learning, review).
 */
export function updateDeckMeta(
  deckId: string,
  name: string,
  cardCount: number,
  counts?: { newCount: number; learningCount: number; reviewCount: number },
): void {
  const entry = registry?.decks[deckId];
  if (entry) {
    entry.name = name;
    entry.cardCount = cardCount;
    if (counts) {
      entry.newCount = counts.newCount;
      entry.learningCount = counts.learningCount;
      entry.reviewCount = counts.reviewCount;
    }
    entry.lastAccessedAt = Math.floor(Date.now() / 1000);
  }
}

/**
 * Reconcile the local registry with deck IDs discovered in iCloud.
 * Adds entries for decks found in iCloud but not in the registry.
 * Does NOT remove local entries (they may have pending edits).
 *
 * @param icloudDeckIds - Deck IDs found in iCloud storage.
 */
export function reconcileWithICloud(icloudDeckIds: string[]): void {
  if (!registry) {
    registry = initRegistry(null);
  }

  for (const deckId of icloudDeckIds) {
    if (!registry.decks[deckId]) {
      registry.decks[deckId] = {
        deckId,
        name: '', // Will be populated when snapshot is loaded
        hasLocalDb: false,
        isDownloaded: false,
        cardCount: 0,
        lastAccessedAt: 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Global tag catalog
// ---------------------------------------------------------------------------

/**
 * Get all tags from the global catalog, sorted alphabetically.
 *
 * @returns Array of global tags.
 */
export function getAllGlobalTags(): GlobalTag[] {
  if (!registry?.globalTags) return [];
  return Object.values(registry.globalTags)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Create or update a tag in the global catalog.
 *
 * @param name  - Tag name.
 * @param color - Hex color string (empty = uncoloured).
 */
export function upsertGlobalTag(name: string, color: string): void {
  if (!registry) {
    registry = initRegistry(null);
  }
  if (!registry.globalTags) {
    registry.globalTags = {};
  }
  registry.globalTags[name] = { name, color };
}

/**
 * Delete a tag from the global catalog.
 *
 * @param name - Tag name to remove.
 */
export function deleteGlobalTag(name: string): void {
  if (registry?.globalTags) {
    delete registry.globalTags[name];
  }
}

/**
 * Rename a tag in the global catalog.
 *
 * @param oldName - Current tag name.
 * @param newName - New tag name.
 */
export function renameGlobalTag(oldName: string, newName: string): void {
  if (!registry?.globalTags) return;
  const entry = registry.globalTags[oldName];
  if (!entry) return;
  delete registry.globalTags[oldName];
  registry.globalTags[newName] = { name: newName, color: entry.color };
}

/**
 * Merge imported tags into the global catalog.
 * Only adds tags that don't already exist (preserves user's color choices).
 *
 * @param tags - Tags discovered during import.
 */
export function mergeTagsIntoGlobal(tags: Array<{ tag: string; color: string }>): void {
  if (!registry) {
    registry = initRegistry(null);
  }
  if (!registry.globalTags) {
    registry.globalTags = {};
  }
  for (const { tag, color } of tags) {
    if (!registry.globalTags[tag]) {
      registry.globalTags[tag] = { name: tag, color };
    }
  }
}

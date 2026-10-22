/** Content-only metadata that Anki's whitespace-separated tags cannot represent exactly. */
export interface KitCardMetadata {
  version: 1;
  cardsById: Record<string, { tags: string[] }>;
}

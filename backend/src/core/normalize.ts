/** Name normalization helpers shared by parser and diff. */

/** Marker appended to a player name when they are leaving for a foreign league. */
const FOREIGN_MARKER = /\*+\s*$/;

/** Collapses whitespace (including non-breaking spaces) and trims. */
export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export interface ParsedName {
  /** Display name, marker removed, spacing normalized. */
  name: string;
  /** Comparison key: lowercase, diacritics removed, punctuation collapsed. */
  key: string;
  /** True when the raw value carried the `*` marker. */
  foreign: boolean;
}

/**
 * Splits a raw cell value into display name, comparison key and the foreign marker.
 *
 * The asterisk is a marker, not part of the name: `"Norton-Cuffy *"` and `"Norton-Cuffy"`
 * must resolve to the same key so the player can be matched across snapshots.
 */
export function parsePlayerName(raw: string): ParsedName {
  const collapsed = collapseSpaces(raw);
  const foreign = FOREIGN_MARKER.test(collapsed);
  const name = collapseSpaces(collapsed.replace(FOREIGN_MARKER, ''));
  return { name, key: buildKey(name), foreign };
}

/**
 * Builds the comparison key: names in the source files use accents, apostrophes and
 * abbreviations (`Tourè E.`, `N'Dri`, `Milinkovic-Savic V.`) that must not defeat matching.
 */
export function buildKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

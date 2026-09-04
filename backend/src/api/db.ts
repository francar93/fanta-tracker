/**
 * lowdb persistence: uploaded snapshots and league settings live in a local `db.json`.
 *
 * Snapshots are stored **already parsed**, not as `.xlsx` blobs: the report is rebuilt from them on
 * every request, so re-reading the original files is never necessary and the database stays
 * inspectable by hand.
 */

import { JSONFilePreset } from 'lowdb/node';
import type { Low } from 'lowdb';
import { DEFAULT_MAX_CHANGES } from '../core/engine.js';
import type { RosterSnapshot, SnapshotKind, TeamRoster } from '../core/types.js';

/** A snapshot as persisted, with its upload metadata. */
export interface StoredSnapshot {
  id: string;
  version: number;
  kind: SnapshotKind;
  source: string;
  uploadedAt: string;
  teams: TeamRoster[];
}

export interface LeagueSettings {
  /** Seasonal change limit. */
  maxChanges: number;
}

export interface DatabaseData {
  settings: LeagueSettings;
  snapshots: StoredSnapshot[];
}

export type Database = Low<DatabaseData>;

/** Default location of the database file, overridable with `FANTA_DB`. */
export const DEFAULT_DB_FILE = 'db.json';

export function defaultData(): DatabaseData {
  return { settings: { maxChanges: DEFAULT_MAX_CHANGES }, snapshots: [] };
}

export async function openDatabase(file = process.env['FANTA_DB'] ?? DEFAULT_DB_FILE): Promise<Database> {
  return JSONFilePreset<DatabaseData>(file, defaultData());
}

/** Rebuilds the engine input from what is persisted. */
export function toRosterSnapshot(stored: StoredSnapshot): RosterSnapshot {
  return { version: stored.version, kind: stored.kind, source: stored.source, teams: stored.teams };
}

/** Snapshot metadata without the (large) roster payload, for list responses. */
export function summarize(stored: StoredSnapshot): Omit<StoredSnapshot, 'teams'> & { teamCount: number } {
  const { teams, ...rest } = stored;
  return { ...rest, teamCount: teams.length };
}

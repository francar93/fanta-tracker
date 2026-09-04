/** Domain types for the FantaTracker core engine. */

/** A single player slot inside a team roster. */
export interface Player {
  /** Player name as written in the Excel file, asterisk stripped. */
  name: string;
  /** Normalized comparison key (lowercase, no diacritics, no marker). */
  key: string;
  /** Purchase cost in credits. */
  cost: number;
  /** True when the name carried the `*` marker (player leaving for a foreign league). */
  foreign: boolean;
}

/** One team's roster within a single snapshot. */
export interface TeamRoster {
  /** Team name as written in row 1 of the sheet. */
  team: string;
  players: Player[];
  /** Value of the `totale` row, when present in the file. */
  declaredTotal: number | null;
}

/**
 * Nature of the window between a snapshot and the previous one.
 *
 * The Excel files cannot tell an agreed trade from "team A releases the player, team B signs him
 * from the free agents pool": both look identical in the diff. So the nature of the window is
 * declared out of band — by the file name (`XX-scambi-3.xlsx`) or by the user at upload time.
 */
export type SnapshotKind =
  /** Ordinary transfer window: outgoing players consume the seasonal budget. */
  | 'MERCATO'
  /** Trade window: movements matched across two teams are exempt. */
  | 'SCAMBI';

/** A parsed Excel snapshot of the whole league at a point in time. */
export interface RosterSnapshot {
  /** Sequential version taken from the `-N` suffix of the file name. */
  version: number;
  /** Nature of the window between this snapshot and the previous one. */
  kind: SnapshotKind;
  /** Original file name, kept for reporting. */
  source: string;
  teams: TeamRoster[];
}

/**
 * A movement that *looks* like a trade but happened in a `MERCATO` window: the player left team A
 * and joined team B in the same step. Reported so the user can spot a mislabeled file — it is
 * counted as a plain change until the window is declared as `SCAMBI`.
 */
export interface TradeCandidate {
  version: number;
  player: string;
  from: string;
  to: string;
}

/**
 * Classification of a roster movement.
 * Only `CAMBIO` consumes the seasonal budget.
 */
export type MovementType =
  /** Player traded to/from another team of the league: unlimited, free. */
  | 'SCAMBIO'
  /** Player left for a foreign league (marked `*` in the previous file): exempt. */
  | 'ESTERO'
  /** Player released and replaced from the free agents pool: costs 1 change. */
  | 'CAMBIO'
  /** Player signed from the free agents pool (incoming side of a `CAMBIO`). */
  | 'SVINCOLO';

export type MovementDirection = 'OUT' | 'IN';

/** A single player movement detected between two consecutive snapshots. */
export interface Movement {
  team: string;
  player: string;
  cost: number;
  direction: MovementDirection;
  type: MovementType;
  /** For trades, the team on the other side of the operation. */
  counterparty: string | null;
  /** Version of the snapshot the movement was detected in (the "N" of N vs N-1). */
  version: number;
  /** True when this movement increments the team's change counter. */
  countsAsChange: boolean;
}

/** Aggregated season totals for one team. */
export interface TeamReport {
  team: string;
  /** Number of movements that consumed the seasonal budget. */
  changes: number;
  /** Exempt movements towards foreign leagues. */
  foreignTransfers: number;
  /** Exempt movements resolved as internal trades (outgoing side only). */
  trades: number;
  /** `maxChanges - changes`, floored at 0. */
  remainingChanges: number;
  /** True when the team went over the seasonal limit. */
  overLimit: boolean;
  movements: Movement[];
}

/** One analyzed window, for traceability in the report. */
export interface WindowInfo {
  version: number;
  kind: SnapshotKind;
  source: string;
}

/** Full season report produced by the engine. */
export interface SeasonReport {
  maxChanges: number;
  /** Snapshot versions actually compared, in order. */
  versions: number[];
  /** Every snapshot with its declared nature. */
  windows: WindowInfo[];
  teams: TeamReport[];
}

/** Engine configuration. */
export interface EngineOptions {
  /** Seasonal change limit. Defaults to 12. */
  maxChanges?: number;
}

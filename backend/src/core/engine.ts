/**
 * Cascade engine: runs the pairwise diff over an ordered list of snapshots
 * (file N vs file N-1) and sums the partial deltas into the season report.
 */

import { diffSnapshots } from './diff.js';
import type {
  EngineOptions,
  Movement,
  RosterSnapshot,
  SeasonReport,
  TeamReport,
  TradeCandidate,
} from './types.js';

/** Seasonal change limit when the caller does not override it. */
export const DEFAULT_MAX_CHANGES = 12;

export interface AnalysisResult extends SeasonReport {
  /** Matched movements in `MERCATO` windows: possible trades not declared as such. */
  tradeCandidates: TradeCandidate[];
  warnings: string[];
}

/**
 * Builds the season report from every provided snapshot.
 * Snapshots are ordered by their `version` before comparing, so upload order does not matter.
 */
export function analyzeSeason(snapshots: RosterSnapshot[], options: EngineOptions = {}): AnalysisResult {
  const maxChanges = options.maxChanges ?? DEFAULT_MAX_CHANGES;
  const ordered = [...snapshots].sort((a, b) => a.version - b.version);

  const warnings: string[] = [...duplicateVersionWarnings(ordered)];
  const movements: Movement[] = [];
  const tradeCandidates: TradeCandidate[] = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    const step = diffSnapshots(previous, current);
    movements.push(...step.movements);
    tradeCandidates.push(...step.candidates);
    warnings.push(...step.warnings);
  }

  return {
    maxChanges,
    versions: ordered.map((snapshot) => snapshot.version),
    windows: ordered.map(({ version, kind, source }) => ({ version, kind, source })),
    teams: buildTeamReports(ordered, movements, maxChanges),
    tradeCandidates,
    warnings,
  };
}

/** Every team seen in any snapshot gets a row, even one with no movements at all. */
function buildTeamReports(snapshots: RosterSnapshot[], movements: Movement[], maxChanges: number): TeamReport[] {
  const reports = new Map<string, TeamReport>();

  for (const snapshot of snapshots) {
    for (const { team } of snapshot.teams) {
      if (!reports.has(team)) {
        reports.set(team, {
          team,
          operations: 0,
          changes: 0,
          foreignTransfers: 0,
          trades: 0,
          remainingChanges: maxChanges,
          overLimit: false,
          movements: [],
        });
      }
    }
  }

  for (const move of movements) {
    const report = reports.get(move.team);
    if (!report) continue;
    report.movements.push(move);
    if (move.countsAsChange) report.changes += 1;
    if (move.direction !== 'OUT') continue;
    report.operations += 1;
    if (move.type === 'ESTERO') report.foreignTransfers += 1;
    if (move.type === 'SCAMBIO') report.trades += 1;
  }

  for (const report of reports.values()) {
    report.remainingChanges = Math.max(0, maxChanges - report.changes);
    report.overLimit = report.changes > maxChanges;
    report.movements.sort(byVersionThenPlayer);
  }

  return [...reports.values()].sort((a, b) => b.changes - a.changes || a.team.localeCompare(b.team, 'it'));
}

function byVersionThenPlayer(a: Movement, b: Movement): number {
  return a.version - b.version || a.direction.localeCompare(b.direction) || a.player.localeCompare(b.player, 'it');
}

function duplicateVersionWarnings(snapshots: RosterSnapshot[]): string[] {
  const seen = new Map<number, string>();
  const warnings: string[] = [];
  for (const snapshot of snapshots) {
    const previous = seen.get(snapshot.version);
    if (previous) {
      warnings.push(
        `Versione ${snapshot.version} duplicata ("${previous}" e "${snapshot.source}"): l'ordine del confronto potrebbe essere errato.`,
      );
    } else {
      seen.set(snapshot.version, snapshot.source);
    }
  }
  return warnings;
}

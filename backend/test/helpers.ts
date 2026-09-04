/** Test helpers: build snapshots in memory without going through Excel. */

import { parsePlayerName } from '../src/core/normalize.js';
import type { RosterSnapshot, SnapshotKind, TeamRoster } from '../src/core/types.js';

/** `"Leao *"` or `"Leao:120"` — cost defaults to 1 when omitted. */
export function team(name: string, ...players: string[]): TeamRoster {
  return {
    team: name,
    players: players.map((entry) => {
      const [rawName, rawCost] = entry.split(':');
      const { name: playerName, key, foreign } = parsePlayerName(rawName ?? '');
      return { name: playerName, key, foreign, cost: rawCost ? Number(rawCost) : 1 };
    }),
    declaredTotal: null,
  };
}

/** Ordinary transfer window. */
export function snapshot(version: number, ...teams: TeamRoster[]): RosterSnapshot {
  return build(version, 'MERCATO', teams);
}

/** Window declared as a trade window (`XX-scambi-N.xlsx`). */
export function tradeSnapshot(version: number, ...teams: TeamRoster[]): RosterSnapshot {
  return build(version, 'SCAMBI', teams);
}

function build(version: number, kind: SnapshotKind, teams: TeamRoster[]): RosterSnapshot {
  const marker = kind === 'SCAMBI' ? 'scambi-' : '';
  return { version, kind, source: `test-${marker}${version}.xlsx`, teams };
}

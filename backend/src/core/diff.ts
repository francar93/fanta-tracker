/**
 * League-level diff between two consecutive snapshots.
 *
 * The Excel files cannot distinguish an agreed trade from a plain sale followed by a purchase:
 * in both cases the player simply leaves team A and appears in team B. So the nature of the window
 * is declared out of band (`RosterSnapshot.kind`, from the file name or from the web UI) and drives
 * the classification of an outgoing player:
 *
 *   window `SCAMBI`  — the player is matched with an arrival at another team -> SCAMBIO (exempt)
 *   window `MERCATO` — no trade is ever inferred; a match is only reported as a candidate
 *   then, in both windows: the `*` marker in the previous snapshot -> ESTERO (exempt)
 *   otherwise -> CAMBIO (+1)
 *
 * Matching is still resolved across the whole league, never team by team: the outgoing/incoming
 * maps are built for every team first, and classification happens afterwards.
 */

import type { Movement, Player, RosterSnapshot, TradeCandidate } from './types.js';

/** Result of comparing snapshot N against snapshot N-1. */
export interface StepDiff {
  /** Version of the newer snapshot. */
  version: number;
  movements: Movement[];
  /** Matched movements in a `MERCATO` window: possible trades declared with the wrong file name. */
  candidates: TradeCandidate[];
  /** Non-fatal inconsistencies found while comparing (e.g. teams appearing or disappearing). */
  warnings: string[];
}

interface Side {
  team: string;
  player: Player;
}

/** Compares two snapshots and returns every classified movement of the step. */
export function diffSnapshots(previous: RosterSnapshot, current: RosterSnapshot): StepDiff {
  const warnings: string[] = [];
  const candidates: TradeCandidate[] = [];
  const previousByTeam = new Map(previous.teams.map((t) => [t.team, t]));
  const currentByTeam = new Map(current.teams.map((t) => [t.team, t]));

  for (const team of previousByTeam.keys()) {
    if (!currentByTeam.has(team)) {
      warnings.push(`Squadra "${team}" presente in ${previous.source} ma assente in ${current.source}: ignorata.`);
    }
  }
  for (const team of currentByTeam.keys()) {
    if (!previousByTeam.has(team)) {
      warnings.push(`Squadra "${team}" presente in ${current.source} ma assente in ${previous.source}: ignorata.`);
    }
  }

  // Pass 1 — collect what left and what arrived, for every team of the league.
  const outgoing: Side[] = [];
  const incoming: Side[] = [];

  for (const [team, currentRoster] of currentByTeam) {
    const previousRoster = previousByTeam.get(team);
    if (!previousRoster) continue;

    const previousKeys = new Set(previousRoster.players.map((p) => p.key));
    const currentKeys = new Set(currentRoster.players.map((p) => p.key));

    for (const player of previousRoster.players) {
      if (!currentKeys.has(player.key)) outgoing.push({ team, player });
    }
    for (const player of currentRoster.players) {
      if (!previousKeys.has(player.key)) incoming.push({ team, player });
    }
  }

  const incomingByKey = groupByKey(incoming);
  const outgoingByKey = groupByKey(outgoing);
  const tradeWindow = current.kind === 'SCAMBI';

  // Pass 2 — classify now that the whole league is known.
  const movements: Movement[] = [];

  for (const { team, player } of outgoing) {
    const counterparty = findCounterparty(incomingByKey, player.key, team);

    if (tradeWindow && counterparty) {
      movements.push(movement(team, player, 'OUT', 'SCAMBIO', counterparty, current.version, false));
      continue;
    }

    if (counterparty) {
      // MERCATO: the player was sold and picked up by someone else. It stays a change for both,
      // but we surface it in case the window was meant to be declared as `SCAMBI`.
      candidates.push({ version: current.version, player: player.name, from: team, to: counterparty });
    } else if (tradeWindow) {
      warnings.push(
        `${current.source} è dichiarata finestra scambi ma "${player.name}" esce da "${team}" senza controparte nella lega.`,
      );
    }

    const type = player.foreign ? 'ESTERO' : 'CAMBIO';
    movements.push(movement(team, player, 'OUT', type, null, current.version, type === 'CAMBIO'));
  }

  for (const { team, player } of incoming) {
    const counterparty = findCounterparty(outgoingByKey, player.key, team);
    const trade = tradeWindow && counterparty !== null;
    movements.push(
      movement(team, player, 'IN', trade ? 'SCAMBIO' : 'SVINCOLO', trade ? counterparty : null, current.version, false),
    );
  }

  return { version: current.version, movements, candidates, warnings };
}

function movement(
  team: string,
  player: Player,
  direction: Movement['direction'],
  type: Movement['type'],
  counterparty: string | null,
  version: number,
  countsAsChange: boolean,
): Movement {
  return { team, player: player.name, cost: player.cost, direction, type, counterparty, version, countsAsChange };
}

function groupByKey(sides: Side[]): Map<string, Side[]> {
  const map = new Map<string, Side[]>();
  for (const side of sides) {
    const bucket = map.get(side.player.key);
    if (bucket) bucket.push(side);
    else map.set(side.player.key, [side]);
  }
  return map;
}

/** Returns the other team involved in the same player's opposite movement, if any. */
function findCounterparty(index: Map<string, Side[]>, key: string, team: string): string | null {
  const candidates = index.get(key);
  if (!candidates) return null;
  return candidates.find((candidate) => candidate.team !== team)?.team ?? null;
}

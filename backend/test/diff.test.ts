/** Business rules: market window, trade window, foreign transfer, and their precedence. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSnapshots } from '../src/core/diff.js';
import { analyzeSeason } from '../src/core/engine.js';
import { snapshot, team, tradeSnapshot } from './helpers.js';

test('un giocatore sostituito da uno svincolato conta come cambio', () => {
  const before = snapshot(1, team('Alpha', 'Rossi', 'Bianchi'));
  const after = snapshot(2, team('Alpha', 'Rossi', 'Verdi'));

  const { movements } = diffSnapshots(before, after);
  const out = movements.find((m) => m.direction === 'OUT');
  const incoming = movements.find((m) => m.direction === 'IN');

  assert.equal(out?.player, 'Bianchi');
  assert.equal(out?.type, 'CAMBIO');
  assert.equal(out?.countsAsChange, true);
  assert.equal(incoming?.type, 'SVINCOLO');
  assert.equal(incoming?.countsAsChange, false);
});

test('in una finestra di mercato un giocatore passato ad altra squadra resta un cambio per entrambe', () => {
  const before = snapshot(1, team('Alpha', 'Rossi'), team('Beta', 'Bianchi'));
  const after = snapshot(2, team('Alpha', 'Neri'), team('Beta', 'Bianchi', 'Rossi'));

  const { movements, candidates } = diffSnapshots(before, after);
  const out = movements.find((m) => m.team === 'Alpha' && m.player === 'Rossi');
  const incoming = movements.find((m) => m.team === 'Beta' && m.player === 'Rossi');

  assert.equal(out?.type, 'CAMBIO');
  assert.equal(out?.countsAsChange, true);
  assert.equal(incoming?.type, 'SVINCOLO');
  assert.deepEqual(candidates, [{ version: 2, player: 'Rossi', from: 'Alpha', to: 'Beta' }]);
});

test('nella finestra scambi i movimenti con controparte sono esenti per entrambe le squadre', () => {
  const before = snapshot(1, team('Alpha', 'Rossi'), team('Beta', 'Bianchi'));
  const after = tradeSnapshot(2, team('Alpha', 'Bianchi'), team('Beta', 'Rossi'));

  const { movements, candidates, warnings } = diffSnapshots(before, after);

  assert.equal(movements.length, 4);
  assert.ok(movements.every((m) => m.type === 'SCAMBIO'));
  assert.ok(movements.every((m) => m.countsAsChange === false));
  assert.equal(movements.find((m) => m.team === 'Alpha' && m.direction === 'OUT')?.counterparty, 'Beta');
  assert.deepEqual(candidates, []);
  assert.deepEqual(warnings, []);
});

test("nella finestra scambi un'uscita senza controparte resta un cambio e produce un warning", () => {
  const before = snapshot(1, team('Alpha', 'Rossi'), team('Beta', 'Bianchi'));
  const after = tradeSnapshot(2, team('Alpha', 'Neri'), team('Beta', 'Bianchi'));

  const { movements, warnings } = diffSnapshots(before, after);
  const out = movements.find((m) => m.direction === 'OUT');

  assert.equal(out?.type, 'CAMBIO');
  assert.equal(out?.countsAsChange, true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /senza controparte/);
});

test("l'asterisco nel file N-1 rende esente l'uscita nel file N", () => {
  const before = snapshot(1, team('Alpha', 'Rossi', 'Bianchi *'));
  const after = snapshot(2, team('Alpha', 'Rossi', 'Verdi'));

  const { movements } = diffSnapshots(before, after);
  const out = movements.find((m) => m.direction === 'OUT');

  assert.equal(out?.type, 'ESTERO');
  assert.equal(out?.countsAsChange, false);
});

test("l'asterisco su un giocatore ancora in rosa non produce alcun movimento", () => {
  const before = snapshot(1, team('Alpha', 'Rossi *'));
  const after = snapshot(2, team('Alpha', 'Rossi *'));

  assert.deepEqual(diffSnapshots(before, after).movements, []);
});

test('nella finestra scambi lo scambio ha precedenza sulla regola estero', () => {
  const before = snapshot(1, team('Alpha', 'Rossi *'), team('Beta', 'Bianchi'));
  const after = tradeSnapshot(2, team('Alpha', 'Neri'), team('Beta', 'Bianchi', 'Rossi'));

  const { movements } = diffSnapshots(before, after);
  const out = movements.find((m) => m.team === 'Alpha' && m.player === 'Rossi');

  assert.equal(out?.type, 'SCAMBIO');
  assert.equal(out?.counterparty, 'Beta');
  assert.equal(out?.countsAsChange, false);
});

test('il confronto ignora accenti, apostrofi e marker', () => {
  const before = snapshot(1, team('Alpha', 'Tourè E.', "N'Dri"));
  const after = snapshot(2, team('Alpha', 'Toure E. *', 'N’Dri'));

  assert.deepEqual(diffSnapshots(before, after).movements, []);
});

test('i cambi si sommano a cascata sui file successivi', () => {
  const v1 = snapshot(1, team('Alpha', 'Rossi', 'Bianchi'));
  const v2 = snapshot(2, team('Alpha', 'Rossi', 'Verdi'));
  const v3 = snapshot(3, team('Alpha', 'Neri', 'Verdi'));

  const report = analyzeSeason([v3, v1, v2], { maxChanges: 12 });
  const alpha = report.teams.find((t) => t.team === 'Alpha');

  assert.deepEqual(report.versions, [1, 2, 3]);
  assert.equal(alpha?.changes, 2);
  assert.equal(alpha?.remainingChanges, 10);
  assert.equal(alpha?.overLimit, false);
});

test('una finestra scambi in mezzo alla cascata non erode il budget', () => {
  const v1 = snapshot(1, team('Alpha', 'Rossi', 'Bianchi'), team('Beta', 'Verdi', 'Neri'));
  const v2 = tradeSnapshot(2, team('Alpha', 'Rossi', 'Verdi'), team('Beta', 'Bianchi', 'Neri'));
  const v3 = snapshot(3, team('Alpha', 'Rossi', 'Gialli'), team('Beta', 'Bianchi', 'Neri'));

  const report = analyzeSeason([v1, v2, v3]);
  const alpha = report.teams.find((t) => t.team === 'Alpha');
  const beta = report.teams.find((t) => t.team === 'Beta');

  assert.equal(alpha?.trades, 1);
  assert.equal(alpha?.changes, 1); // solo Verdi -> Gialli nella finestra 3
  assert.equal(beta?.trades, 1);
  assert.equal(beta?.changes, 0);
  assert.deepEqual(
    report.windows.map((w) => w.kind),
    ['MERCATO', 'SCAMBI', 'MERCATO'],
  );
});

test('il limite stagionale è configurabile e segnala lo sforamento', () => {
  const v1 = snapshot(1, team('Alpha', 'Rossi'));
  const v2 = snapshot(2, team('Alpha', 'Bianchi'));

  const report = analyzeSeason([v1, v2], { maxChanges: 0 });
  const alpha = report.teams.find((t) => t.team === 'Alpha');

  assert.equal(alpha?.changes, 1);
  assert.equal(alpha?.remainingChanges, 0);
  assert.equal(alpha?.overLimit, true);
});

test('una squadra assente in uno dei due file produce un warning e non movimenti', () => {
  const v1 = snapshot(1, team('Alpha', 'Rossi'), team('Beta', 'Bianchi'));
  const v2 = snapshot(2, team('Alpha', 'Rossi'));

  const report = analyzeSeason([v1, v2]);

  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0]!, /Beta/);
  assert.equal(report.teams.find((t) => t.team === 'Beta')?.movements.length, 0);
});

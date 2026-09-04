/** Parser tests against the real league exports in `assets/input/`. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describeFileName, parseRosterFile, versionFromFileName } from '../src/core/parser.js';
import { analyzeSeason } from '../src/core/engine.js';
import { renderSummaryTable } from '../src/core/markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const input = (name: string) => resolve(here, '../../assets/input', name);

test('la versione viene dedotta dal suffisso numerico del nome file', () => {
  assert.equal(versionFromFileName('gufipersempre-1.xlsx'), 1);
  assert.equal(versionFromFileName('/tmp/gufipersempre-12.xlsx'), 12);
  assert.equal(versionFromFileName('senza-suffisso.xlsx'), 0);
});

test('il marker "scambi" nel nome file dichiara una finestra scambi', () => {
  assert.deepEqual(describeFileName('gufipersempre-2.xlsx'), { version: 2, kind: 'MERCATO' });
  assert.deepEqual(describeFileName('gufipersempre-scambi-3.xlsx'), { version: 3, kind: 'SCAMBI' });
  assert.deepEqual(describeFileName('gufipersempre-3-scambi.xlsx'), { version: 3, kind: 'SCAMBI' });
  assert.deepEqual(describeFileName('gufipersempre-SCAMBI-4.xlsx'), { version: 4, kind: 'SCAMBI' });
  // Il marker deve essere un token a sé: non basta che la parola compaia nel nome.
  assert.deepEqual(describeFileName('scambissimo-5.xlsx'), { version: 5, kind: 'MERCATO' });
});

test("l'opzione kind ha la precedenza sul nome file (upload dalla UI web)", async () => {
  const snapshot = await parseRosterFile(input('gufipersempre-2.xlsx'), { kind: 'SCAMBI' });
  assert.equal(snapshot.kind, 'SCAMBI');
  assert.equal(snapshot.version, 2);
});

test('il parser legge le 10 squadre e scarta la riga totale', async () => {
  const snapshot = await parseRosterFile(input('gufipersempre-1.xlsx'));

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.teams.length, 10);
  assert.equal(snapshot.teams[0]?.team, 'CSKLARISSA');
  assert.equal(snapshot.teams[9]?.team, 'Las Evel');

  for (const team of snapshot.teams) {
    assert.equal(team.players.length, 25, `${team.team} deve avere 25 giocatori`);
    assert.ok(team.players.every((p) => p.name.toLowerCase() !== 'totale'));
    assert.equal(
      team.players.reduce((sum, p) => sum + p.cost, 0),
      team.declaredTotal,
      `${team.team}: la somma dei costi deve coincidere con la riga totale`,
    );
  }
});

test("l'asterisco viene separato dal nome e non ne fa parte", async () => {
  const snapshot = await parseRosterFile(input('gufipersempre-1.xlsx'));
  const cskl = snapshot.teams.find((t) => t.team === 'CSKLARISSA');
  const nortonCuffy = cskl?.players.find((p) => p.name === 'Norton-Cuffy');

  assert.ok(nortonCuffy, 'Norton-Cuffy deve essere presente senza asterisco nel nome');
  assert.equal(nortonCuffy?.foreign, true);
  assert.equal(nortonCuffy?.cost, 23);
});

test('analisi end-to-end sui due file reali', async () => {
  const snapshots = await Promise.all([
    parseRosterFile(input('gufipersempre-1.xlsx')),
    parseRosterFile(input('gufipersempre-2.xlsx')),
  ]);

  const report = analyzeSeason(snapshots);

  assert.deepEqual(report.warnings, []);
  assert.equal(report.teams.length, 10);
  assert.equal(report.maxChanges, 12);

  for (const team of report.teams) {
    assert.ok(team.changes >= 0);
    assert.equal(team.operations, team.changes + team.foreignTransfers + team.trades);
    assert.equal(team.remainingChanges, Math.max(0, 12 - team.changes));
  }

  // Riferimento verificato a mano sul file grezzo: 5 uscite, di cui "Romagnoli *" verso l'estero.
  const atletico = report.teams.find((t) => t.team === 'Atletico ma non troppo');
  assert.equal(atletico?.operations, 5);
  assert.equal(atletico?.changes, 4);
  assert.equal(atletico?.foreignTransfers, 1);
  assert.equal(atletico?.remainingChanges, 8);
  assert.equal(atletico?.movements.find((m) => m.player === 'Romagnoli')?.type, 'ESTERO');

  // Entrambi i file sono finestre di mercato: nessuno scambio va dedotto automaticamente.
  const movements = report.teams.flatMap((t) => t.movements);
  assert.equal(movements.filter((m) => m.type === 'SCAMBIO').length, 0);

  // I passaggi diretti tra squadre restano solo dei candidati da verificare a mano.
  assert.ok(report.tradeCandidates.length > 0);
  assert.ok(report.tradeCandidates.every((c) => c.from !== c.to && c.version === 2));

  assert.match(renderSummaryTable(report), /\| Squadra \| Operazioni \| Cambi Conteggiati \(Max 12\) \|/);
});

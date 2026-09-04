/**
 * API tests against a real listening server and a throwaway database.
 * No HTTP client dependency: Node 20 provides fetch, FormData and Blob.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { openDatabase, type Database } from '../src/api/db.js';
import { createServer } from '../src/api/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const input = (name: string) => resolve(here, '../../assets/input', name);

/**
 * `Response.json()` returns `unknown` under `strict`; these tests read fields off the payload
 * directly, so the widening is declared once here instead of at every call site.
 */
type JsonBody = any;

let server: Server;
let db: Database;
let baseUrl: string;
let dbDir: string;

before(async () => {
  dbDir = await mkdtemp(join(tmpdir(), 'fanta-db-'));
  db = await openDatabase(join(dbDir, 'db.json'));
  server = createServer(db).listen(0);
  await new Promise((done) => server.once('listening', done));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('indirizzo del server non disponibile');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  await rm(dbDir, { recursive: true, force: true });
});

/** Uploads a real `.xlsx`, optionally renaming it to exercise the file-name markers. */
async function upload(file: string, options: { as?: string; kind?: string; query?: string } = {}) {
  const body = new FormData();
  const bytes = await readFile(input(file));
  body.set('file', new Blob([new Uint8Array(bytes)]), options.as ?? file);
  if (options.as) body.set('source', options.as);
  if (options.kind) body.set('kind', options.kind);
  return fetch(`${baseUrl}/api/snapshots${options.query ?? ''}`, { method: 'POST', body });
}

test('health risponde anche a database vuoto', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json() as JsonBody, { status: 'ok', snapshots: 0 });
});

test('il report richiede almeno due snapshot', async () => {
  const response = await fetch(`${baseUrl}/api/report`);
  assert.equal(response.status, 409);
  assert.match((await response.json() as JsonBody).error, /almeno due file/);
});

test('upload dei due file reali e report completo', async () => {
  assert.equal((await upload('gufipersempre-1.xlsx')).status, 201);

  const second = await upload('gufipersempre-2.xlsx');
  assert.equal(second.status, 201);
  const meta = await second.json() as JsonBody;
  assert.equal(meta.version, 2);
  assert.equal(meta.kind, 'MERCATO');
  assert.equal(meta.teamCount, 10);
  assert.equal(meta.teams, undefined, 'la lista non deve trasportare le rose complete');

  const report = await (await fetch(`${baseUrl}/api/report`)).json() as JsonBody;
  const atletico = report.teams.find((t: { team: string }) => t.team === 'Atletico ma non troppo');
  assert.equal(report.maxChanges, 12);
  assert.equal(atletico.operations, 5);
  assert.equal(atletico.changes, 4);
  assert.equal(atletico.foreignTransfers, 1);
  assert.equal(atletico.remainingChanges, 8);
  assert.equal(report.tradeCandidates.length, 4);
});

test('il limite si può forzare dalla query senza toccare le impostazioni', async () => {
  const report = await (await fetch(`${baseUrl}/api/report?max=6`)).json() as JsonBody;
  const atletico = report.teams.find((t: { team: string }) => t.team === 'Atletico ma non troppo');
  assert.equal(report.maxChanges, 6);
  assert.equal(atletico.remainingChanges, 2);
  assert.equal((await (await fetch(`${baseUrl}/api/settings`)).json() as JsonBody).maxChanges, 12);
});

test('max non valido restituisce 400', async () => {
  assert.equal((await fetch(`${baseUrl}/api/report?max=-1`)).status, 400);
});

test('markdown restituisce la tabella pronta per Notion', async () => {
  const response = await fetch(`${baseUrl}/api/report/markdown?summaryOnly=true`);
  const body = await response.text();
  assert.match(response.headers.get('content-type') ?? '', /text\/markdown/);
  assert.match(body, /\| Squadra \| Operazioni \| Cambi Conteggiati \(Max 12\) \|/);
  assert.match(body, /\| Atletico ma non troppo \| 5 \| 4 \| 1 \| 0 \| 8 \|/);
});

test('una versione già caricata va in conflitto, e ?overwrite=true la sostituisce', async () => {
  const conflict = await upload('gufipersempre-2.xlsx');
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json() as JsonBody).error, /già caricata/);

  const replaced = await upload('gufipersempre-2.xlsx', { query: '?overwrite=true' });
  assert.equal(replaced.status, 200);
  assert.equal((await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody).length, 2);
});

test('PATCH kind riclassifica la finestra e azzera i cambi diventati scambi', async () => {
  const snapshots = await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody;
  const second = snapshots.find((s: { version: number }) => s.version === 2);

  const patched = await fetch(`${baseUrl}/api/snapshots/${second.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'SCAMBI' }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json() as JsonBody).kind, 'SCAMBI');

  const report = await (await fetch(`${baseUrl}/api/report`)).json() as JsonBody;
  const atletico = report.teams.find((t: { team: string }) => t.team === 'Atletico ma non troppo');
  // Delle 5 uscite: Ghedjemis diventa scambio (verso CSKLARISSA), Romagnoli resta estero,
  // le altre 3 restano cambi. `trades` conta solo le uscite: l'arrivo di Lobotka non vi rientra.
  assert.equal(atletico.trades, 1);
  assert.equal(atletico.changes, 3);
  assert.equal(atletico.foreignTransfers, 1);
  assert.equal(atletico.operations, 5);
  assert.equal(report.tradeCandidates.length, 0);

  // Ripristino per i test successivi.
  await fetch(`${baseUrl}/api/snapshots/${second.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'MERCATO' }),
  });
});

test('il marker nel nome file dichiara la finestra anche via upload', async () => {
  const response = await upload('gufipersempre-2.xlsx', { as: 'gufipersempre-scambi-3.xlsx' });
  assert.equal(response.status, 201);
  const meta = await response.json() as JsonBody;
  assert.equal(meta.version, 3);
  assert.equal(meta.kind, 'SCAMBI');

  await fetch(`${baseUrl}/api/snapshots/${meta.id}`, { method: 'DELETE' });
});

test('un nome file senza versione viene rifiutato con un messaggio utile', async () => {
  const response = await upload('gufipersempre-1.xlsx', { as: 'rose.xlsx' });
  assert.equal(response.status, 400);
  assert.match((await response.json() as JsonBody).error, /Impossibile dedurre la versione/);
});

test('kind non valido restituisce 400', async () => {
  const snapshots = await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody;
  const response = await fetch(`${baseUrl}/api/snapshots/${snapshots[0].id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'BOH' }),
  });
  assert.equal(response.status, 400);
});

test('un file non Excel produce 400 e non sporca il database', async () => {
  const body = new FormData();
  body.set('file', new Blob([new Uint8Array(Buffer.from('non sono un xlsx'))]), 'finto-9.xlsx');
  const response = await fetch(`${baseUrl}/api/snapshots`, { method: 'POST', body });

  assert.equal(response.status, 400);
  assert.equal((await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody).length, 2);
});

test('DELETE rimuove lo snapshot e 404 se non esiste', async () => {
  const snapshots = await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody;
  const target = snapshots[0];

  assert.equal((await fetch(`${baseUrl}/api/snapshots/${target.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/snapshots/${target.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await (await fetch(`${baseUrl}/api/snapshots`)).json() as JsonBody).length, 1);
});

test('le impostazioni si aggiornano e vengono persistite su disco', async () => {
  const response = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ maxChanges: 15 }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as JsonBody).maxChanges, 15);

  const reopened = await openDatabase(join(dbDir, 'db.json'));
  assert.equal(reopened.data.settings.maxChanges, 15);

  assert.equal(
    (
      await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxChanges: 'tanti' }),
      })
    ).status,
    400,
  );
});

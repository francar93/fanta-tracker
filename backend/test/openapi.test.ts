/**
 * Keeps the hand-written OpenAPI document honest.
 *
 * The spec is not generated from the code, so the real guarantee is here: these tests walk the
 * Express router and fail when a route exists without being described (or vice versa).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openDatabase } from '../src/api/db.js';
import { createServer } from '../src/api/server.js';
import { openApiDocument } from '../src/api/openapi.js';

type JsonBody = any;

let server: Server;
let baseUrl: string;
let dbDir: string;
let app: JsonBody;

before(async () => {
  dbDir = await mkdtemp(join(tmpdir(), 'fanta-openapi-'));
  const db = await openDatabase(join(dbDir, 'db.json'));
  app = createServer(db);
  server = app.listen(0);
  await new Promise((done) => server.once('listening', done));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('indirizzo del server non disponibile');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  await rm(dbDir, { recursive: true, force: true });
});

/** `GET /api/snapshots/:id` -> `get /api/snapshots/{id}`, the shape used as spec key. */
function registeredOperations(): Set<string> {
  const stack = app.router?.stack ?? app._router?.stack;
  assert.ok(Array.isArray(stack), 'router Express non ispezionabile: aggiornare questo test');

  const operations = new Set<string>();
  for (const layer of stack) {
    if (!layer.route) continue;
    const path = String(layer.route.path).replace(/:(\w+)/g, '{$1}');
    for (const [method, enabled] of Object.entries(layer.route.methods as Record<string, boolean>)) {
      if (enabled && method !== '_all') operations.add(`${method} ${path}`);
    }
  }
  return operations;
}

function documentedOperations(): Set<string> {
  const operations = new Set<string>();
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(item)) {
      if (method === 'parameters') continue;
      operations.add(`${method} ${path}`);
    }
  }
  return operations;
}

test('ogni rotta registrata è descritta nella spec, e viceversa', () => {
  const registered = registeredOperations();
  const documented = documentedOperations();

  assert.ok(registered.size > 0, 'nessuna rotta trovata nel router');
  assert.deepEqual(
    [...registered].filter((op) => !documented.has(op)).sort(),
    [],
    'rotte presenti nel codice ma assenti da openapi.ts',
  );
  assert.deepEqual(
    [...documented].filter((op) => !registered.has(op)).sort(),
    [],
    'rotte descritte in openapi.ts ma non registrate',
  );
});

test('ogni $ref punta a uno schema esistente', () => {
  const refs: string[] = [];
  JSON.stringify(openApiDocument, (key, value) => {
    if (key === '$ref') refs.push(String(value));
    return value;
  });

  const schemas = new Set(Object.keys(openApiDocument.components.schemas));
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const name = ref.replace('#/components/schemas/', '');
    assert.ok(schemas.has(name), `$ref non risolvibile: ${ref}`);
  }
});

test('ogni operazione ha operationId univoco, tag e summary', () => {
  const ids = new Set<string>();
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const [method, operation] of Object.entries(item as Record<string, JsonBody>)) {
      if (method === 'parameters') continue;
      const where = `${method.toUpperCase()} ${path}`;
      assert.ok(operation.summary, `${where}: manca summary`);
      assert.ok(operation.tags?.length, `${where}: mancano i tag`);
      assert.ok(operation.operationId, `${where}: manca operationId`);
      assert.ok(!ids.has(operation.operationId), `${where}: operationId duplicato`);
      ids.add(operation.operationId);
    }
  }
});

test('i tag usati sono dichiarati in testa al documento', () => {
  const declared = new Set(openApiDocument.tags.map((tag) => tag.name));
  for (const item of Object.values(openApiDocument.paths)) {
    for (const [method, operation] of Object.entries(item as Record<string, JsonBody>)) {
      if (method === 'parameters') continue;
      for (const tag of operation.tags) assert.ok(declared.has(tag), `tag non dichiarato: ${tag}`);
    }
  }
});

test('GET /api/openapi.json serve il documento', async () => {
  const response = await fetch(`${baseUrl}/api/openapi.json`);
  const body = (await response.json()) as JsonBody;

  assert.equal(response.status, 200);
  assert.equal(body.openapi, '3.1.0');
  assert.equal(body.info.title, 'FantaTracker API');
  assert.ok(body.paths['/api/report']);
});

test('la UI Swagger risponde su /api/docs', async () => {
  const response = await fetch(`${baseUrl}/api/docs/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await response.text(), /swagger/i);
});

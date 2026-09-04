/**
 * REST API over the core engine.
 *
 * The engine stays pure: this layer only handles HTTP, validation and persistence.
 *
 *   GET    /api/health
 *   GET    /api/settings                 leggi il limite stagionale
 *   PUT    /api/settings                 { maxChanges }
 *   GET    /api/snapshots                elenco dei file caricati
 *   POST   /api/snapshots                upload .xlsx (multipart, campo `file`)
 *   PATCH  /api/snapshots/:id            { kind } — "si tratta di scambi o di mercato?"
 *   DELETE /api/snapshots/:id
 *   GET    /api/report                   report stagionale in JSON
 *   GET    /api/report/markdown          tabella "Copia per Notion"
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';
import { randomUUID } from 'node:crypto';
import { analyzeSeason } from '../core/engine.js';
import { ParseError, describeFileName, parseRosterBuffer } from '../core/parser.js';
import { renderReport, renderSummaryTable } from '../core/markdown.js';
import type { SnapshotKind } from '../core/types.js';
import { summarize, toRosterSnapshot, type Database, type StoredSnapshot } from './db.js';

/** Uploads are parsed in memory: the `.xlsx` itself is never written to disk. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const VALID_KINDS: SnapshotKind[] = ['MERCATO', 'SCAMBI'];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createServer(db: Database): express.Express {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

  app.use(express.json());

  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: 'FantaTracker API' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', snapshots: db.data.snapshots.length });
  });

  app.get('/api/settings', (_req, res) => {
    res.json(db.data.settings);
  });

  app.put(
    '/api/settings',
    handle(async (req, res) => {
      const maxChanges = Number((req.body as { maxChanges?: unknown }).maxChanges);
      if (!Number.isInteger(maxChanges) || maxChanges < 0) {
        throw new HttpError(400, 'maxChanges deve essere un intero non negativo');
      }
      db.data.settings.maxChanges = maxChanges;
      await db.write();
      res.json(db.data.settings);
    }),
  );

  app.get('/api/snapshots', (_req, res) => {
    res.json(ordered(db).map(summarize));
  });

  app.post(
    '/api/snapshots',
    upload.single('file'),
    handle(async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, 'File mancante: usa un multipart/form-data con campo "file"');

      const source = req.body?.source ?? file.originalname;
      const kind = readKind(req.body?.kind) ?? describeFileName(source).kind;
      const version = readVersion(req.body?.version) ?? describeFileName(source).version;
      if (version <= 0) {
        throw new HttpError(
          400,
          `Impossibile dedurre la versione da "${source}": rinomina il file (es. nome-2.xlsx) o passa il campo "version".`,
        );
      }

      const existing = db.data.snapshots.find((snapshot) => snapshot.version === version);
      const overwrite = req.query['overwrite'] === 'true';
      if (existing && !overwrite) {
        throw new HttpError(
          409,
          `La versione ${version} è già caricata da "${existing.source}". Rilancia con ?overwrite=true per sostituirla.`,
        );
      }

      const parsed = await readUpload(file.buffer, source, kind, version);
      const stored: StoredSnapshot = {
        id: existing?.id ?? randomUUID(),
        version,
        kind,
        source,
        uploadedAt: new Date().toISOString(),
        teams: parsed.teams,
      };

      db.data.snapshots = [...db.data.snapshots.filter((s) => s.version !== version), stored];
      await db.write();
      res.status(existing ? 200 : 201).json(summarize(stored));
    }),
  );

  app.patch(
    '/api/snapshots/:id',
    handle(async (req, res) => {
      const snapshot = db.data.snapshots.find((s) => s.id === req.params.id);
      if (!snapshot) throw new HttpError(404, 'Snapshot non trovato');

      const kind = readKind((req.body as { kind?: unknown }).kind);
      if (!kind) throw new HttpError(400, `kind deve essere uno tra: ${VALID_KINDS.join(', ')}`);

      snapshot.kind = kind;
      await db.write();
      res.json(summarize(snapshot));
    }),
  );

  app.delete(
    '/api/snapshots/:id',
    handle(async (req, res) => {
      const before = db.data.snapshots.length;
      db.data.snapshots = db.data.snapshots.filter((s) => s.id !== req.params.id);
      if (db.data.snapshots.length === before) throw new HttpError(404, 'Snapshot non trovato');
      await db.write();
      res.status(204).end();
    }),
  );

  app.get(
    '/api/report',
    handle(async (req, res) => {
      res.json(buildReport(db, req));
    }),
  );

  app.get(
    '/api/report/markdown',
    handle(async (req, res) => {
      const report = buildReport(db, req);
      const body =
        req.query['summaryOnly'] === 'true'
          ? renderSummaryTable(report)
          : renderReport(report, report.warnings, report.tradeCandidates);
      res.type('text/markdown; charset=utf-8').send(body);
    }),
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof ParseError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload non valido: ${error.message}` });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Errore interno' });
  });

  return app;
}

/**
 * Parses an upload, turning any reader failure into a 400.
 * A corrupt or non-Excel payload is bad input, not a server fault: exceljs throws plain `Error`s
 * (zip errors, missing parts) that would otherwise surface as a 500.
 */
async function readUpload(buffer: Buffer, source: string, kind: SnapshotKind, version: number) {
  try {
    return await parseRosterBuffer(buffer, source, { kind, version });
  } catch (error) {
    if (error instanceof ParseError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `"${source}" non è un file .xlsx leggibile: ${detail}`);
  }
}

/** Runs the engine over everything persisted, honouring an optional `?max=` override. */
function buildReport(db: Database, req: Request) {
  const snapshots = ordered(db).map(toRosterSnapshot);
  if (snapshots.length < 2) {
    throw new HttpError(409, `Servono almeno due file per calcolare un delta (caricati: ${snapshots.length}).`);
  }
  return analyzeSeason(snapshots, { maxChanges: readMax(req) ?? db.data.settings.maxChanges });
}

function ordered(db: Database): StoredSnapshot[] {
  return [...db.data.snapshots].sort((a, b) => a.version - b.version);
}

function readMax(req: Request): number | undefined {
  const raw = req.query['max'];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, 'max deve essere un intero non negativo');
  return value;
}

function readKind(value: unknown): SnapshotKind | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase() as SnapshotKind;
  return VALID_KINDS.includes(upper) ? upper : undefined;
}

function readVersion(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, 'version deve essere un intero positivo');
  return parsed;
}

/** Express 5 forwards rejected promises, but wrapping keeps the intent explicit. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

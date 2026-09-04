/**
 * OpenAPI 3.1 description of the REST API.
 *
 * Hand-written on purpose: the routes are plain Express handlers, and a generated spec would mean
 * dragging in a decorator framework. The risk of drift is covered by a test that walks the Express
 * router and fails when a route is missing here (`test/openapi.test.ts`) — so this document must be
 * updated in the same change that adds or renames a route.
 */

const SNAPSHOT_KIND = {
  type: 'string',
  enum: ['MERCATO', 'SCAMBI'],
  description: 'Natura della finestra rispetto allo snapshot precedente.',
} as const;

const MOVEMENT_TYPE = {
  type: 'string',
  enum: ['SCAMBIO', 'ESTERO', 'CAMBIO', 'SVINCOLO'],
} as const;

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'FantaTracker API',
    version: '0.1.0',
    description:
      "Tracciamento dei cambi di mercato di una lega di Fantacalcio.\n\n" +
      "Il conteggio è **sul lato uscita**: `changes` è già al netto delle operazioni esenti " +
      "(estero e scambi), quindi `remainingChanges = maxChanges - changes`. Non risommare le " +
      'colonne degli esenti, o l\'esenzione verrebbe concessa due volte.\n\n' +
      "L'Excel non permette di distinguere uno scambio concordato da una compravendita: la natura " +
      'della finestra si dichiara nel nome del file (`nome-scambi-3.xlsx`) oppure con `kind`.',
  },
  servers: [{ url: '/', description: 'Server corrente' }],
  tags: [
    { name: 'Servizio', description: 'Stato e impostazioni della lega' },
    { name: 'Snapshot', description: 'Caricamento e gestione dei file rosa' },
    { name: 'Report', description: 'Calcolo dei cambi stagionali' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Servizio'],
        summary: 'Stato del servizio',
        operationId: 'getHealth',
        responses: {
          200: json('Servizio attivo', {
            type: 'object',
            required: ['status', 'snapshots'],
            properties: {
              status: { type: 'string', example: 'ok' },
              snapshots: { type: 'integer', description: 'Numero di snapshot caricati.' },
            },
          }),
        },
      },
    },
    '/api/settings': {
      get: {
        tags: ['Servizio'],
        summary: 'Leggi il limite stagionale',
        operationId: 'getSettings',
        responses: { 200: ref('Impostazioni correnti', 'Settings') },
      },
      put: {
        tags: ['Servizio'],
        summary: 'Imposta il limite stagionale',
        operationId: 'updateSettings',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Settings' } } },
        },
        responses: {
          200: ref('Impostazioni aggiornate', 'Settings'),
          400: errorResponse('`maxChanges` non è un intero non negativo'),
        },
      },
    },
    '/api/snapshots': {
      get: {
        tags: ['Snapshot'],
        summary: 'Elenco dei file caricati',
        description: 'Restituisce solo i metadati: le rose complete non viaggiano in lista.',
        operationId: 'listSnapshots',
        responses: {
          200: json('Snapshot ordinati per versione', {
            type: 'array',
            items: { $ref: '#/components/schemas/SnapshotSummary' },
          }),
        },
      },
      post: {
        tags: ['Snapshot'],
        summary: 'Carica un file rosa',
        description:
          'Il file viene interpretato subito e salvato già parsato: l\'`.xlsx` non viene conservato.\n\n' +
          'Versione e natura della finestra si deducono dal nome (`gufipersempre-scambi-3.xlsx`); ' +
          '`kind` e `version` nel form hanno la precedenza — è così che la UI pone la domanda ' +
          '"si tratta di scambi o di mercato?" senza obbligare a rinominare il file.',
        operationId: 'uploadSnapshot',
        parameters: [
          {
            name: 'overwrite',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description: 'Sostituisce lo snapshot con la stessa versione invece di rispondere 409.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: 'File .xlsx (max 10 MB).' },
                  source: { type: 'string', description: 'Nome da usare al posto di quello del file caricato.' },
                  kind: SNAPSHOT_KIND,
                  version: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          201: ref('Snapshot creato', 'SnapshotSummary'),
          200: ref('Snapshot sostituito (`overwrite=true`)', 'SnapshotSummary'),
          400: errorResponse('File mancante, illeggibile, o versione non deducibile dal nome'),
          409: errorResponse('Versione già caricata: usa `?overwrite=true`'),
        },
      },
    },
    '/api/snapshots/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        tags: ['Snapshot'],
        summary: 'Riclassifica la finestra (mercato o scambi)',
        description:
          'Cambia la natura di uno snapshot già caricato senza doverlo rinominare né ricaricare. ' +
          'Il report viene ricalcolato di conseguenza alla richiesta successiva.',
        operationId: 'updateSnapshotKind',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['kind'], properties: { kind: SNAPSHOT_KIND } },
            },
          },
        },
        responses: {
          200: ref('Snapshot aggiornato', 'SnapshotSummary'),
          400: errorResponse('`kind` non valido'),
          404: errorResponse('Snapshot non trovato'),
        },
      },
      delete: {
        tags: ['Snapshot'],
        summary: 'Elimina un caricamento',
        operationId: 'deleteSnapshot',
        responses: {
          204: { description: 'Snapshot eliminato' },
          404: errorResponse('Snapshot non trovato'),
        },
      },
    },
    '/api/report': {
      get: {
        tags: ['Report'],
        summary: 'Report stagionale in JSON',
        operationId: 'getReport',
        parameters: [maxParameter()],
        responses: {
          200: ref('Report calcolato', 'SeasonReport'),
          400: errorResponse('`max` non valido'),
          409: errorResponse('Servono almeno due snapshot per calcolare un delta'),
        },
      },
    },
    '/api/report/markdown': {
      get: {
        tags: ['Report'],
        summary: 'Report in Markdown, pronto per Notion',
        operationId: 'getReportMarkdown',
        parameters: [
          maxParameter(),
          {
            name: 'summaryOnly',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description: 'Restituisce solo la tabella di riepilogo, senza dettaglio e segnalazioni.',
          },
        ],
        responses: {
          200: {
            description: 'Tabella Markdown',
            content: { 'text/markdown': { schema: { type: 'string' } } },
          },
          400: errorResponse('`max` non valido'),
          409: errorResponse('Servono almeno due snapshot per calcolare un delta'),
        },
      },
    },
    '/api/openapi.json': {
      get: {
        tags: ['Servizio'],
        summary: 'Questo documento OpenAPI',
        operationId: 'getOpenApi',
        responses: { 200: json('Documento OpenAPI 3.1', { type: 'object' }) },
      },
    },
  },
  components: {
    schemas: {
      Settings: {
        type: 'object',
        required: ['maxChanges'],
        properties: {
          maxChanges: { type: 'integer', minimum: 0, default: 12, description: 'Limite stagionale di cambi.' },
        },
      },
      SnapshotSummary: {
        type: 'object',
        required: ['id', 'version', 'kind', 'source', 'uploadedAt', 'teamCount'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          version: { type: 'integer', description: 'Posizione nella cascata; deriva dal suffisso del nome file.' },
          kind: SNAPSHOT_KIND,
          source: { type: 'string', example: 'gufipersempre-2.xlsx' },
          uploadedAt: { type: 'string', format: 'date-time' },
          teamCount: { type: 'integer' },
        },
      },
      Movement: {
        type: 'object',
        required: ['team', 'player', 'cost', 'direction', 'type', 'counterparty', 'version', 'countsAsChange'],
        properties: {
          team: { type: 'string' },
          player: { type: 'string' },
          cost: { type: 'integer' },
          direction: { type: 'string', enum: ['OUT', 'IN'] },
          type: MOVEMENT_TYPE,
          counterparty: { type: ['string', 'null'], description: "L'altra squadra, negli scambi." },
          version: { type: 'integer' },
          countsAsChange: {
            type: 'boolean',
            description: 'Unica fonte di verità del conteggio: solo le uscite non esenti sono `true`.',
          },
        },
      },
      TeamReport: {
        type: 'object',
        required: ['team', 'operations', 'changes', 'foreignTransfers', 'trades', 'remainingChanges', 'overLimit', 'movements'],
        properties: {
          team: { type: 'string' },
          operations: {
            type: 'integer',
            description: 'Tutte le uscite, esenti incluse: `changes + foreignTransfers + trades`.',
          },
          changes: { type: 'integer', description: 'Uscite che erodono il budget, già al netto degli esenti.' },
          foreignTransfers: { type: 'integer', description: 'Uscite esenti per asterisco (estero).' },
          trades: { type: 'integer', description: 'Uscite esenti perché scambi dichiarati.' },
          remainingChanges: { type: 'integer', description: '`max(0, maxChanges - changes)`.' },
          overLimit: { type: 'boolean' },
          movements: { type: 'array', items: { $ref: '#/components/schemas/Movement' } },
        },
      },
      TradeCandidate: {
        type: 'object',
        required: ['version', 'player', 'from', 'to'],
        description:
          'Movimento che sembra uno scambio ma è avvenuto in una finestra di mercato: conta come ' +
          'cambio, ed è segnalato per far notare un file dichiarato male.',
        properties: {
          version: { type: 'integer' },
          player: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
      SeasonReport: {
        type: 'object',
        required: ['maxChanges', 'versions', 'windows', 'teams', 'tradeCandidates', 'warnings'],
        properties: {
          maxChanges: { type: 'integer' },
          versions: { type: 'array', items: { type: 'integer' } },
          windows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['version', 'kind', 'source'],
              properties: { version: { type: 'integer' }, kind: SNAPSHOT_KIND, source: { type: 'string' } },
            },
          },
          teams: { type: 'array', items: { $ref: '#/components/schemas/TeamReport' } },
          tradeCandidates: { type: 'array', items: { $ref: '#/components/schemas/TradeCandidate' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
    },
  },
} as const;

function maxParameter() {
  return {
    name: 'max',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 0 },
    description: 'Sovrascrive il limite stagionale solo per questa risposta, senza salvarlo.',
  } as const;
}

function json(description: string, schema: object) {
  return { description, content: { 'application/json': { schema } } };
}

function ref(description: string, schema: string) {
  return json(description, { $ref: `#/components/schemas/${schema}` });
}

function errorResponse(description: string) {
  return ref(description, 'Error');
}

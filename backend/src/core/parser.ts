/**
 * Excel parser for the official league roster export.
 *
 * Layout (verified against `assets/input/gufipersempre-*.xlsx`):
 *   - single sheet named `ROSE`
 *   - teams laid out in column groups of 3: name column, `costo` column, empty separator
 *   - row 1 holds the team name and the literal `costo`
 *   - following rows hold `player | cost`
 *   - the group ends at the literal `totale` row, which is a sum and not a player
 *
 * Neither the number of teams nor the number of players is hardcoded: both are discovered
 * by scanning the header row and stopping at the `totale` marker.
 */

import ExcelJS from 'exceljs';
import { collapseSpaces, parsePlayerName } from './normalize.js';
import type { Player, RosterSnapshot, SnapshotKind, TeamRoster } from './types.js';

/** Default worksheet name of the official export. */
export const DEFAULT_SHEET_NAME = 'ROSE';

const COST_HEADER = 'costo';
const TOTAL_MARKER = 'totale';
const EXCEL_MAX_COLUMNS = 16384;

export interface ParseOptions {
  /** Worksheet to read. Defaults to `ROSE`; falls back to the first sheet when missing. */
  sheetName?: string;
  /** Version number to attach to the snapshot. Defaults to the `-N` suffix of the file name. */
  version?: number;
  /**
   * Nature of the window. Defaults to the `scambi` marker in the file name.
   * The web UI passes this explicitly ("si tratta di scambi o di mercato?"), overriding the name.
   */
  kind?: SnapshotKind;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Reads an `.xlsx` file from disk and returns the parsed snapshot. */
export async function parseRosterFile(filePath: string, options: ParseOptions = {}): Promise<RosterSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return snapshotFromWorkbook(workbook, contextFor(basename(filePath), options));
}

/** Reads an `.xlsx` buffer (e.g. an HTTP upload) and returns the parsed snapshot. */
export async function parseRosterBuffer(
  buffer: Buffer | ArrayBuffer,
  source: string,
  options: ParseOptions = {},
): Promise<RosterSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  return snapshotFromWorkbook(workbook, contextFor(source, options));
}

interface SnapshotContext {
  source: string;
  version: number;
  kind: SnapshotKind;
  sheetName?: string;
}

function contextFor(source: string, options: ParseOptions): SnapshotContext {
  const fromName = describeFileName(source);
  return {
    source,
    version: options.version ?? fromName.version,
    kind: options.kind ?? fromName.kind,
    ...pick(options, 'sheetName'),
  };
}

function snapshotFromWorkbook(workbook: ExcelJS.Workbook, ctx: SnapshotContext): RosterSnapshot {
  const wanted = ctx.sheetName ?? DEFAULT_SHEET_NAME;
  const sheet = workbook.getWorksheet(wanted) ?? workbook.worksheets[0];
  if (!sheet) {
    throw new ParseError(`${ctx.source}: nessun foglio trovato (atteso "${wanted}")`);
  }

  const teams = readTeams(sheet, ctx.source);
  if (teams.length === 0) {
    throw new ParseError(`${ctx.source}: nessuna squadra riconosciuta nella riga di intestazione`);
  }

  return { version: ctx.version, kind: ctx.kind, source: ctx.source, teams };
}

/** Scans the header row for `<team> | costo` pairs and reads each group's players. */
function readTeams(sheet: ExcelJS.Worksheet, source: string): TeamRoster[] {
  const header = sheet.getRow(1);
  const teams: TeamRoster[] = [];
  const seen = new Set<string>();

  // `cellCount` can report Excel's absolute maximum: clamp to the sheet's real width and
  // leave room for the `costo` column read at `col + 1`.
  const lastColumn = Math.min(sheet.columnCount || header.cellCount, EXCEL_MAX_COLUMNS) - 1;

  for (let col = 1; col <= lastColumn; col += 1) {
    const label = cellText(header.getCell(col));
    const next = cellText(header.getCell(col + 1));
    if (!label || next.toLowerCase() !== COST_HEADER) continue;

    if (seen.has(label)) {
      throw new ParseError(`${source}: squadra duplicata nell'intestazione ("${label}")`);
    }
    seen.add(label);
    teams.push(readTeam(sheet, label, col, source));
  }

  return teams;
}

function readTeam(sheet: ExcelJS.Worksheet, team: string, nameCol: number, source: string): TeamRoster {
  const players: Player[] = [];
  const keys = new Set<string>();
  let declaredTotal: number | null = null;

  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const rawName = cellText(sheet.getRow(row).getCell(nameCol));
    const rawCost = sheet.getRow(row).getCell(nameCol + 1);

    if (!rawName) continue;

    if (rawName.toLowerCase() === TOTAL_MARKER) {
      declaredTotal = cellNumber(rawCost);
      break;
    }

    const { name, key, foreign } = parsePlayerName(rawName);
    if (keys.has(key)) {
      throw new ParseError(`${source} / ${team}: giocatore duplicato in rosa ("${name}")`);
    }
    keys.add(key);
    players.push({ name, key, cost: cellNumber(rawCost) ?? 0, foreign });
  }

  return { team, players, declaredTotal };
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'result' in value) {
    return collapseSpaces(String((value as ExcelJS.CellFormulaValue).result ?? ''));
  }
  if (typeof value === 'object' && 'richText' in value) {
    return collapseSpaces((value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join(''));
  }
  return collapseSpaces(String(value));
}

function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  const text = cellText(cell);
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** File name tokens that declare a trade window. */
const TRADE_MARKERS = ['scambi', 'scambio', 'trade', 'trades'];

/**
 * Reads the cascade version and the window nature out of the file name.
 *
 *   gufipersempre-2.xlsx         -> { version: 2, kind: 'MERCATO' }
 *   gufipersempre-scambi-3.xlsx  -> { version: 3, kind: 'SCAMBI' }
 *   gufipersempre-3-scambi.xlsx  -> { version: 3, kind: 'SCAMBI' }
 *
 * Version falls back to 0 when there is no numeric suffix, so callers can still order manually.
 */
export function describeFileName(fileName: string): { version: number; kind: SnapshotKind } {
  return { version: versionFromFileName(fileName), kind: kindFromFileName(fileName) };
}

/** Extracts the cascade version from the numeric token of the file name (`...-2.xlsx` -> 2). */
export function versionFromFileName(fileName: string): number {
  const stem = stripExtension(fileName);
  // Last numeric token wins, so both `-scambi-3` and `-3-scambi` resolve to 3.
  const numbers = stem.split('-').filter((token) => /^\d+$/.test(token.trim()));
  const last = numbers[numbers.length - 1];
  return last ? Number(last) : 0;
}

/** Detects the `scambi` marker in the file name. Defaults to an ordinary transfer window. */
export function kindFromFileName(fileName: string): SnapshotKind {
  const tokens = stripExtension(fileName)
    .toLowerCase()
    .split('-')
    .map((token) => token.trim());
  return tokens.some((token) => TRADE_MARKERS.includes(token)) ? 'SCAMBI' : 'MERCATO';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

function pick<T extends object, K extends keyof T>(source: T, key: K): Partial<Pick<T, K>> {
  return source[key] === undefined ? {} : ({ [key]: source[key] } as Pick<T, K>);
}

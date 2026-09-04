/**
 * CLI entry point for the core engine.
 *
 *   npm run analyze -- ../assets/input                 # every .xlsx in a directory
 *   npm run analyze -- file-1.xlsx file-2.xlsx         # explicit files
 *   npm run analyze -- ../assets/input --max 15 --json # custom limit, JSON output
 */

import { readdir, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { analyzeSeason, DEFAULT_MAX_CHANGES } from '../core/engine.js';
import { parseRosterFile } from '../core/parser.js';
import { renderReport } from '../core/markdown.js';
import type { RosterSnapshot } from '../core/types.js';

interface CliArgs {
  paths: string[];
  maxChanges: number;
  json: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.paths.length === 0) {
    console.error('Uso: npm run analyze -- <cartella|file.xlsx ...> [--max N] [--json]');
    process.exitCode = 1;
    return;
  }

  const files = await expandPaths(args.paths);
  if (files.length < 2) {
    console.error(`Servono almeno due file .xlsx per calcolare un delta (trovati: ${files.length}).`);
    process.exitCode = 1;
    return;
  }

  const snapshots: RosterSnapshot[] = [];
  for (const file of files) {
    snapshots.push(await parseRosterFile(file));
  }

  const result = analyzeSeason(snapshots, { maxChanges: args.maxChanges });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderReport(result, result.warnings, result.tradeCandidates));
}

function parseArgs(argv: string[]): CliArgs {
  const paths: string[] = [];
  let maxChanges = DEFAULT_MAX_CHANGES;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--json') {
      json = true;
    } else if (arg === '--max') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--max richiede un intero positivo');
      }
      maxChanges = value;
    } else {
      paths.push(arg);
    }
  }

  return { paths, maxChanges, json };
}

/**
 * Turns directories into their `.xlsx` children; passes files through unchanged.
 *
 * Paths are resolved against `INIT_CWD` — the directory the user actually ran the command from —
 * because npm workspaces run the script with the workspace as cwd.
 */
async function expandPaths(paths: string[]): Promise<string[]> {
  const baseDir = process.env['INIT_CWD'] ?? process.cwd();
  const files: string[] = [];
  for (const rawPath of paths) {
    const path = resolve(baseDir, rawPath);
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = await readdir(path);
      for (const entry of entries.sort()) {
        if (extname(entry).toLowerCase() === '.xlsx' && !entry.startsWith('~$')) {
          files.push(join(path, entry));
        }
      }
    } else {
      files.push(path);
    }
  }
  return files;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

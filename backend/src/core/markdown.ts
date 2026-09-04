/**
 * Notion-ready Markdown rendering of the season report.
 * User-facing strings are in Italian on purpose (see CLAUDE.md).
 */

import type { Movement, SeasonReport, TradeCandidate } from './types.js';

/** Summary table, one row per team — the output of the "Copia per Notion" button. */
export function renderSummaryTable(report: SeasonReport): string {
  const lines = [
    `| Squadra | Cambi Totali (Max ${report.maxChanges}) | Trasferimenti Estero (*) | Cambi Rimanenti |`,
    '| :--- | :---: | :---: | :---: |',
  ];

  for (const team of report.teams) {
    lines.push(`| ${escapePipes(team.team)} | ${team.changes} | ${team.foreignTransfers} | ${team.remainingChanges} |`);
  }

  return lines.join('\n');
}

/** Movement-by-movement detail, grouped by team. Useful for the dashboard and for debugging. */
export function renderMovementsTable(report: SeasonReport): string {
  const lines = ['| Squadra | Ver. | Giocatore | Costo | Movimento | Tipologia | Controparte |', '| :--- | :---: | :--- | :---: | :---: | :--- | :--- |'];

  for (const team of report.teams) {
    for (const move of team.movements) {
      lines.push(
        `| ${escapePipes(move.team)} | ${move.version} | ${escapePipes(move.player)} | ${move.cost} | ${label(move)} | ${move.type} | ${escapePipes(move.counterparty ?? '—')} |`,
      );
    }
  }

  return lines.join('\n');
}

/** Recap of the analyzed windows and how each one was declared. */
export function renderWindowsList(report: SeasonReport): string {
  return report.windows
    .map(({ version, kind, source }) => `- Versione ${version} — **${kindLabel(kind)}** (\`${source}\`)`)
    .join('\n');
}

/**
 * Movements that look like a trade but happened in a `MERCATO` window.
 * They count as changes: this section exists so a mislabeled file gets noticed.
 */
export function renderTradeCandidates(candidates: TradeCandidate[]): string {
  const lines = ['| Ver. | Giocatore | Da | A |', '| :---: | :--- | :--- | :--- |'];
  for (const candidate of candidates) {
    lines.push(`| ${candidate.version} | ${escapePipes(candidate.player)} | ${escapePipes(candidate.from)} | ${escapePipes(candidate.to)} |`);
  }
  return lines.join('\n');
}

/** Full report: windows, summary, detail, trade candidates and warnings. */
export function renderReport(report: SeasonReport, warnings: string[] = [], candidates: TradeCandidate[] = []): string {
  const sections = [
    '## Finestre analizzate',
    renderWindowsList(report),
    '',
    '## Riepilogo cambi',
    renderSummaryTable(report),
    '',
    '## Dettaglio movimenti',
    renderMovementsTable(report),
  ];

  if (candidates.length > 0) {
    sections.push(
      '',
      '## Possibili scambi non dichiarati',
      'Questi movimenti sono conteggiati come cambi. Se erano scambi, rinomina il file con il marker `scambi` (es. `nome-scambi-3.xlsx`) e rilancia l\'analisi.',
      '',
      renderTradeCandidates(candidates),
    );
  }

  if (warnings.length > 0) {
    sections.push('', '## Segnalazioni', ...warnings.map((warning) => `- ${warning}`));
  }

  return sections.join('\n');
}

function kindLabel(kind: SeasonReport['windows'][number]['kind']): string {
  return kind === 'SCAMBI' ? 'Scambi' : 'Mercato';
}

function label(move: Movement): string {
  return move.direction === 'OUT' ? 'Uscita' : 'Entrata';
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, '\\|');
}

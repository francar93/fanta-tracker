/** Public surface of the FantaTracker core engine (pure: no Express, no filesystem coupling). */

export * from './types.js';
export { buildKey, collapseSpaces, parsePlayerName } from './normalize.js';
export {
  DEFAULT_SHEET_NAME,
  ParseError,
  describeFileName,
  kindFromFileName,
  parseRosterBuffer,
  parseRosterFile,
  versionFromFileName,
} from './parser.js';
export { diffSnapshots } from './diff.js';
export type { StepDiff } from './diff.js';
export { DEFAULT_MAX_CHANGES, analyzeSeason } from './engine.js';
export type { AnalysisResult } from './engine.js';
export { renderMovementsTable, renderReport, renderSummaryTable, renderTradeCandidates, renderWindowsList } from './markdown.js';

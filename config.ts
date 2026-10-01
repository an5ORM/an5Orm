/**
 * Workspace Configuration for an5Orm
 *
 * Re-exported from the generator so the CLI commands and the generator agree on
 * one config shape. These files used to load an5Orm.config.js themselves with
 * `any`, which meant the four of them could disagree about what was valid.
 */
export {
  loadConfig,
  validateConfig,
  resolveOutputs,
  resolveConnectionString,
  formatIssues,
  ConfigError,
  DEFAULT_CONFIG,
} from './generator/src/config';

export type {
  An5OrmConfig,
  TypeScriptOutput,
  ResolvedOutputs,
  LoadedConfig,
  ConfigIssue,
} from './generator/src/config';

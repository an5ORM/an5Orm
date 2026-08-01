/**
 * Workspace Configuration for an5Orm
 * Reads from an5Orm.config.js and environment variables.
 */
import path from 'path';

let workspaceConfig: any = {};
try {
  const configPath = path.join(__dirname, '..', 'an5Orm.config.js');
  workspaceConfig = require(configPath);
} catch { /* ignore */ }

export const config = {
  ...workspaceConfig,
  llm: workspaceConfig.llm || {
    providers: [],
  },
};

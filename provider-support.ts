import { PROVIDER_LABELS, Provider } from './generator/src/field-types';

/**
 * Which commands can only run against SQL Server.
 *
 * `db:push` is not among them: it goes through the dialect layer in
 * `./generator/src/dialect`, so it writes the DDL each provider understands.
 * `db:pull` and `db:cleanup` do not — they read SQL Server catalogs, quote
 * identifiers with brackets, and emit T-SQL. Running them against another database
 * fails on the first catalog query with a driver error that says nothing about the
 * real problem, or worse, half-applies a change before it does. So the provider is
 * checked up front, where the message can name it.
 *
 * Not a reason to narrow the type tables though: the tables describe what each
 * provider accepts, which is what the generated client and the schema files must
 * stay within, whoever runs the commands.
 */
export const SQL_SERVER_ONLY_COMMANDS: Record<string, string> = {
  'db:pull': 'read the catalog and write schema files',
  'db:cleanup': 'drop tables and foreign keys that are no longer in the schema',
};

/**
 * Why a command cannot run against this provider, or null when it can.
 *
 * Returns the message instead of printing it and exiting, so this stays a plain
 * function: it is shared by command files, and a module that calls
 * `process.exit` cannot be imported outside a Node CLI — nor unit tested for the
 * thing it exists to say.
 */
export function sqlServerOnlyError(provider: Provider, command: string): string | null {
  if (provider === 'mssql') return null;
  const what = SQL_SERVER_ONLY_COMMANDS[command] ?? 'run';
  return (
    `❌ ${command} only supports SQL Server, but the connection string selects ` +
    `${PROVIDER_LABELS[provider]}.\n` +
    `   ${command} ${what} using sys.* catalog views and T-SQL, so pointing it at ` +
    `${PROVIDER_LABELS[provider]} would run the wrong SQL.\n` +
    '   Use a SQL Server connection string, or generate and apply the schema with ' +
    `${PROVIDER_LABELS[provider]}'s own tooling.`
  );
}

export function migrationProviderError(provider: Provider, command: string): string | null {
  if (provider === 'mssql' || provider === 'postgres') return null;
  return (
    `❌ ${command} currently supports SQL Server and PostgreSQL, but the connection string selects ` +
    `${PROVIDER_LABELS[provider]}.\n` +
    `   ${command} requires relational DDL and a transaction-scoped migration lock; ` +
    `${PROVIDER_LABELS[provider]} is not supported by the migration engine yet.`
  );
}
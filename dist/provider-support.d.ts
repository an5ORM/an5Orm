import { Provider } from './generator/src/field-types';
/**
 * Which commands can only run against SQL Server.
 *
 * `db:push` is not among them: it goes through the dialect layer in
 * `./generator/src/dialect`, so it writes the DDL each provider understands. These
 * three do not — they read `sys.tables`/`sys.columns`/`sys.foreign_keys`, quote
 * identifiers with brackets, and emit T-SQL. Running them against another database
 * fails on the first catalog query with a driver error that says nothing about the
 * real problem, or worse, half-applies a change before it does. So the provider is
 * checked up front, where the message can name it.
 *
 * Not a reason to narrow the type tables though: the tables describe what each
 * provider accepts, which is what the generated client and the schema files must
 * stay within, whoever runs the commands.
 */
export declare const SQL_SERVER_ONLY_COMMANDS: Record<string, string>;
/**
 * Why a command cannot run against this provider, or null when it can.
 *
 * Returns the message instead of printing it and exiting, so this stays a plain
 * function: it is shared by four command files, and a module that calls
 * `process.exit` cannot be imported outside a Node CLI — nor unit tested for the
 * thing it exists to say.
 */
export declare function sqlServerOnlyError(provider: Provider, command: string): string | null;
//# sourceMappingURL=provider-support.d.ts.map
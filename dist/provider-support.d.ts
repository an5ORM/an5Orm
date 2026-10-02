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
 * Stops a command that only speaks SQL Server when it has been pointed at
 * another provider.
 *
 * Exits rather than throws: these run from `package.json` scripts, where an
 * unreadable stack trace is worse than one sentence naming the mismatch.
 */
export declare function requireSqlServerProvider(provider: Provider, command: string): void;
//# sourceMappingURL=provider-support.d.ts.map
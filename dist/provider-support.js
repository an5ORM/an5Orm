"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQL_SERVER_ONLY_COMMANDS = void 0;
exports.sqlServerOnlyError = sqlServerOnlyError;
const field_types_1 = require("./generator/src/field-types");
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
exports.SQL_SERVER_ONLY_COMMANDS = {
    'db:pull': 'read the catalog and write schema files',
    'db:migrate': 'diff the schema against the database and apply migrations',
    'db:migrate:diff': 'diff the schema against the database',
    'db:migrate:generate': 'write a migration file from the schema files',
    'db:migrate:apply': 'apply pending migrations',
    'db:migrate:rollback': 'roll a migration back',
    'db:migrate:status': 'list schema models, database tables and migration state',
    'db:cleanup': 'drop tables and foreign keys that are no longer in the schema',
};
/**
 * Why a command cannot run against this provider, or null when it can.
 *
 * Returns the message instead of printing it and exiting, so this stays a plain
 * function: it is shared by four command files, and a module that calls
 * `process.exit` cannot be imported outside a Node CLI — nor unit tested for the
 * thing it exists to say.
 */
function sqlServerOnlyError(provider, command) {
    if (provider === 'mssql')
        return null;
    const what = exports.SQL_SERVER_ONLY_COMMANDS[command] ?? 'run';
    return (`❌ ${command} only supports SQL Server, but the connection string selects ` +
        `${field_types_1.PROVIDER_LABELS[provider]}.\n` +
        `   ${command} ${what} using sys.* catalog views and T-SQL, so pointing it at ` +
        `${field_types_1.PROVIDER_LABELS[provider]} would run the wrong SQL.\n` +
        '   Use a SQL Server connection string, or generate and apply the schema with ' +
        `${field_types_1.PROVIDER_LABELS[provider]}'s own tooling.`);
}
//# sourceMappingURL=provider-support.js.map
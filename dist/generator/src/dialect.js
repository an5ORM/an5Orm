"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqlLiteral = sqlLiteral;
exports.dialectFor = dialectFor;
exports.defaultClause = defaultClause;
/** `schema.table` reduced to the bare object name, e.g. `dbo.widgets`. */
function objectName(raw) {
    return raw.replace(/[\[\]"`]/g, '').split('.').filter(Boolean).join('.');
}
/** A possibly schema-qualified name split into parts, unquoting each. */
function splitQualified(raw) {
    const parts = raw.replace(/[\[\]"`]/g, '').split('.').filter(Boolean);
    if (parts.length >= 2) {
        return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
    }
    return { schema: undefined, name: parts[0] ?? raw };
}
/**
 * A single-quoted SQL string literal.
 *
 * Every provider doubles an embedded quote, so one helper covers them all. These
 * values come from the schema files, so they are the project's own — but an
 * apostrophe in a column name would otherwise close the literal and produce SQL
 * that means something else entirely.
 */
function sqlLiteral(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** Bracketed identifiers: SQL Server, and SQLite which accepts the same form. */
function bracketQuote(name) {
    return `[${name.replace(/^\[(.*)\]$/, '$1').replace(/\]/g, ']]')}]`;
}
/** Double-quoted identifiers: the SQL standard, so PostgreSQL. */
function doubleQuote(name) {
    return `"${name.replace(/^"(.*)"$/, '$1').replace(/"/g, '""')}"`;
}
/** Backtick identifiers: MySQL. */
function backtickQuote(name) {
    return `\`${name.replace(/^`(.*)`$/, '$1').replace(/`/g, '``')}\``;
}
/**
 * The schema an unqualified table lands in.
 *
 * `''` means "whatever the connection resolves", which is also what the DDL emits
 * for an unqualified name — the two must agree or `db:push` cannot find the table it
 * just created. PostgreSQL therefore queries `current_schema()` rather than
 * hard-coding `public`: with the usual `search_path = "$user", public`, a table
 * created unqualified lands in the role's own schema, and looking only in `public`
 * made every push re-issue `CREATE TABLE` and fail with "relation already exists".
 */
function defaultSchema(provider, schema) {
    if (schema !== undefined)
        return schema;
    return provider === 'postgres' ? 'current_schema()' : '';
}
/**
 * Where a table's existence is recorded.
 *
 * SQL Server needs `OBJECT_ID` because the query is by object, not by name; the
 * others keep their metadata in a catalog view keyed by schema plus name.
 */
function buildTableExists(provider) {
    return (raw) => {
        const { schema, name } = splitQualified(raw);
        switch (provider) {
            case 'mssql':
                return `SELECT name FROM sys.tables WHERE object_id = OBJECT_ID(${sqlLiteral(objectName(raw))})`;
            case 'postgres':
                return `SELECT tablename FROM pg_tables WHERE schemaname = ${schema ? sqlLiteral(schema) : defaultSchema(provider, undefined)} AND tablename = ${sqlLiteral(name)}`;
            case 'mysql':
                // An unqualified table belongs to the database the connection selected.
                return (`SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema ? sqlLiteral(schema) : 'DATABASE()'} ` +
                    `AND table_name = ${sqlLiteral(name)}`);
            case 'sqlite':
                return `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlLiteral(name)}`;
            default:
                return '';
        }
    };
}
function buildColumnExists(provider) {
    return (raw, column) => {
        const { schema, name } = splitQualified(raw);
        const columnLiteral = sqlLiteral(column);
        switch (provider) {
            case 'mssql':
                return `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(${sqlLiteral(objectName(raw))}) AND name = ${columnLiteral}`;
            case 'postgres':
                return (`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema ? sqlLiteral(schema) : defaultSchema(provider, undefined)} ` +
                    `AND table_name = ${sqlLiteral(name)} AND column_name = ${columnLiteral}`);
            case 'mysql':
                return (`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema ? sqlLiteral(schema) : 'DATABASE()'} ` +
                    `AND table_name = ${sqlLiteral(name)} AND column_name = ${columnLiteral}`);
            case 'sqlite':
                // A table-valued pragma, so this stays one round trip. Needs SQLite 3.16
                // (2017) for `pragma_table_info` to be usable as a table function.
                return `SELECT name FROM pragma_table_info(${sqlLiteral(name)}) WHERE name = ${columnLiteral}`;
            default:
                return '';
        }
    };
}
function buildIndexExists(provider) {
    return (raw, name) => {
        const { schema, name: table } = splitQualified(raw);
        const tableLiteral = sqlLiteral(table);
        const indexLiteral = sqlLiteral(name);
        const schemaClause = schema ? sqlLiteral(schema) : 'DATABASE()';
        switch (provider) {
            case 'mssql':
                return `SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID(${sqlLiteral(objectName(raw))}) AND name = ${indexLiteral}`;
            case 'postgres':
                return (`SELECT indexname FROM pg_indexes WHERE schemaname = ${schema ? sqlLiteral(schema) : defaultSchema(provider, undefined)} ` +
                    `AND tablename = ${tableLiteral} AND indexname = ${indexLiteral}`);
            case 'mysql':
                return (`SELECT index_name FROM information_schema.statistics WHERE table_schema = ${schemaClause} ` +
                    `AND table_name = ${tableLiteral} AND index_name = ${indexLiteral} LIMIT 1`);
            case 'sqlite':
                return `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${tableLiteral} AND name = ${indexLiteral}`;
            default:
                return '';
        }
    };
}
function buildUniqueConstraintExists(provider) {
    return (raw, name) => {
        const { schema, name: table } = splitQualified(raw);
        const tableLiteral = sqlLiteral(table);
        const constraintLiteral = sqlLiteral(name);
        switch (provider) {
            case 'mssql':
                return `SELECT name FROM sys.objects WHERE type = 'UQ' AND parent_object_id = OBJECT_ID(${sqlLiteral(objectName(raw))}) AND name = ${constraintLiteral}`;
            case 'postgres':
                return (`SELECT con.conname FROM pg_constraint con ` +
                    `JOIN pg_class t ON t.oid = con.conrelid AND t.relname = ${tableLiteral} ` +
                    `JOIN pg_namespace n ON n.oid = t.relnamespace ` +
                    `WHERE con.contype = 'u' AND con.conname = ${constraintLiteral} ` +
                    `AND n.nspname = ${schema ? sqlLiteral(schema) : defaultSchema(provider, undefined)}`);
            case 'mysql':
                return (`SELECT constraint_name FROM information_schema.table_constraints ` +
                    `WHERE table_schema = ${schema ? sqlLiteral(schema) : 'DATABASE()'} AND table_name = ${tableLiteral} ` +
                    `AND constraint_name = ${constraintLiteral} AND constraint_type = 'UNIQUE'`);
            case 'sqlite':
                // No named constraints to look for; the unique index carries the name, so
                // the index catalog answers for it.
                return buildIndexExists(provider)(raw, name);
            default:
                return '';
        }
    };
}
/**
 * The keyword that makes a column auto-incrementing, or an empty string when the
 * expression did not ask for one.
 *
 * SQLite is checked rather than passed through: it accepts AUTOINCREMENT only on
 * an `INTEGER PRIMARY KEY`, so a schema asking for `@default(autoincrement())` on
 * anything else has to hear about it here rather than from the engine.
 */
function identityKeyword(column, provider) {
    if (column.defaultExpr?.trim() !== 'autoincrement()')
        return '';
    switch (provider) {
        case 'mssql':
            return 'IDENTITY(1,1)';
        case 'postgres':
            return 'GENERATED BY DEFAULT AS IDENTITY';
        case 'mysql':
            return 'AUTO_INCREMENT';
        case 'sqlite': {
            // The whole declared type, not the base name: `INTEGER(8)` is not an
            // INTEGER PRIMARY KEY as far as SQLite is concerned, and letting it through
            // would replace this message with the engine's.
            const declared = column.sqlType.trim().toUpperCase();
            if (!column.isId) {
                throw new Error(`SQLite: @default(autoincrement()) on "${column.name}" needs @id — ` +
                    'SQLite only auto-increments an INTEGER PRIMARY KEY.');
            }
            if (declared !== 'INTEGER') {
                throw new Error(`SQLite: @default(autoincrement()) on "${column.name}" needs the type INTEGER, ` +
                    `not ${column.sqlType} — SQLite only auto-increments an INTEGER PRIMARY KEY.`);
            }
            return 'AUTOINCREMENT';
        }
        default:
            return '';
    }
}
function createDialect(provider, quote) {
    const supportsUniqueInlineOnAddColumn = provider !== 'sqlite';
    const quoteTable = (raw) => {
        const { schema, name } = splitQualified(raw);
        return schema ? `${quote(schema)}.${quote(name)}` : quote(name);
    };
    const list = (fields) => fields.join(', ');
    // Named rather than a method so `addColumn` keeps working if the dialect is
    // destructured by a caller.
    const columnDefinition = (column) => {
        const identity = identityKeyword(column, provider);
        // Where the identity keyword goes is not a detail: SQL Server takes it as part
        // of the column type (`INT IDENTITY(1,1)`), while SQLite only accepts it after
        // `PRIMARY KEY` and only spells the documented form `INTEGER PRIMARY KEY
        // AUTOINCREMENT`.
        const type = identity && provider !== 'sqlite'
            ? `${quote(column.name)} ${column.sqlType} ${identity}`
            : `${quote(column.name)} ${column.sqlType}`;
        const nullable = column.isOptional ? '' : ' NOT NULL';
        const unique = column.isUnique && !column.isId ? ' UNIQUE' : '';
        const defaultSql = defaultClause(column.defaultExpr, provider);
        const defaultPart = defaultSql ? ` ${defaultSql}` : '';
        if (column.isId) {
            const key = `${type} PRIMARY KEY`;
            return `${key}${identity && provider === 'sqlite' ? ` ${identity}` : ''}${defaultPart}`;
        }
        return `${type}${nullable}${defaultPart}${unique}`;
    };
    return {
        provider,
        supportsDdl: true,
        quote,
        quoteTable,
        supportsNamedUniqueConstraint: provider !== 'sqlite',
        supportsUniqueInlineOnAddColumn,
        tableExists: buildTableExists(provider),
        columnExists: buildColumnExists(provider),
        uniqueConstraintExists: buildUniqueConstraintExists(provider),
        indexExists: buildIndexExists(provider),
        columnDefinition,
        createTable: (table, columnDefs) => `CREATE TABLE ${table} (\n  ${columnDefs.join(',\n  ')}\n)`,
        createIndex: (name, table, fields) => `CREATE INDEX ${name} ON ${table} (${list(fields)})`,
        createUniqueIndex: (name, table, fields) => `CREATE UNIQUE INDEX ${name} ON ${table} (${list(fields)})`,
        addColumn: (table, column) => {
            // SQLite refuses "Cannot add a UNIQUE column", so the unique is left out here
            // and added as a separate index by the caller — silently dropping it instead
            // would push a column that is not unique after all.
            const withoutUnique = supportsUniqueInlineOnAddColumn
                ? column
                : { ...column, isUnique: false };
            return `ALTER TABLE ${table} ADD ${columnDefinition(withoutUnique)}`;
        },
        addUniqueConstraint: (name, table, fields) => `ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${list(fields)})`,
    };
}
/**
 * Google Sheets has no tables and therefore no DDL: a sheet is a range of cells the
 * adapter reads and writes. Every builder is inert and `supportsDdl` is false, so
 * the caller explains that instead of sending SQL to a database that cannot run it.
 */
const SHEETS_DIALECT = {
    provider: 'googlesheets',
    supportsDdl: false,
    quote: (name) => name,
    quoteTable: (raw) => objectName(raw),
    supportsNamedUniqueConstraint: false,
    supportsUniqueInlineOnAddColumn: false,
    tableExists: () => '',
    columnExists: () => '',
    uniqueConstraintExists: () => '',
    indexExists: () => '',
    columnDefinition: () => '',
    createTable: () => '',
    createIndex: () => '',
    createUniqueIndex: () => '',
    addColumn: () => '',
    addUniqueConstraint: () => '',
};
/** The dialect that writes DDL for a provider. */
function dialectFor(provider) {
    switch (provider) {
        case 'postgres':
            return createDialect(provider, doubleQuote);
        case 'mysql':
            return createDialect(provider, backtickQuote);
        case 'sqlite':
            return createDialect(provider, bracketQuote);
        case 'googlesheets':
            return SHEETS_DIALECT;
        case 'mssql':
        default:
            return createDialect(provider, bracketQuote);
    }
}
/**
 * Renders a `@default(...)` expression as the SQL that follows the column type.
 *
 * Returns an empty string when the provider has no equivalent — SQLite has no
 * default functions, so `uuid()` is left to the adapter, which fills a string
 * primary key in before inserting.
 */
function defaultClause(expression, provider) {
    const value = (expression ?? '').trim();
    switch (value) {
        case '':
        case 'autoincrement()':
            // Not a default value: it is the identity clause on the column type.
            return '';
        case 'uuid()':
        case 'cuid()':
            if (provider === 'mssql')
                return 'DEFAULT NEWID()';
            if (provider === 'postgres')
                return 'DEFAULT gen_random_uuid()';
            if (provider === 'mysql')
                return 'DEFAULT (UUID())';
            return '';
        case 'now()':
            return 'DEFAULT CURRENT_TIMESTAMP';
        case 'true':
            // PostgreSQL has a real boolean, so use it rather than 1/0.
            return provider === 'postgres' ? 'DEFAULT TRUE' : 'DEFAULT 1';
        case 'false':
            return provider === 'postgres' ? 'DEFAULT FALSE' : 'DEFAULT 0';
        default:
            if (/^".*"$/.test(value))
                return `DEFAULT '${value.slice(1, -1).replace(/'/g, "''")}'`;
            return `DEFAULT ${value}`;
    }
}

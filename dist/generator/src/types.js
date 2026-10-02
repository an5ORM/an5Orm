"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bracketedTableName = bracketedTableName;
exports.dottedTableName = dottedTableName;
/**
 * The table name as it goes into the generated metadata.
 *
 * SQL Server keeps the bracketed form it has always had. Every other provider gets
 * the bare name, with the schema as a plain prefix, because the brackets are not
 * portable: `[dbo].[users]` is invalid SQL in PostgreSQL, and on SQLite it fails with
 * "no such table: dbo.users" — which is why the adapters had to strip it afterwards.
 * A bare name is correct everywhere once the adapter quotes it, and the adapters
 * already quote per dialect (`quote()` in `@an5/adapters`, `An5DbContext.Quote()` in
 * the .NET client), so the one form that needs no translation is the one emitted.
 *
 * `dbo` is SQL Server's default schema and only SQL Server's: with `@@schema("")` —
 * an empty schema, meant for databases that have no schema concept — the prefix has
 * to go, because `[].[users]` is not valid SQL. The `[${schemaName}].[${tableName}]`
 * formula used to be written out in six places, so every dialect got `[dbo]`.
 */
function bracketedTableName(model) {
    const qualified = model.schemaName
        ? `${model.schemaName}.${model.tableName}`
        : model.tableName;
    if ((model.provider ?? 'mssql') !== 'mssql')
        return qualified;
    return model.schemaName
        ? `[${model.schemaName}].[${model.tableName}]`
        : `[${model.tableName}]`;
}
/**
 * The table name as `schema.table`, for clients that pass a string instead of SQL.
 *
 * Unquoted for the same reason as `bracketedTableName`: these strings go to the same
 * per-dialect quoting.
 */
function dottedTableName(model) {
    return model.schemaName
        ? `${model.schemaName}.${model.tableName}`
        : model.tableName;
}

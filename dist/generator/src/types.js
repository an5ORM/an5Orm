"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bracketedTableName = bracketedTableName;
exports.dottedTableName = dottedTableName;
/**
 * The bracketed table name, for MSSQL and the other clients.
 *
 * `dbo` is only SQL Server's default schema. With `@@schema("")` — an empty
 * schema, meant for databases that have no schema concept (SQLite, MySQL) — the
 * prefix has to go, because `[].[users]` is not valid SQL. The
 * `[${schemaName}].[${tableName}]` formula used to be written out in six places,
 * so every dialect got `[dbo]` and on SQLite every query failed with
 * `no such table: dbo.<table>`.
 */
function bracketedTableName(model) {
    return model.schemaName
        ? `[${model.schemaName}].[${model.tableName}]`
        : `[${model.tableName}]`;
}
/** The table name as `schema.table`, for clients that pass a string instead of SQL. */
function dottedTableName(model) {
    return model.schemaName
        ? `${model.schemaName}.${model.tableName}`
        : model.tableName;
}

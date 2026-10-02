import { Provider } from './field-types';

export interface Field {
  name: string;
  type: string;       // TypeScript type (string, number, boolean, Date, etc.)
  sqlType: string;    // SQL Server type (NVARCHAR(255), INT, DATETIME2, etc.)
  isOptional: boolean;
  hasDefault: boolean;
  isId: boolean;
  description?: string;
}

export interface Relation {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  foreignKey: string;
  localKey: string;
  relationName: string;
  /** From a trailing @description("...") on the relation line. */
  description?: string;
}

export interface Model {
  name: string;
  tableName: string;
  /** Empty for a database with no schemas, or when `@@schema("")` says so. */
  schemaName: string;
  /**
   * The database this schema targets. Set by `SchemaParser`, and what decides how a
   * table name is written — see `bracketedTableName`.
   */
  provider?: Provider | undefined;
  fields: Field[];
  relations: Relation[];
  compoundUniques?: string[][];
  description?: string;
}

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
export function bracketedTableName(model: Model): string {
  const qualified = model.schemaName
    ? `${model.schemaName}.${model.tableName}`
    : model.tableName;
  if ((model.provider ?? 'mssql') !== 'mssql') return qualified;
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
export function dottedTableName(model: Model): string {
  return model.schemaName
    ? `${model.schemaName}.${model.tableName}`
    : model.tableName;
}

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
  schemaName: string;
  fields: Field[];
  relations: Relation[];
  compoundUniques?: string[][];
  description?: string;
}

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
export function bracketedTableName(model: Model): string {
  return model.schemaName
    ? `[${model.schemaName}].[${model.tableName}]`
    : `[${model.tableName}]`;
}

/** The table name as `schema.table`, for clients that pass a string instead of SQL. */
export function dottedTableName(model: Model): string {
  return model.schemaName
    ? `${model.schemaName}.${model.tableName}`
    : model.tableName;
}

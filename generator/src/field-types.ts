/**
 * Field types per database provider.
 *
 * There used to be one `AN5_TO_TS` table shared by every provider, plus a
 * separate `AN5_TYPES` list for push/migrate — and the two disagreed. So
 * `INTEGER`/`BOOLEAN`/`BLOB` (SQLite-only names) were generated into the client
 * and then dropped silently on push, while another provider's types (`SERIAL`,
 * `JSONB`) passed validation and only died at DDL time.
 *
 * Each provider now has its own table, which is both the list of allowed types
 * and the mapping to a TypeScript type. The provider comes from the connection
 * string — see `detectProvider` in `./config`.
 */
import { suggest } from './suggest';

export type Provider = 'mssql' | 'postgres' | 'mysql' | 'sqlite' | 'googlesheets';

/** Order used when printing issues and when suggesting a provider. */
export const PROVIDERS: readonly Provider[] = ['mssql', 'postgres', 'mysql', 'sqlite', 'googlesheets'];

/**
 * SQL Server is the default provider: it is the only one `db:push`, `db:pull`
 * and `db:migrate` actually support, and it is what existing `.an5` schemas
 * were written for. With no connection string, treat the schema as SQL Server —
 * the same fallback `an5Adapter` uses.
 */
export const DEFAULT_PROVIDER: Provider = 'mssql';

/** Display name, used in error messages. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  mssql: 'SQL Server',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  googlesheets: 'Google Sheets',
};

/** The TypeScript type a field is generated as. */
export type TsType =
  | 'string'
  | 'number'
  | 'number | bigint'
  | 'boolean'
  | 'Date'
  | 'Buffer'
  | 'any'
  | 'number[] | string';

/**
 * Valid column types per provider: what is written in `.an5` → the TypeScript
 * type generated for it.
 *
 * Keys are stored upper case and lookups are case-insensitive. This table is
 * the single source of truth — nowhere else is allowed to enumerate types.
 */
export const PROVIDER_FIELD_TYPES: Record<Provider, Readonly<Record<string, TsType>>> = {
  // ─── SQL Server ────────────────────────────────────────────────────────────
  mssql: {
    // Strings
    NVARCHAR: 'string',
    VARCHAR: 'string',
    CHAR: 'string',
    NCHAR: 'string',
    TEXT: 'string',
    NTEXT: 'string',
    XML: 'string',
    // Numbers
    INT: 'number',
    SMALLINT: 'number',
    TINYINT: 'number',
    BIGINT: 'number | bigint',
    FLOAT: 'number',
    REAL: 'number',
    DECIMAL: 'number',
    NUMERIC: 'number',
    MONEY: 'number',
    SMALLMONEY: 'number',
    // Boolean
    BIT: 'boolean',
    // Date and time
    DATE: 'Date',
    DATETIME: 'Date',
    DATETIME2: 'Date',
    SMALLDATETIME: 'Date',
    DATETIMEOFFSET: 'Date',
    TIME: 'Date',
    // Binary
    VARBINARY: 'Buffer',
    BINARY: 'Buffer',
    IMAGE: 'Buffer',
    ROWVERSION: 'Buffer',
    // `TIMESTAMP` is the legacy name of `ROWVERSION`, i.e. a rowversion — writing
    // TIMESTAMP in a SQL Server schema does not mean a point in time.
    TIMESTAMP: 'Buffer',
    // Everything else
    UNIQUEIDENTIFIER: 'string',
    // `sysname` is an alias for NVARCHAR(128) and is what db:pull writes for a
    // column declared that way, so it has to be valid or a pulled schema could
    // not be generated again.
    SYSNAME: 'string',
    SQL_VARIANT: 'any',
    HIERARCHYID: 'string',
    GEOGRAPHY: 'string',
    GEOMETRY: 'string',
    VECTOR: 'number[] | string',
  },

  // ─── PostgreSQL ────────────────────────────────────────────────────────────
  postgres: {
    // Strings. `NAME` and `USER` are real PostgreSQL types but are deliberately
    // left out: a model called `Name`/`User` is far more likely, and listing
    // them here would turn `user User @relation(...)` into a USER column.
    VARCHAR: 'string',
    CHARACTER: 'string',
    'CHARACTER VARYING': 'string',
    CHAR: 'string',
    TEXT: 'string',
    UUID: 'string',
    XML: 'string',
    JSON: 'any',
    JSONB: 'any',
    INET: 'string',
    CIDR: 'string',
    // Numbers. `INT` is not valid on PostgreSQL (it must be `INTEGER`/`INT4`),
    // so it is absent here — a schema using `INT` is rejected instead of dying
    // at DDL time.
    SMALLINT: 'number',
    INT2: 'number',
    INT4: 'number',
    INTEGER: 'number',
    INT8: 'number | bigint',
    BIGINT: 'number | bigint',
    SMALLSERIAL: 'number',
    SERIAL: 'number',
    BIGSERIAL: 'number | bigint',
    DECIMAL: 'number',
    NUMERIC: 'number',
    REAL: 'number',
    'DOUBLE PRECISION': 'number',
    MONEY: 'number',
    // Boolean
    BOOLEAN: 'boolean',
    BOOL: 'boolean',
    // Date and time
    DATE: 'Date',
    TIME: 'Date',
    TIMETZ: 'Date',
    'TIME WITH TIME ZONE': 'Date',
    'TIME WITHOUT TIME ZONE': 'Date',
    TIMESTAMP: 'Date',
    TIMESTAMPTZ: 'Date',
    'TIMESTAMP WITH TIME ZONE': 'Date',
    'TIMESTAMP WITHOUT TIME ZONE': 'Date',
    INTERVAL: 'string',
    // Binary
    BYTEA: 'Buffer',
    // Requires an extension: PostGIS for geometry, pgvector for vectors.
    GEOGRAPHY: 'string',
    GEOMETRY: 'string',
    VECTOR: 'number[] | string',
  },

  // ─── MySQL / MariaDB ───────────────────────────────────────────────────────
  mysql: {
    // Strings
    CHAR: 'string',
    VARCHAR: 'string',
    NCHAR: 'string',
    NVARCHAR: 'string',
    TINYTEXT: 'string',
    TEXT: 'string',
    MEDIUMTEXT: 'string',
    LONGTEXT: 'string',
    ENUM: 'string',
    SET: 'string',
    // Numbers
    TINYINT: 'number',
    SMALLINT: 'number',
    MEDIUMINT: 'number',
    INT: 'number',
    INTEGER: 'number',
    BIGINT: 'number | bigint',
    // `SERIAL` is an alias for `BIGINT UNSIGNED AUTO_INCREMENT`.
    SERIAL: 'number | bigint',
    DECIMAL: 'number',
    NUMERIC: 'number',
    FIXED: 'number',
    FLOAT: 'number',
    DOUBLE: 'number',
    'DOUBLE PRECISION': 'number',
    REAL: 'number',
    // Boolean
    BOOLEAN: 'boolean',
    BOOL: 'boolean',
    // `BIT(n)` is an n-bit field and reads back as a number, not a boolean.
    BIT: 'number',
    // Date and time
    DATE: 'Date',
    DATETIME: 'Date',
    TIMESTAMP: 'Date',
    TIME: 'Date',
    YEAR: 'number',
    // Binary
    BINARY: 'Buffer',
    VARBINARY: 'Buffer',
    TINYBLOB: 'Buffer',
    BLOB: 'Buffer',
    MEDIUMBLOB: 'Buffer',
    LONGBLOB: 'Buffer',
    // Everything else. MySQL has no UUID type (MariaDB does), so UUID is
    // intentionally absent.
    JSON: 'any',
    GEOMETRY: 'string',
    POINT: 'string',
    LINESTRING: 'string',
    POLYGON: 'string',
  },

  // ─── SQLite ────────────────────────────────────────────────────────────────
  // SQLite does not enforce types: the declared name only picks an affinity, so
  // this list is "names in common use whose affinity is derivable" rather than
  // an engine enum. The point that matters: `INTEGER`/`BOOLEAN`/`BLOB` exist
  // only here — SQL Server has no INTEGER, so a schema using it and pushed to
  // SQL Server is now rejected.
  sqlite: {
    // Integers
    INTEGER: 'number',
    INT: 'number',
    INT2: 'number',
    INT8: 'number | bigint',
    TINYINT: 'number',
    SMALLINT: 'number',
    MEDIUMINT: 'number',
    BIGINT: 'number | bigint',
    'UNSIGNED BIG INT': 'number | bigint',
    // Reals
    REAL: 'number',
    DOUBLE: 'number',
    'DOUBLE PRECISION': 'number',
    FLOAT: 'number',
    NUMERIC: 'number',
    DECIMAL: 'number',
    // Boolean
    BOOLEAN: 'boolean',
    BOOL: 'boolean',
    // Strings
    TEXT: 'string',
    CLOB: 'string',
    VARCHAR: 'string',
    NVARCHAR: 'string',
    CHAR: 'string',
    NCHAR: 'string',
    CHARACTER: 'string',
    'VARYING CHARACTER': 'string',
    // Binary
    BLOB: 'Buffer',
    // Date and time — stored as TEXT and converted on read (see `SqliteEngine`).
    DATE: 'Date',
    DATETIME: 'Date',
    TIMESTAMP: 'Date',
    TIME: 'Date',
    YEAR: 'number',
    // Everything else
    JSON: 'any',
    UUID: 'string',
    VECTOR: 'number[] | string',
  },

  // ─── Google Sheets ─────────────────────────────────────────────────────────
  // Sheets has no column types: every cell is a text/number/boolean value and
  // the adapter coerces it from the generated TypeScript type (`coerceCell`).
  // So this list only accepts portable types — the ones the adapter still knows
  // what to coerce into.
  googlesheets: {
    // Strings
    STRING: 'string',
    TEXT: 'string',
    VARCHAR: 'string',
    NVARCHAR: 'string',
    CHAR: 'string',
    NCHAR: 'string',
    CLOB: 'string',
    // Numbers
    INT: 'number',
    INTEGER: 'number',
    SMALLINT: 'number',
    TINYINT: 'number',
    BIGINT: 'number | bigint',
    FLOAT: 'number',
    DOUBLE: 'number',
    DECIMAL: 'number',
    NUMERIC: 'number',
    REAL: 'number',
    // Boolean
    BOOLEAN: 'boolean',
    BOOL: 'boolean',
    // Date and time
    DATE: 'Date',
    DATETIME: 'Date',
    TIMESTAMP: 'Date',
    TIME: 'Date',
    // Binary
    BYTES: 'Buffer',
    BLOB: 'Buffer',
    // Everything else
    VECTOR: 'number[] | string',
  },
};

/** The type table of one provider. */
export function fieldTypesFor(provider: Provider): Readonly<Record<string, TsType>> {
  return PROVIDER_FIELD_TYPES[provider];
}

/**
 * The column type to use when only the TypeScript type is known.
 *
 * For tooling that has to invent a type name — the agent reading a client generated
 * before the metadata carried `sql` — and the table is per provider on purpose:
 * `NVARCHAR` exists only on SQL Server and `TIMESTAMP` is a rowversion there, so
 * naming a type from the wrong provider produces SQL the database rejects.
 */
const DEFAULT_TYPE_FOR_TS: Record<Provider, Record<string, string>> = {
  mssql: { string: 'NVARCHAR(255)', number: 'INT', bigint: 'BIGINT', boolean: 'BIT', Date: 'DATETIME2', Buffer: 'VARBINARY(MAX)', any: 'NVARCHAR(MAX)', vector: 'VECTOR' },
  postgres: { string: 'VARCHAR(255)', number: 'INTEGER', bigint: 'BIGINT', boolean: 'BOOLEAN', Date: 'TIMESTAMPTZ', Buffer: 'BYTEA', any: 'JSONB', vector: 'VECTOR' },
  mysql: { string: 'VARCHAR(255)', number: 'INT', bigint: 'BIGINT', boolean: 'BOOLEAN', Date: 'DATETIME', Buffer: 'BLOB', any: 'JSON', vector: 'JSON' },
  // SQLite stores what it is given: dates as text, which is what the adapter reads
  // back and converts, and numbers as a real.
  sqlite: { string: 'TEXT', number: 'REAL', bigint: 'INTEGER', boolean: 'BOOLEAN', Date: 'TEXT', Buffer: 'BLOB', any: 'TEXT', vector: 'TEXT' },
  googlesheets: { string: 'TEXT', number: 'INTEGER', bigint: 'INTEGER', boolean: 'BOOLEAN', Date: 'TEXT', Buffer: 'BYTES', any: 'TEXT', vector: 'TEXT' },
};

/**
 * A column type for a TypeScript type, valid on `provider`.
 *
 * Unknown TypeScript types fall back to that provider's string type, which is the
 * only choice that can hold any value.
 */
export function defaultSqlTypeForTs(tsType: string, provider: Provider = DEFAULT_PROVIDER): string {
  const byProvider = DEFAULT_TYPE_FOR_TS[provider];
  const raw = tsType.trim();
  // A `[]` means the vector type, which the generators spell `number[] | string`; it
  // has to be recognised before the brackets are stripped, or it reads as a number.
  if (raw.includes('[]')) return byProvider.vector!;
  const key = raw.replace(/[?\]]/g, '').trim();
  if (byProvider[key]) return byProvider[key];
  if (key.startsWith('number')) return byProvider.bigint!;
  if (key.startsWith('Date')) return byProvider.Date!;
  if (key.startsWith('boolean') || key.startsWith('bool')) return byProvider.boolean!;
  if (key.startsWith('Buffer')) return byProvider.Buffer!;
  if (key === 'any') return byProvider.any!;
  return byProvider.string!;
}

/** One bad field type, with everything needed to print it. */
export interface FieldTypeIssue {
  /** `Model.field`, or just the field name when there is no model. */
  path: string;
  message: string;
}

/** Every bad field type reported at once, instead of stopping at the first. */
export class FieldTypeError extends Error {
  readonly provider: Provider;
  readonly issues: FieldTypeIssue[];

  constructor(provider: Provider, issues: FieldTypeIssue[]) {
    super(`Invalid field types for ${PROVIDER_LABELS[provider]}`);
    this.name = 'FieldTypeError';
    this.provider = provider;
    this.issues = issues;
  }
}

/**
 * Splits `NVARCHAR(255)` into name and parameters.
 *
 * The name keeps every word, because `DOUBLE PRECISION` and
 * `TIMESTAMP WITH TIME ZONE` are single entries in the PostgreSQL table. It is
 * upper-cased and whitespace-collapsed here so lookups do not depend on how the
 * schema was written.
 */
export function splitTypeParams(raw: string): { base: string; params: string } {
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  const match = normalized.match(/^([A-Z0-9_]+(?:\s+[A-Z0-9_]+)*)\s*(?:\(([^)]*)\))?$/);
  if (!match) return { base: normalized, params: '' };
  return { base: match[1]!, params: match[2] ?? '' };
}

/** Drops the `[]` (array) and `?` (nullable) suffixes. */
function stripTypeSuffixes(raw: string): string {
  return raw.replace(/\[\]$/, '').replace(/\?$/, '');
}

export interface ResolvedFieldType {
  /** Normalised type name, e.g. `DOUBLE PRECISION`. */
  base: string;
  /** The parameters in parentheses, e.g. `255` for `NVARCHAR(255)`. */
  params: string;
  /** The first word of `base`, used to guess "which type was meant". */
  head: string;
  /** The matching TypeScript type. */
  ts: TsType;
}

/**
 * Looks a type up in the provider's table, or null when the provider has no such
 * type.
 *
 * Called before deciding whether a field is a relation, so an upper-case type
 * that happens to match a model name (`TEXT`, `NAME`) still becomes a column.
 */
export function resolveFieldType(raw: string, provider: Provider): ResolvedFieldType | null {
  const { base, params } = splitTypeParams(raw);
  const ts = fieldTypesFor(provider)[base];
  if (ts === undefined) return null;
  return { base, params, head: base.split(' ')[0]!, ts };
}

/**
 * Message for a type the provider does not have.
 *
 * `modelNames` holds the models in the schema: an upper-case token may be a
 * model name (a relation) rather than a mistyped type, so the message has to
 * name both possibilities instead of guessing.
 */
export function unknownFieldTypeMessage(
  raw: string,
  provider: Provider,
  modelNames: readonly string[] = [],
): string {
  const label = `unknown type "${raw.trim()}" for ${PROVIDER_LABELS[provider]}`;
  const { base } = splitTypeParams(raw);
  const typeHint = suggest(base.split(' ')[0]!, Object.keys(fieldTypesFor(provider)));
  if (typeHint) return `${label}; did you mean "${typeHint}"?`;

  const modelHint = suggest(raw.trim(), modelNames);
  if (modelHint) {
    return `${label}, and no model named "${raw.trim()}" here; did you mean the model "${modelHint}"?`;
  }
  return `${label}, and no model named "${raw.trim()}" in this schema`;
}

/**
 * The head of a field line: the column name and type, with the `@attributes`
 * that may follow removed.
 *
 * The type is joined from every remaining token instead of just the second one,
 * because a multi-word type (`DOUBLE PRECISION`, `TIMESTAMP WITH TIME ZONE`)
 * truncated to its first word matches no table. Returns null when the line has
 * no name or no type.
 */
export function readFieldLineHead(line: string): {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
} | null {
  const attributeStart = line.indexOf('@');
  const tokens = (attributeStart === -1 ? line : line.slice(0, attributeStart)).trim().split(/\s+/);
  const name = tokens[0];
  const rawType = tokens.slice(1).join(' ');
  if (!name || !rawType) return null;
  return {
    name,
    type: stripTypeSuffixes(rawType),
    isArray: rawType.endsWith('[]'),
    isOptional: rawType.endsWith('?'),
  };
}
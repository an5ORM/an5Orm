/**
 * What a field *is*, for the generators that need a real type.
 *
 * The parser gives every generator the same TypeScript type, and that type loses
 * what a language needs: `INT`, `FLOAT` and `DECIMAL` all arrive as `number`, so
 * the Go client generated every numeric column as a `string`, and the Python, Rust
 * and .NET clients turned a `DECIMAL` into an integer type. The declared type is
 * right there in `Field.sqlType`, so it decides — with the TypeScript type as the
 * fallback for metadata generated before that was recorded.
 */
import { Provider } from './field-types';

/** The categories a generated language type can be built from. */
export type FieldKind = 'int' | 'bigint' | 'float' | 'bool' | 'date' | 'bytes' | 'json' | 'vector' | 'string';

export interface KindInput {
  /** The TypeScript type the parser produced, e.g. `number | bigint`. */
  type: string;
  /** The type as written in the schema, e.g. `DECIMAL(10,2)`. */
  sqlType?: string | undefined;
}

const INT = ['INT', 'INTEGER', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'INT2', 'INT4', 'SERIAL', 'SMALLSERIAL', 'YEAR'];
const BIGINT = ['BIGINT', 'INT8', 'BIGSERIAL', 'UNSIGNED BIG INT'];
const FLOAT = ['FLOAT', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'DECIMAL', 'NUMERIC', 'MONEY', 'SMALLMONEY', 'FIXED'];
const BOOL = ['BIT', 'BOOL', 'BOOLEAN'];
const DATE = [
  'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATETIMEOFFSET',
  'TIME', 'TIMETZ', 'TIMESTAMPTZ', 'TIME WITH TIME ZONE', 'TIME WITHOUT TIME ZONE',
  'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE',
];
const BYTES = ['BINARY', 'VARBINARY', 'IMAGE', 'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BYTEA', 'ROWVERSION', 'BYTES'];
const JSON = ['JSON', 'JSONB', 'SQL_VARIANT'];

/** `DECIMAL(10,2)` → `DECIMAL`. */
function declaredBase(sqlType: string): string {
  const withoutParams = sqlType.replace(/\([^)]*\)/g, ' ').trim();
  return withoutParams.replace(/\s+/g, ' ').toUpperCase();
}

/**
 * The category a field belongs to.
 *
 * `TIMESTAMP` is the reason `provider` is a parameter: it is a rowversion on SQL
 * Server and a point in time everywhere else, and the same word has to produce
 * bytes in one and a date in the other.
 */
export function fieldKind(field: KindInput, provider?: Provider | undefined): FieldKind {
  const base = field.sqlType ? declaredBase(field.sqlType) : '';
  if (base) {
    if (base === 'TIMESTAMP') return provider === 'mssql' ? 'bytes' : 'date';
    if (INT.includes(base)) return 'int';
    if (BIGINT.includes(base)) return 'bigint';
    if (FLOAT.includes(base)) return 'float';
    if (BOOL.includes(base)) return 'bool';
    if (DATE.includes(base) || base === 'TIMESTAMP') return 'date';
    if (BYTES.includes(base)) return 'bytes';
    if (JSON.includes(base)) return 'json';
    if (base === 'VECTOR') return 'vector';
    return 'string';
  }

  // No declared type: fall back to what the TypeScript type can still tell us. A
  // plain `number` is an integer here, which is what every generator assumed
  // before `sqlType` was available.
  const raw = field.type.trim().toLowerCase();
  // Checked before the brackets are stripped, or `number[] | string` — the vector
  // type — would read as a number.
  if (raw.includes('[]')) return 'vector';
  const ts = raw.replace(/[?\]]/g, '').trim();
  if (ts.startsWith('number | bigint')) return 'bigint';
  if (ts.startsWith('number')) return 'int';
  if (ts.startsWith('date')) return 'date';
  if (ts.startsWith('bool')) return 'bool';
  if (ts.startsWith('buffer')) return 'bytes';
  if (ts === 'any') return 'json';
  return 'string';
}
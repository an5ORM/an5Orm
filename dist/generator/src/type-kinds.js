"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fieldKind = fieldKind;
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
function declaredBase(sqlType) {
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
function fieldKind(field, provider) {
    const base = field.sqlType ? declaredBase(field.sqlType) : '';
    if (base) {
        if (base === 'TIMESTAMP')
            return provider === 'mssql' ? 'bytes' : 'date';
        if (INT.includes(base))
            return 'int';
        if (BIGINT.includes(base))
            return 'bigint';
        if (FLOAT.includes(base))
            return 'float';
        if (BOOL.includes(base))
            return 'bool';
        if (DATE.includes(base) || base === 'TIMESTAMP')
            return 'date';
        if (BYTES.includes(base))
            return 'bytes';
        if (JSON.includes(base))
            return 'json';
        if (base === 'VECTOR')
            return 'vector';
        return 'string';
    }
    // No declared type: fall back to what the TypeScript type can still tell us. A
    // plain `number` is an integer here, which is what every generator assumed
    // before `sqlType` was available.
    const raw = field.type.trim().toLowerCase();
    // Checked before the brackets are stripped, or `number[] | string` — the vector
    // type — would read as a number.
    if (raw.includes('[]'))
        return 'vector';
    const ts = raw.replace(/[?\]]/g, '').trim();
    if (ts.startsWith('number | bigint'))
        return 'bigint';
    if (ts.startsWith('number'))
        return 'int';
    if (ts.startsWith('date'))
        return 'date';
    if (ts.startsWith('bool'))
        return 'bool';
    if (ts.startsWith('buffer'))
        return 'bytes';
    if (ts === 'any')
        return 'json';
    return 'string';
}

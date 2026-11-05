"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqlServerTypeForColumn = sqlServerTypeForColumn;
exports.blockRange = blockRange;
exports.qualifiedBlockKey = qualifiedBlockKey;
exports.blockNameForObject = blockNameForObject;
exports.buildViewBlock = buildViewBlock;
/**
 * Pure helpers for `db:pull`.
 *
 * Reading SQL Server catalogs and writing schema files lives in `pull.ts`, which
 * starts a connection as soon as it is imported. The decisions it makes about the
 * text — which block to replace, how a view becomes a `view` block — are here so
 * they can be tested without a database.
 */
const dialect_1 = require("./dialect");
/**
 * The schema type of an introspected SQL Server column.
 *
 * `max_length` is bytes, so the character types divide it by two; `-1` is `MAX`.
 * Tables and views describe their columns the same way, so they share this.
 */
function sqlServerTypeForColumn(col) {
    let sqlType = col.dataType.toUpperCase();
    const dt = col.dataType.toLowerCase();
    if (dt === 'vector') {
        if (col.vectorDimensions && col.vectorDimensions > 0) {
            const baseType = col.vectorBaseType?.toLowerCase();
            if (baseType && baseType !== 'float32') {
                return `VECTOR(${col.vectorDimensions}, ${baseType})`;
            }
            return `VECTOR(${col.vectorDimensions})`;
        }
        return 'VECTOR';
    }
    else if (dt === 'nvarchar' || dt === 'varchar') {
        sqlType = col.maxLength === -1 ? `${sqlType.toUpperCase()}(MAX)` : `${sqlType.toUpperCase()}(${col.maxLength / 2})`;
    }
    else if (dt === 'char' || dt === 'nchar') {
        sqlType = `${sqlType.toUpperCase()}(${col.maxLength / 2})`;
    }
    else if (dt === 'varbinary' || dt === 'binary') {
        sqlType = col.maxLength === -1 ? `${sqlType.toUpperCase()}(MAX)` : `${sqlType.toUpperCase()}(${col.maxLength})`;
    }
    else if (dt === 'decimal' || dt === 'numeric') {
        sqlType = `${sqlType.toUpperCase()}(${col.precision}, ${col.scale})`;
    }
    return sqlType;
}
/**
 * Where `keyword Name { ... }` starts and ends in a schema file.
 *
 * The closing brace is the one on its own line, not the first `}` anywhere: a
 * view's SQL may contain one (`WHERE name <> '}'`) and a regex that stops there
 * would truncate the block.
 */
function blockRange(text, keyword, name) {
    const header = new RegExp(`(^|\\n)[ \\t]*${keyword}\\s+${name}\\s*\\{`);
    const match = header.exec(text);
    if (!match)
        return null;
    const start = match.index + (match[1]?.length ?? 0);
    const bodyStart = match.index + match[0].length;
    const close = /(^|\n)[ \t]*\}/.exec(text.slice(bodyStart));
    if (!close)
        return null;
    return { start, end: bodyStart + close.index + close[0].length };
}
/** The additional key a schema block is known by, e.g. `reporting.active_users`. */
function qualifiedBlockKey(name, schemaName) {
    return !schemaName || schemaName.toLowerCase() === 'dbo' ? name : `${schemaName}.${name}`;
}
/**
 * A likely block name for an introspected object.
 *
 * `db:pull` names a new block after the table or view, dropping the plural `s`
 * so `users` becomes `User`. A word that already ends in `s` but is singular
 * (`status`, `address`, `analysis`) must keep it: stripping the character turns
 * it into `Statu`, which reads like a typo in every generated client. Existing
 * blocks keep their own name, so this only decides what a newly pulled object is
 * called.
 */
function blockNameForObject(objectName) {
    // `active_users` becomes `ActiveUser`, not `Active_user`: the block name is a
    // generated type in every client, so it follows the schema's own casing.
    const words = objectName.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const capitalized = (words.length > 0 ? words : [objectName])
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
    // `addresses`/`classes` lose `es`; `status`/`address`/`analysis` are singular
    // and keep the `s`.
    if (/sses$/i.test(capitalized))
        return capitalized.slice(0, -2);
    if (/(?:ss|us|is)$/i.test(capitalized))
        return capitalized;
    if (/s$/i.test(capitalized))
        return capitalized.slice(0, -1);
    return capitalized;
}
/**
 * A `view` block for a catalog view.
 *
 * `@@sql` gets the body, not the `CREATE VIEW` statement the catalog returns:
 * push and migrate add the `CREATE VIEW` themselves, so storing the header would
 * produce `CREATE OR REPLACE VIEW x AS CREATE VIEW ...`.
 */
function buildViewBlock(input) {
    const body = (0, dialect_1.viewSqlBody)(input.definition);
    if (!body)
        return null;
    const lines = [`view ${input.modelName} {`];
    for (const col of input.columns) {
        lines.push(`  ${col.columnName} ${sqlServerTypeForColumn(col)}${col.isNullable ? '?' : ''}`);
    }
    if (input.viewName !== input.modelName.toLowerCase() + 's') {
        lines.push('', `  @@map("${input.viewName}")`);
    }
    if (input.schemaName && input.schemaName.toLowerCase() !== 'dbo') {
        lines.push(`  @@schema("${input.schemaName}")`);
    }
    lines.push('', '  @@sql("""');
    for (const line of body.split(/\r?\n/))
        lines.push(`    ${line}`);
    lines.push('  """)', '}');
    return lines.join('\n');
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAppliedMigrations = verifyAppliedMigrations;
exports.parseSqlType = parseSqlType;
exports.formatDbColumnSqlType = formatDbColumnSqlType;
exports.mapDefault = mapDefault;
exports.safeIdentifierName = safeIdentifierName;
exports.quoteTableName = quoteTableName;
exports.tableIdentityName = tableIdentityName;
exports.buildAlterColumnWarnings = buildAlterColumnWarnings;
exports.buildAlterColumnPreflightSql = buildAlterColumnPreflightSql;
exports.buildAddColumnPreflightSql = buildAddColumnPreflightSql;
exports.buildUniqueConstraintPreflightSql = buildUniqueConstraintPreflightSql;
exports.parseSchemaText = parseSchemaText;
exports.buildCreateTableSql = buildCreateTableSql;
exports.buildCreateViewSql = buildCreateViewSql;
exports.buildIndexDiff = buildIndexDiff;
exports.generateColumnDiff = generateColumnDiff;
exports.generateDiff = generateDiff;
exports.buildMigrationFile = buildMigrationFile;
exports.buildDownMigrationSql = buildDownMigrationSql;
exports.parseMigrationSections = parseMigrationSections;
exports.splitSqlBatches = splitSqlBatches;
exports.parseRollbackSelection = parseRollbackSelection;
exports.parseMigrationCommandOptions = parseMigrationCommandOptions;
const attributes_1 = require("./generator/src/attributes");
const field_types_1 = require("./generator/src/field-types");
const dialect_1 = require("./generator/src/dialect");
const view_order_1 = require("./generator/src/view-order");
/**
 * Compares applied migrations with the files they were applied from.
 *
 * `apply` used to look only at the ids, so editing an applied file was invisible
 * and a fresh database would get different SQL from the one already recorded.
 * Rollback already refuses a changed checksum; this catches it before the next
 * migration is applied, where it can still be fixed without a partial history.
 */
function verifyAppliedMigrations(applied, readMigration, checksum) {
    const drift = { changed: [], missing: [] };
    for (const migration of applied) {
        if (!migration.checksum)
            continue;
        const content = readMigration(migration.id);
        if (content === null) {
            drift.missing.push(migration.id);
            continue;
        }
        if (checksum(content) !== migration.checksum)
            drift.changed.push(migration.id);
    }
    return drift;
}
function parseSqlType(raw) {
    const match = raw.match(/^(\w+)/);
    return match?.[1]?.toUpperCase() ?? raw.toUpperCase();
}
function formatDbColumnSqlType(column) {
    const base = parseSqlType(column.dataType || '');
    if ((base === 'NVARCHAR' || base === 'NCHAR') && typeof column.maxLength === 'number') {
        return `${base}(${column.maxLength < 0 ? 'MAX' : Math.floor(column.maxLength / 2)})`;
    }
    if ((base === 'VARCHAR' || base === 'CHAR' || base === 'VARBINARY' || base === 'BINARY') && typeof column.maxLength === 'number') {
        return `${base}(${column.maxLength < 0 ? 'MAX' : column.maxLength})`;
    }
    if ((base === 'DECIMAL' || base === 'NUMERIC') && typeof column.precision === 'number' && typeof column.scale === 'number') {
        return `${base}(${column.precision},${column.scale})`;
    }
    if ((base === 'DATETIME2' || base === 'TIME' || base === 'DATETIMEOFFSET') && typeof column.scale === 'number') {
        return `${base}(${column.scale})`;
    }
    return base;
}
function mapDefault(val) {
    if (val === 'uuid()')
        return 'DEFAULT NEWID()';
    if (val === 'cuid()')
        return 'DEFAULT NEWID()';
    if (val === 'now()')
        return 'DEFAULT CURRENT_TIMESTAMP';
    if (val === 'autoincrement()')
        return 'IDENTITY(1,1)';
    if (val === 'true')
        return 'DEFAULT 1';
    if (val === 'false')
        return 'DEFAULT 0';
    if (/^".*"$/.test(val))
        return `DEFAULT '${val.slice(1, -1).replace(/'/g, "''")}'`;
    return `DEFAULT ${val}`;
}
function safeIdentifierName(raw) {
    return raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
function fieldUniqueConstraintName(model, field) {
    return `UQ_${safeIdentifierName(model.tableName)}_${safeIdentifierName(field.name)}`;
}
function compoundUniqueConstraintName(model, idx) {
    return `UQ_${safeIdentifierName(model.tableName)}_compound_${idx}`;
}
function indexName(model, fields) {
    return `IX_${safeIdentifierName(model.tableName)}_${safeIdentifierName(fields.join('_'))}`;
}
function schemaIndexFields(definition) {
    return Array.isArray(definition) ? definition : definition.fields;
}
function schemaIndexName(definition, fallback) {
    if (!Array.isArray(definition) && definition.name)
        return definition.name;
    return fallback(schemaIndexFields(definition));
}
function parseMappedIndex(line, directive) {
    const parsed = (0, attributes_1.parseIndexDirective)((0, attributes_1.attributeArgs)(line, directive));
    if (!parsed)
        return null;
    const definition = { fields: parsed.fields };
    if (parsed.name)
        definition.name = parsed.name;
    if (parsed.includeFields && parsed.includeFields.length > 0)
        definition.includeFields = parsed.includeFields;
    if (parsed.filter !== undefined)
        definition.filter = parsed.filter;
    if (parsed.options !== undefined)
        definition.options = parsed.options;
    return definition;
}
function quoteTableName(raw) {
    return raw
        .replace(/"/g, '')
        .split('.')
        .map(part => part.trim().replace(/^\[|\]$/g, ''))
        .filter(Boolean)
        .map(part => `[${part.replace(/]/g, ']]')}]`)
        .join('.');
}
function tableIdentityName(raw) {
    const cleaned = raw
        .replace(/"/g, '')
        .split('.')
        .map(part => part.trim().replace(/^\[|\]$/g, '').toLowerCase())
        .filter(Boolean);
    if (cleaned.length > 1 && cleaned[0] === 'dbo') {
        cleaned.shift();
    }
    return cleaned.join('.');
}
function matchFirst(sql, pattern) {
    if (!sql)
        return null;
    const match = sql.match(pattern);
    return match?.[1] ?? null;
}
function parseTypeArgs(sqlType) {
    const match = sqlType.match(/^(\w+)(?:\(([^)]+)\))?/);
    const typeArgs = match?.[2];
    return {
        base: match?.[1]?.toUpperCase() ?? parseSqlType(sqlType),
        args: typeArgs ? typeArgs.split(',').map(arg => arg.trim().toUpperCase()) : [],
    };
}
function numericArg(value) {
    if (!value)
        return undefined;
    if (value === 'MAX')
        return 'MAX';
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}
function quoteColumnName(raw) {
    return `[${raw.replace(/]/g, ']]')}]`;
}
function escapeSqlString(raw) {
    return raw.replace(/'/g, "''");
}
function buildAlterColumnWarnings(previousSqlType, nextSqlType, previousNullable, nextNullable) {
    const warnings = [];
    const previous = parseTypeArgs(previousSqlType);
    const next = parseTypeArgs(nextSqlType);
    if (previous.base !== next.base) {
        warnings.push(`Column type family changes from ${previous.base} to ${next.base}; verify existing data can convert.`);
    }
    const previousSize = numericArg(previous.args[0]);
    const nextSize = numericArg(next.args[0]);
    const sizedTypes = new Set(['NVARCHAR', 'NCHAR', 'VARCHAR', 'CHAR', 'VARBINARY', 'BINARY']);
    if (previous.base === next.base && sizedTypes.has(previous.base)) {
        if (previousSize === 'MAX' && typeof nextSize === 'number') {
            warnings.push(`Column size changes from ${previousSqlType} to ${nextSqlType}; existing values may be truncated or block migration.`);
        }
        else if (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize) {
            warnings.push(`Column size shrinks from ${previousSqlType} to ${nextSqlType}; existing values may be truncated or block migration.`);
        }
    }
    const precisionTypes = new Set(['DECIMAL', 'NUMERIC']);
    if (previous.base === next.base && precisionTypes.has(previous.base)) {
        const previousPrecision = numericArg(previous.args[0]);
        const nextPrecision = numericArg(next.args[0]);
        const previousScale = numericArg(previous.args[1]);
        const nextScale = numericArg(next.args[1]);
        if (typeof previousPrecision === 'number' &&
            typeof nextPrecision === 'number' &&
            nextPrecision < previousPrecision) {
            warnings.push(`Column precision shrinks from ${previousSqlType} to ${nextSqlType}; existing numeric values may not fit.`);
        }
        if (typeof previousScale === 'number' && typeof nextScale === 'number' && nextScale < previousScale) {
            warnings.push(`Column scale shrinks from ${previousSqlType} to ${nextSqlType}; existing numeric values may lose fractional precision.`);
        }
    }
    if (previousNullable && !nextNullable) {
        warnings.push('Column changes from NULL to NOT NULL; existing NULL values must be cleaned before applying.');
    }
    return warnings;
}
function buildAlterColumnPreflightSql(tableName, columnName, previousSqlType, nextSqlType, previousNullable, nextNullable) {
    const checks = [];
    const table = quoteTableName(tableName);
    const col = quoteColumnName(columnName);
    const label = `${tableName}.${columnName}`;
    const previous = parseTypeArgs(previousSqlType);
    const next = parseTypeArgs(nextSqlType);
    if (previousNullable && !nextNullable) {
        checks.push(`IF EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NULL)
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} contains NULL values.', 1`);
    }
    const previousSize = numericArg(previous.args[0]);
    const nextSize = numericArg(next.args[0]);
    const stringTypes = new Set(['NVARCHAR', 'NCHAR', 'VARCHAR', 'CHAR']);
    const binaryTypes = new Set(['VARBINARY', 'BINARY']);
    if (previous.base === next.base && stringTypes.has(previous.base)) {
        if ((previousSize === 'MAX' && typeof nextSize === 'number') || (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize)) {
            checks.push(`IF EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND LEN(${col}) > ${nextSize})
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} has values longer than ${nextSize}.', 1`);
        }
    }
    if (previous.base === next.base && binaryTypes.has(previous.base)) {
        if ((previousSize === 'MAX' && typeof nextSize === 'number') || (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize)) {
            checks.push(`IF EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND DATALENGTH(${col}) > ${nextSize})
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} has binary values longer than ${nextSize} bytes.', 1`);
        }
    }
    const precisionTypes = new Set(['DECIMAL', 'NUMERIC']);
    const previousPrecision = numericArg(previous.args[0]);
    const nextPrecision = numericArg(next.args[0]);
    const previousScale = numericArg(previous.args[1]);
    const nextScale = numericArg(next.args[1]);
    const precisionShrinks = previous.base === next.base &&
        precisionTypes.has(previous.base) &&
        ((typeof previousPrecision === 'number' && typeof nextPrecision === 'number' && nextPrecision < previousPrecision) ||
            (typeof previousScale === 'number' && typeof nextScale === 'number' && nextScale < previousScale));
    if (previous.base !== next.base || precisionShrinks) {
        checks.push(`IF EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND TRY_CONVERT(${nextSqlType}, ${col}) IS NULL)
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} contains values that cannot convert to ${escapeSqlString(nextSqlType)}.', 1`);
    }
    return checks;
}
function buildAddColumnPreflightSql(tableName, field) {
    const checks = [];
    const table = quoteTableName(tableName);
    const label = `${tableName}.${field.name}`;
    if (!field.isOptional && !field.defaultValue && !field.isId) {
        checks.push(`IF EXISTS (SELECT 1 FROM ${table})
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} is NOT NULL without a default on a non-empty table.', 1`);
    }
    if (field.isUnique && !field.isId) {
        checks.push(`IF (SELECT COUNT_BIG(*) FROM ${table}) > 1
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} is a new UNIQUE column; existing rows would receive duplicate NULL values.', 1`);
    }
    return checks;
}
function buildUniqueConstraintPreflightSql(tableName, fields) {
    if (fields.length === 0)
        return [];
    const table = quoteTableName(tableName);
    const columns = fields.map(field => quoteColumnName(field));
    const columnsSql = columns.join(', ');
    const label = `${tableName}.${fields.join(',')}`;
    return [`IF EXISTS (
  SELECT 1
  FROM ${table}
  GROUP BY ${columnsSql}
  HAVING COUNT_BIG(*) > 1
)
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(label)} has duplicate values for a UNIQUE constraint.', 1`];
}
/**
 * Reads a `.an5` schema into models to compare against the database.
 *
 * `provider` decides what counts as a column and what counts as a relation; it
 * defaults to SQL Server. A type the provider does not have is reported rather
 * than skipped — skipping it means the migration silently never mentions that
 * column. A token matching a model in the schema is a relation, so that
 * comparison waits until the whole schema has been read.
 */
function parseSchemaText(text, provider = field_types_1.DEFAULT_PROVIDER) {
    const models = [];
    const typeIssues = [];
    const modelRefs = [];
    const viewRefs = [];
    /** `@@schema` per model, applied after the model is read rather than mid-loop. */
    const schemas = new Map();
    const lines = (0, attributes_1.splitSchemaLines)(text);
    let current = null;
    for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('//'))
            continue;
        const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
        if (modelMatch) {
            const modelName = modelMatch[1] ?? 'Model';
            current = {
                name: modelName,
                tableName: modelName.toLowerCase() + 's',
                fields: [],
                compoundUniques: [],
                indexes: [],
            };
            models.push(current);
            continue;
        }
        const viewMatch = line.match(/^view\s+(\w+)\s*\{/);
        if (viewMatch) {
            const viewName = viewMatch[1] ?? 'View';
            current = {
                name: viewName,
                tableName: viewName.toLowerCase() + 's',
                fields: [],
                compoundUniques: [],
                indexes: [],
                isView: true,
            };
            models.push(current);
            continue;
        }
        if (line === '}') {
            current = null;
            continue;
        }
        if (!current)
            continue;
        if (line.startsWith('@@sql') || line.startsWith('@@definition')) {
            if (current.isView) {
                const attribute = line.startsWith('@@sql') ? '@@sql' : '@@definition';
                const sql = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, attribute));
                if (sql !== undefined)
                    current.viewSql = sql.trim();
            }
            continue;
        }
        if (line.startsWith('@@map')) {
            // Just the table name. A schema comes from `@@schema` alone, because a mapped
            // name may legitimately contain a dot: `@@map("reports.daily")` is one table
            // whose name has a dot in it, not a table called `daily` in a schema called
            // `reports`.
            const mapped = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@@map'));
            if (mapped)
                current.tableName = mapped;
            continue;
        }
        if (line.startsWith('@@schema')) {
            // The directive used to be dropped here while `db:push` and the generators
            // honoured it, so a migration created the table in the connection's default
            // schema and the client then read the one the schema file named. Composed in
            // once the whole model has been read, below.
            const declared = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@@schema'));
            if (declared !== undefined)
                schemas.set(current, declared.trim());
            continue;
        }
        if (line.startsWith('@@unique')) {
            if (current.isView)
                continue;
            const parsed = parseMappedIndex(line, '@@unique');
            if (parsed)
                current.compoundUniques.push(parsed);
            continue;
        }
        if (line.startsWith('@@index')) {
            if (current.isView)
                continue;
            const parsed = parseMappedIndex(line, '@@index');
            if (parsed)
                current.indexes.push(parsed);
            continue;
        }
        if (line.startsWith('@@'))
            continue;
        const head = (0, field_types_1.readFieldLineHead)(line);
        if (!head)
            continue;
        if (!(0, field_types_1.resolveFieldType)(head.type, provider)) {
            if (current.isView) {
                viewRefs.push({ view: current.name, field: head.name, type: head.type });
            }
            else {
                modelRefs.push({ model: current.name, field: head.name, type: head.type });
            }
            continue;
        }
        const uniqueArgs = (0, attributes_1.attributeArgs)(line, '@unique');
        current.fields.push({
            name: head.name,
            sqlType: head.type.toUpperCase(),
            isOptional: head.isOptional,
            isId: (0, attributes_1.hasAttribute)(line, '@id'),
            isUnique: (0, attributes_1.hasAttribute)(line, '@unique'),
            uniqueName: uniqueArgs ? (0, attributes_1.stringOption)(uniqueArgs, 'map') : undefined,
            // `@updatedAt` is `now()` under another name, and db:push treats it as such.
            // Without this here a stamp column looked like it had no default and every
            // diff wanted to add one.
            defaultValue: (0, attributes_1.attributeArgs)(line, '@default')
                ?? ((0, attributes_1.hasAttribute)(line, '@updatedAt') ? 'now()' : undefined),
        });
    }
    // `dbo` stays implicit: an unqualified model produces the SQL it always has, and a
    // named one is qualified with the schema the schema file asked for.
    for (const model of models) {
        const schema = schemas.get(model) ?? '';
        if (schema && schema !== 'dbo')
            model.tableName = `${schema}.${model.tableName}`;
    }
    const modelNames = models.map((model) => model.name);
    const tableNames = models.filter((model) => !model.isView).map((model) => model.name);
    const viewNames = new Set(models.filter((model) => model.isView).map((model) => model.name));
    for (const ref of modelRefs) {
        if (viewNames.has(ref.type)) {
            typeIssues.push({
                path: `${ref.model}.${ref.field}`,
                message: `"${ref.type}" is a view and cannot be the target of a relation; select from it directly instead`,
            });
            continue;
        }
        if (!tableNames.includes(ref.type)) {
            typeIssues.push({
                path: `${ref.model}.${ref.field}`,
                message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, provider, tableNames),
            });
        }
    }
    for (const ref of viewRefs) {
        typeIssues.push({
            path: `${ref.view}.${ref.field}`,
            message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, provider, modelNames),
        });
    }
    for (const model of models) {
        if (model.isView && !model.viewSql?.trim()) {
            typeIssues.push({ path: model.name, message: 'a view needs @@sql("SELECT ...")' });
        }
    }
    if (typeIssues.length > 0)
        throw new field_types_1.FieldTypeError(provider, typeIssues);
    return models;
}
function buildCreateTableSql(model) {
    const colDefs = model.fields.map(f => {
        let def = `[${f.name}] ${f.sqlType}`;
        if (f.isId)
            def += ' PRIMARY KEY';
        // A default does not make a column nullable. Skipping NOT NULL here created a
        // nullable column that the next diff then wanted to alter back.
        if (!f.isOptional && !f.isId)
            def += ' NOT NULL';
        if (f.defaultValue)
            def += ` ${mapDefault(f.defaultValue)}`;
        // Always named: an unnamed UNIQUE gets a database-generated name, which the
        // next diff cannot match against `UQ_<table>_<field>` and tries to add again.
        if (f.isUnique && !f.isId)
            def += ` CONSTRAINT [${f.uniqueName ?? fieldUniqueConstraintName(model, f)}] UNIQUE`;
        return def;
    });
    for (let idx = 0; idx < model.compoundUniques.length; idx++) {
        const definition = model.compoundUniques[idx];
        if (definition === undefined)
            continue;
        const fields = schemaIndexFields(definition);
        const constraintName = schemaIndexName(definition, () => compoundUniqueConstraintName(model, idx));
        const fieldsStr = fields.map(f => `[${f}]`).join(', ');
        colDefs.push(`CONSTRAINT [${constraintName}] UNIQUE (${fieldsStr})`);
    }
    return `CREATE TABLE ${quoteTableName(model.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
}
/**
 * The migration DDL for a view.
 *
 * `CREATE OR ALTER` is SQL Server's form; `db:migrate` is SQL Server-only today.
 * The body is expected to be a single `SELECT` (`@@sql`), so no batch splitting
 * is needed here — the caller isolates the statement with `GO`.
 */
function buildCreateViewSql(model) {
    if (!model.viewSql?.trim()) {
        throw new Error(`View "${model.name}" has no @@sql("SELECT ...") definition.`);
    }
    // A pasted catalog definition keeps its `CREATE VIEW` header; the header this
    // function writes is the one that names the migrated object.
    const body = (0, dialect_1.viewSqlBody)(model.viewSql);
    return `CREATE OR ALTER VIEW ${quoteTableName(model.tableName)} AS\n${body}`;
}
function buildIndexDiff(model, artifacts, ops) {
    const existingIndexes = new Set((artifacts.indexes || []).map(name => name.toLowerCase()));
    const existingUniques = new Set((artifacts.uniqueConstraints || []).map(name => name.toLowerCase()));
    const expectedIndexes = new Set();
    const expectedUniques = new Set();
    for (const field of model.fields) {
        if (!field.isUnique || field.isId)
            continue;
        const constraintName = field.uniqueName || fieldUniqueConstraintName(model, field);
        expectedUniques.add(constraintName.toLowerCase());
        if (!existingUniques.has(constraintName.toLowerCase())) {
            ops.push({
                type: 'ADD_UNIQUE',
                table: model.tableName,
                column: field.name,
                details: field.name,
                sql: `ALTER TABLE ${quoteTableName(model.tableName)} ADD CONSTRAINT [${constraintName}] UNIQUE ([${field.name}])`,
                preflightSql: buildUniqueConstraintPreflightSql(model.tableName, [field.name]),
            });
        }
    }
    for (let idx = 0; idx < model.compoundUniques.length; idx++) {
        const definition = model.compoundUniques[idx];
        if (definition === undefined)
            continue;
        const fields = schemaIndexFields(definition);
        const constraintName = schemaIndexName(definition, () => compoundUniqueConstraintName(model, idx));
        expectedUniques.add(constraintName.toLowerCase());
        if (!existingUniques.has(constraintName.toLowerCase())) {
            const fieldsStr = fields.map(f => `[${f}]`).join(', ');
            ops.push({
                type: 'ADD_UNIQUE',
                table: model.tableName,
                details: fields.join(', '),
                sql: `ALTER TABLE ${quoteTableName(model.tableName)} ADD CONSTRAINT [${constraintName}] UNIQUE (${fieldsStr})`,
                preflightSql: buildUniqueConstraintPreflightSql(model.tableName, fields),
            });
        }
    }
    for (const definition of model.indexes) {
        const fields = schemaIndexFields(definition);
        const name = schemaIndexName(definition, fields => indexName(model, fields));
        expectedIndexes.add(name.toLowerCase());
        if (!existingIndexes.has(name.toLowerCase())) {
            const fieldsStr = fields.map(f => `[${f}]`).join(', ');
            const includeFields = Array.isArray(definition) ? [] : definition.includeFields || [];
            const includeSql = includeFields.length > 0 ? ` INCLUDE (${includeFields.map(f => `[${f}]`).join(', ')})` : '';
            const filter = Array.isArray(definition) ? undefined : definition.filter;
            const filterSql = filter ? ` WHERE ${filter}` : '';
            const options = Array.isArray(definition) ? undefined : definition.options;
            const optionsSql = options ? ` WITH (${options})` : '';
            ops.push({
                type: 'ADD_INDEX',
                table: model.tableName,
                details: [
                    fields.join(', '),
                    includeFields.length > 0 ? `include ${includeFields.join(', ')}` : '',
                    filter ? `filter ${filter}` : '',
                    options ? `options ${options}` : '',
                ].filter(Boolean).join(' '),
                sql: `CREATE INDEX [${name}] ON ${quoteTableName(model.tableName)} (${fieldsStr})${includeSql}${filterSql}${optionsSql}`,
            });
        }
    }
    const managedIndexPrefix = `ix_${safeIdentifierName(model.tableName).toLowerCase()}_`;
    for (const name of artifacts.indexes || []) {
        const normalized = name.toLowerCase();
        if (normalized.startsWith(managedIndexPrefix) && !expectedIndexes.has(normalized)) {
            ops.push({
                type: 'DROP_INDEX',
                table: model.tableName,
                details: 'Index not in schema',
                sql: `-- DROP INDEX [${name.replace(/]/g, ']]')}] ON ${quoteTableName(model.tableName)}`,
            });
        }
    }
    const managedUniquePrefix = `uq_${safeIdentifierName(model.tableName).toLowerCase()}_`;
    for (const name of artifacts.uniqueConstraints || []) {
        const normalized = name.toLowerCase();
        if (normalized.startsWith(managedUniquePrefix) && !expectedUniques.has(normalized)) {
            ops.push({
                type: 'DROP_UNIQUE',
                table: model.tableName,
                details: 'Unique constraint not in schema',
                sql: `-- ALTER TABLE ${quoteTableName(model.tableName)} DROP CONSTRAINT [${name.replace(/]/g, ']]')}]`,
            });
        }
    }
}
function generateColumnDiff(model, dbColumns, ops) {
    const dbColumnMap = new Map(dbColumns.map(c => [c.columnName.toLowerCase(), c]));
    const schemaFields = model.fields;
    for (const f of schemaFields) {
        const existing = dbColumnMap.get(f.name.toLowerCase());
        if (!existing) {
            let def = `[${f.name}] ${f.sqlType}`;
            if (f.isId)
                def += ' PRIMARY KEY';
            if (!f.isOptional && !f.isId)
                def += ' NOT NULL';
            if (f.defaultValue)
                def += ` ${mapDefault(f.defaultValue)}`;
            if (f.isUnique && !f.isId)
                def += ` CONSTRAINT [${f.uniqueName ?? fieldUniqueConstraintName(model, f)}] UNIQUE`;
            ops.push({
                type: 'ADD_COLUMN',
                table: model.tableName,
                column: f.name,
                sql: `ALTER TABLE ${quoteTableName(model.tableName)} ADD ${def}`,
                preflightSql: buildAddColumnPreflightSql(model.tableName, f),
            });
            continue;
        }
        const schemaType = f.sqlType.toUpperCase();
        const dbType = formatDbColumnSqlType(existing);
        const schemaNullable = f.isOptional;
        const dbNullable = Boolean(existing.isNullable);
        const typeChanged = schemaType !== dbType;
        const nullableChanged = schemaNullable !== dbNullable;
        if (typeChanged || nullableChanged) {
            const def = `[${f.name}] ${f.sqlType}`;
            const riskWarnings = buildAlterColumnWarnings(dbType, schemaType, dbNullable, schemaNullable);
            const preflightSql = buildAlterColumnPreflightSql(model.tableName, f.name, dbType, schemaType, dbNullable, schemaNullable);
            ops.push({
                type: 'ALTER_COLUMN',
                table: model.tableName,
                column: f.name,
                details: typeChanged
                    ? `type ${dbType} -> ${schemaType}${nullableChanged ? `, nullable ${dbNullable} -> ${schemaNullable}` : ''}`
                    : `nullable ${dbNullable} -> ${schemaNullable}`,
                sql: `ALTER TABLE ${quoteTableName(model.tableName)} ALTER COLUMN ${def}`,
                previousSqlType: dbType,
                previousNullable: dbNullable,
                riskWarnings,
                preflightSql,
            });
        }
    }
    const schemaColumnNames = new Set(schemaFields.map(f => f.name.toLowerCase()));
    for (const c of dbColumns) {
        if (!schemaColumnNames.has(c.columnName.toLowerCase())) {
            ops.push({
                type: 'DROP_COLUMN',
                table: model.tableName,
                column: c.columnName,
                details: 'Column not in schema',
                sql: `-- ALTER TABLE ${quoteTableName(model.tableName)} DROP COLUMN [${c.columnName}]`,
            });
        }
    }
}
async function generateDiff(schemaModels, dbTables, introspectTable, introspectArtifacts, dbViews = [], introspectViewDefinition) {
    const ops = [];
    const tableModels = schemaModels.filter(model => !model.isView);
    // A view may read another view. The migration applies its operations in
    // order, so the referenced view has to be created first.
    const viewModels = (0, view_order_1.orderViewsByDependency)(schemaModels.filter(model => model.isView).map(model => ({
        model,
        names: [model.tableName, model.name],
        sql: model.viewSql ?? '',
    }))).ordered.map(entry => entry.model);
    const dbTableIdentities = new Set(dbTables.map(tableIdentityName));
    const schemaTableNames = new Set(tableModels.map(m => tableIdentityName(m.tableName)));
    for (const model of tableModels) {
        if (!dbTableIdentities.has(tableIdentityName(model.tableName))) {
            ops.push({ type: 'CREATE_TABLE', table: model.tableName, sql: buildCreateTableSql(model) });
            buildIndexDiff(model, {
                indexes: [],
                uniqueConstraints: [
                    ...model.fields.filter(field => field.isUnique && !field.isId).map(field => field.uniqueName || fieldUniqueConstraintName(model, field)),
                    ...model.compoundUniques.map((definition, idx) => schemaIndexName(definition, () => compoundUniqueConstraintName(model, idx))),
                ],
            }, ops);
        }
    }
    for (const model of tableModels) {
        if (dbTableIdentities.has(tableIdentityName(model.tableName))) {
            const dbColumns = await introspectTable(model.tableName);
            generateColumnDiff(model, dbColumns, ops);
            if (introspectArtifacts) {
                const artifacts = await introspectArtifacts(model.tableName);
                // A new `@unique` column already carries its UNIQUE in the ADD COLUMN
                // statement. Without this, buildIndexDiff saw the constraint missing from
                // the catalog and emitted a second, identically named one, failing on apply.
                const existingColumns = new Set(dbColumns.map(column => column.columnName.toLowerCase()));
                const addedUniqueNames = model.fields
                    .filter(field => field.isUnique && !field.isId && !existingColumns.has(field.name.toLowerCase()))
                    .map(field => field.uniqueName ?? fieldUniqueConstraintName(model, field));
                buildIndexDiff(model, {
                    indexes: artifacts.indexes ?? [],
                    uniqueConstraints: [...(artifacts.uniqueConstraints ?? []), ...addedUniqueNames],
                }, ops);
            }
        }
    }
    for (const tableName of dbTables) {
        if (!schemaTableNames.has(tableIdentityName(tableName))) {
            ops.push({
                type: 'DROP_TABLE',
                table: tableName,
                details: 'Table not in schema',
                sql: `-- DROP TABLE ${quoteTableName(tableName)}`,
            });
        }
    }
    // Views are compared by their SQL body rather than by name alone: a view whose
    // query changed has to be replaced, and a catalog that reformats whitespace must
    // not make every diff think it did.
    const dbViewIdentities = new Map(dbViews.map(name => [tableIdentityName(name), name]));
    const schemaViewNames = new Set(viewModels.map(view => tableIdentityName(view.tableName)));
    for (const view of viewModels) {
        const existingName = dbViewIdentities.get(tableIdentityName(view.tableName));
        const existingDefinition = existingName !== undefined && introspectViewDefinition
            ? await introspectViewDefinition(existingName)
            : null;
        if (existingName !== undefined && (0, dialect_1.normalizeViewSql)(existingDefinition) === (0, dialect_1.normalizeViewSql)(view.viewSql)) {
            continue;
        }
        const previousSql = existingDefinition
            ? /^\s*CREATE\s/i.test(existingDefinition)
                ? existingDefinition.trim()
                : `CREATE OR ALTER VIEW ${quoteTableName(view.tableName)} AS\n${existingDefinition.trim().replace(/;+\s*$/, '')}`
            : undefined;
        ops.push({
            type: 'CREATE_VIEW',
            table: view.tableName,
            details: existingName !== undefined ? 'View definition changed' : 'View not in database',
            sql: buildCreateViewSql(view),
            ...(previousSql !== undefined ? { previousSql } : {}),
        });
    }
    for (const viewName of dbViews) {
        if (!schemaViewNames.has(tableIdentityName(viewName))) {
            ops.push({
                type: 'DROP_VIEW',
                table: viewName,
                details: 'View not in schema',
                sql: `-- DROP VIEW ${quoteTableName(viewName)}`,
            });
        }
    }
    return ops;
}
function buildMigrationFile(timestamp, ops) {
    const preflightSql = ops.flatMap(op => op.preflightSql || []);
    const lines = [
        `-- Migration: ${timestamp}`,
        '-- Generated by an5Orm migrate',
        '',
    ];
    if (preflightSql.length > 0) {
        lines.push('-- migrate:preflight');
        lines.push('');
        for (const sql of preflightSql) {
            lines.push(sql);
            lines.push('GO');
        }
        lines.push('');
    }
    lines.push('-- migrate:up');
    lines.push('');
    for (const op of ops) {
        // `CREATE VIEW` has to be the first statement in a T-SQL batch, so it is fenced
        // with GO. Without this, a migration that creates a table and then a view fails
        // with "'CREATE VIEW' must be the first statement in a query batch".
        const lastMeaningfulLine = [...lines].reverse().find(line => line.trim() !== '');
        if (op.type === 'CREATE_VIEW' && lastMeaningfulLine !== 'GO')
            lines.push('GO');
        lines.push(`-- ${op.type}: ${op.table}`);
        for (const warning of op.riskWarnings || []) {
            lines.push(`-- WARNING: ${warning}`);
        }
        if (op.sql)
            lines.push(op.sql);
        if (op.type === 'CREATE_VIEW')
            lines.push('GO');
        lines.push('');
    }
    lines.push('-- migrate:down');
    const downSql = buildDownMigrationSql(ops);
    if (downSql.trim()) {
        lines.push(downSql);
    }
    else {
        lines.push('-- Add rollback SQL here. Leave empty to make rollback explicit and non-destructive.');
    }
    lines.push('');
    return lines.join('\n');
}
function buildDownMigrationSql(ops) {
    const lines = [];
    for (const op of [...ops].reverse()) {
        const table = quoteTableName(op.table);
        if (op.type === 'CREATE_TABLE') {
            lines.push(`DROP TABLE ${table}`);
            continue;
        }
        if (op.type === 'CREATE_VIEW') {
            // A replaced view is restored to its old definition; a newly created one is
            // simply dropped. `CREATE OR ALTER` is fenced by the GO this function joins.
            lines.push(op.previousSql ? op.previousSql.trim() : `DROP VIEW ${table}`);
            continue;
        }
        if (op.type === 'DROP_VIEW') {
            // Its up SQL is a commented `DROP VIEW`; dropping a view is never automatic,
            // so there is nothing to undo here.
            continue;
        }
        if (op.type === 'ADD_COLUMN' && op.column) {
            lines.push(`ALTER TABLE ${table} DROP COLUMN [${op.column}]`);
            continue;
        }
        if (op.type === 'ADD_INDEX') {
            const indexName = matchFirst(op.sql, /CREATE\s+INDEX\s+\[([^\]]+)]/i);
            if (indexName)
                lines.push(`DROP INDEX [${indexName}] ON ${table}`);
            continue;
        }
        if (op.type === 'ADD_UNIQUE') {
            const constraintName = matchFirst(op.sql, /ADD\s+CONSTRAINT\s+\[([^\]]+)]/i);
            if (constraintName)
                lines.push(`ALTER TABLE ${table} DROP CONSTRAINT [${constraintName}]`);
            continue;
        }
        if (op.sql && !op.sql.trim().startsWith('--')) {
            if (op.type === 'ALTER_COLUMN' && op.column && op.previousSqlType && typeof op.previousNullable === 'boolean') {
                lines.push(`ALTER TABLE ${table} ALTER COLUMN [${op.column}] ${op.previousSqlType}${op.previousNullable ? ' NULL' : ' NOT NULL'}`);
                continue;
            }
            lines.push(`-- Manual rollback required for ${op.type}: ${op.table}${op.column ? `.${op.column}` : ''}`);
        }
    }
    return lines.join('\nGO\n');
}
function parseMigrationSections(sql) {
    const markerPattern = /^\s*--\s*migrate:(preflight|up|down)\s*$/gim;
    const markers = [];
    let match;
    while ((match = markerPattern.exec(sql))) {
        markers.push({ name: (match[1] ?? 'up').toLowerCase(), index: match.index, end: match.index + match[0].length });
    }
    if (markers.length === 0) {
        return { preflight: '', up: sql.trim(), down: '', hasDown: false };
    }
    const section = (name) => {
        const markerIndex = markers.findIndex(marker => marker.name === name);
        if (markerIndex < 0)
            return '';
        const marker = markers[markerIndex];
        if (!marker)
            return '';
        const start = marker.end;
        const end = markers[markerIndex + 1]?.index ?? sql.length;
        return sql.slice(start, end).trim();
    };
    return {
        preflight: section('preflight'),
        up: section('up'),
        down: section('down'),
        hasDown: markers.some(marker => marker.name === 'down'),
    };
}
function splitSqlBatches(sql) {
    return sql
        .split(/^\s*GO\s*;?\s*$/gim)
        .map(batch => batch.trim())
        .filter(batch => {
        if (!batch)
            return false;
        const nonCommentLines = batch
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('--'));
        return nonCommentLines.length > 0;
    });
}
function parseRollbackSelection(args, applied) {
    if (args.length === 0)
        return { count: 1, label: 'latest migration' };
    if (args[0] === '--to') {
        const target = args[1];
        if (!target)
            throw new Error('Rollback target is required after --to.');
        const index = applied.findIndex(row => row.id === target);
        if (index < 0)
            throw new Error(`Rollback target is not applied: ${target}`);
        return { count: applied.length - index, label: `through ${target}` };
    }
    const count = Number.parseInt(args[0] ?? '', 10);
    if (!Number.isFinite(count) || count < 1) {
        throw new Error('Rollback steps must be a positive integer, or use --to <migration-file>.');
    }
    return { count, label: `${count} migration${count === 1 ? '' : 's'}` };
}
function parseMigrationCommandOptions(args) {
    const rest = [];
    let preview = false;
    for (const arg of args) {
        if (arg === '--preview') {
            preview = true;
        }
        else {
            if (arg.startsWith('-') && arg !== '--to')
                throw new Error(`Unknown migration option: ${arg}; use --preview to inspect SQL`);
            rest.push(arg);
        }
    }
    return { preview, rest };
}

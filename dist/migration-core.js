"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
exports.buildIndexDiff = buildIndexDiff;
exports.generateColumnDiff = generateColumnDiff;
exports.generateDiff = generateDiff;
exports.buildMigrationFile = buildMigrationFile;
exports.buildDownMigrationSql = buildDownMigrationSql;
exports.parseMigrationSections = parseMigrationSections;
exports.splitSqlBatches = splitSqlBatches;
exports.parseRollbackSelection = parseRollbackSelection;
exports.parseMigrationCommandOptions = parseMigrationCommandOptions;
const field_types_1 = require("./generator/src/field-types");
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
    const match = line.match(new RegExp(`${directive}\\(\\[([\\w,\\s]+)\\]([^)]*)\\)`));
    if (!match)
        return null;
    const fields = (match[1] ?? '').split(',').map(field => field.trim()).filter(Boolean);
    const nameMatch = match[2]?.match(/\bmap\s*:\s*"([^"]+)"/);
    const includeMatch = match[2]?.match(/\binclude\s*:\s*\[([\w,\s]+)\]/);
    const filterMatch = match[2]?.match(/\bfilter\s*:\s*"([^"]+)"/);
    const optionsMatch = match[2]?.match(/\boptions\s*:\s*"([^"]+)"/);
    const definition = { fields };
    if (nameMatch?.[1])
        definition.name = nameMatch[1];
    if (includeMatch?.[1])
        definition.includeFields = includeMatch[1].split(',').map(field => field.trim()).filter(Boolean);
    if (filterMatch?.[1])
        definition.filter = filterMatch[1];
    if (optionsMatch?.[1])
        definition.options = optionsMatch[1];
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
    /** `@@schema` per model, applied after the model is read rather than mid-loop. */
    const schemas = new Map();
    const lines = text.split('\n');
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
        if (line === '}') {
            current = null;
            continue;
        }
        if (!current)
            continue;
        if (line.startsWith('@@map')) {
            // Just the table name. A schema comes from `@@schema` alone, because a mapped
            // name may legitimately contain a dot: `@@map("reports.daily")` is one table
            // whose name has a dot in it, not a table called `daily` in a schema called
            // `reports`.
            const m = line.match(/@@map\("(.+)"\)/);
            if (m?.[1])
                current.tableName = m[1];
            continue;
        }
        if (line.startsWith('@@schema')) {
            // The directive used to be dropped here while `db:push` and the generators
            // honoured it, so a migration created the table in the connection's default
            // schema and the client then read the one the schema file named. Composed in
            // once the whole model has been read, below.
            const m = line.match(/@@schema\("(.*)"\)/);
            if (m !== null)
                schemas.set(current, m[1]?.trim() ?? '');
            continue;
        }
        if (line.startsWith('@@unique')) {
            const parsed = parseMappedIndex(line, '@@unique');
            if (parsed)
                current.compoundUniques.push(parsed);
            continue;
        }
        if (line.startsWith('@@index')) {
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
            modelRefs.push({ model: current.name, field: head.name, type: head.type });
            continue;
        }
        current.fields.push({
            name: head.name,
            sqlType: head.type.toUpperCase(),
            isOptional: head.isOptional,
            isId: line.includes('@id'),
            isUnique: line.includes('@unique'),
            uniqueName: line.match(/@unique\([^)]*\bmap\s*:\s*"([^"]+)"/)?.[1],
            // `@updatedAt` is `now()` under another name, and db:push treats it as such.
            // Without this here a stamp column looked like it had no default and every
            // diff wanted to add one.
            defaultValue: line.match(/@default\((.*)\)/)?.[1]
                ?? (line.includes('@updatedAt') ? 'now()' : undefined),
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
    for (const ref of modelRefs) {
        if (!modelNames.includes(ref.type)) {
            typeIssues.push({
                path: `${ref.model}.${ref.field}`,
                message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, provider, modelNames),
            });
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
        if (f.defaultValue)
            def += ` ${mapDefault(f.defaultValue)}`;
        if (!f.isOptional && !f.defaultValue && !f.isId)
            def += ' NOT NULL';
        if (f.isUnique && !f.isId)
            def += f.uniqueName ? ` CONSTRAINT [${f.uniqueName}] UNIQUE` : ' UNIQUE';
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
            if (f.defaultValue)
                def += ` ${mapDefault(f.defaultValue)}`;
            if (!f.isOptional && !f.defaultValue && !f.isId)
                def += ' NOT NULL';
            if (f.isUnique && !f.isId)
                def += f.uniqueName ? ` CONSTRAINT [${f.uniqueName}] UNIQUE` : ' UNIQUE';
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
async function generateDiff(schemaModels, dbTables, introspectTable, introspectArtifacts) {
    const ops = [];
    const dbTableIdentities = new Set(dbTables.map(tableIdentityName));
    const schemaTableNames = new Set(schemaModels.map(m => tableIdentityName(m.tableName)));
    for (const model of schemaModels) {
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
    for (const model of schemaModels) {
        if (dbTableIdentities.has(tableIdentityName(model.tableName))) {
            const dbColumns = await introspectTable(model.tableName);
            generateColumnDiff(model, dbColumns, ops);
            if (introspectArtifacts) {
                buildIndexDiff(model, await introspectArtifacts(model.tableName), ops);
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
        lines.push(`-- ${op.type}: ${op.table}`);
        for (const warning of op.riskWarnings || []) {
            lines.push(`-- WARNING: ${warning}`);
        }
        if (op.sql)
            lines.push(op.sql);
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
    let dryRun = false;
    for (const arg of args) {
        if (arg === '--dry-run') {
            dryRun = true;
        }
        else {
            rest.push(arg);
        }
    }
    return { dryRun, rest };
}
//# sourceMappingURL=migration-core.js.map
export interface SchemaField {
  name: string;
  sqlType: string;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  defaultValue?: string;
}

export interface SchemaModel {
  name: string;
  tableName: string;
  fields: SchemaField[];
  compoundUniques: string[][];
  indexes: string[][];
}

export interface DbColumn {
  columnName: string;
  dataType: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  defaultValue?: string;
}

export interface MigrationOp {
  type: 'CREATE_TABLE' | 'ADD_COLUMN' | 'DROP_COLUMN' | 'ALTER_COLUMN' | 'ADD_INDEX' | 'ADD_UNIQUE' | 'DROP_INDEX' | 'DROP_UNIQUE' | 'DROP_TABLE';
  table: string;
  column?: string;
  details?: string;
  sql?: string;
  previousSqlType?: string;
  previousNullable?: boolean;
  riskWarnings?: string[];
  preflightSql?: string[];
}

export interface TableArtifacts {
  indexes?: string[];
  uniqueConstraints?: string[];
}

export interface MigrationSections {
  preflight: string;
  up: string;
  down: string;
  hasDown: boolean;
}

export interface AppliedMigrationRef {
  id: string;
}

export interface MigrationCommandOptions {
  dryRun: boolean;
  rest: string[];
}

const AN5_TYPES = new Set([
  'NVARCHAR', 'VARCHAR', 'CHAR', 'NCHAR', 'TEXT', 'NTEXT', 'XML',
  'INT', 'SMALLINT', 'TINYINT', 'BIGINT', 'FLOAT', 'REAL', 'DECIMAL', 'NUMERIC',
  'MONEY', 'SMALLMONEY', 'BIT',
  'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATE', 'TIME', 'DATETIMEOFFSET',
  'VARBINARY', 'BINARY', 'IMAGE',
  'UNIQUEIDENTIFIER', 'SQL_VARIANT', 'ROWVERSION',
  'HIERARCHYID', 'GEOGRAPHY', 'GEOMETRY', 'VECTOR',
]);

export function parseSqlType(raw: string): string {
  const match = raw.match(/^(\w+)/);
  return match ? match[1].toUpperCase() : raw.toUpperCase();
}

export function formatDbColumnSqlType(column: DbColumn): string {
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

export function mapDefault(val: string): string {
  if (val === 'uuid()') return 'DEFAULT NEWID()';
  if (val === 'cuid()') return 'DEFAULT NEWID()';
  if (val === 'now()') return 'DEFAULT CURRENT_TIMESTAMP';
  if (val === 'autoincrement()') return 'IDENTITY(1,1)';
  if (val === 'true') return 'DEFAULT 1';
  if (val === 'false') return 'DEFAULT 0';
  if (/^".*"$/.test(val)) return `DEFAULT '${val.slice(1, -1).replace(/'/g, "''")}'`;
  return `DEFAULT ${val}`;
}

export function safeIdentifierName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function fieldUniqueConstraintName(model: SchemaModel, field: SchemaField): string {
  return `UQ_${safeIdentifierName(model.tableName)}_${safeIdentifierName(field.name)}`;
}

function compoundUniqueConstraintName(model: SchemaModel, idx: number): string {
  return `UQ_${safeIdentifierName(model.tableName)}_compound_${idx}`;
}

function indexName(model: SchemaModel, fields: string[]): string {
  return `IX_${safeIdentifierName(model.tableName)}_${safeIdentifierName(fields.join('_'))}`;
}

export function quoteTableName(raw: string): string {
  return raw
    .replace(/"/g, '')
    .split('.')
    .map(part => part.trim().replace(/^\[|\]$/g, ''))
    .filter(Boolean)
    .map(part => `[${part.replace(/]/g, ']]')}]`)
    .join('.');
}

function matchFirst(sql: string | undefined, pattern: RegExp): string | null {
  if (!sql) return null;
  const match = sql.match(pattern);
  return match ? match[1] : null;
}

function parseTypeArgs(sqlType: string): { base: string; args: string[] } {
  const match = sqlType.match(/^(\w+)(?:\(([^)]+)\))?/);
  return {
    base: match ? match[1].toUpperCase() : parseSqlType(sqlType),
    args: match && match[2] ? match[2].split(',').map(arg => arg.trim().toUpperCase()) : [],
  };
}

function numericArg(value: string | undefined): number | 'MAX' | undefined {
  if (!value) return undefined;
  if (value === 'MAX') return 'MAX';
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function quoteColumnName(raw: string): string {
  return `[${raw.replace(/]/g, ']]')}]`;
}

function escapeSqlString(raw: string): string {
  return raw.replace(/'/g, "''");
}

export function buildAlterColumnWarnings(
  previousSqlType: string,
  nextSqlType: string,
  previousNullable: boolean,
  nextNullable: boolean
): string[] {
  const warnings: string[] = [];
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
    } else if (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize) {
      warnings.push(`Column size shrinks from ${previousSqlType} to ${nextSqlType}; existing values may be truncated or block migration.`);
    }
  }

  const precisionTypes = new Set(['DECIMAL', 'NUMERIC']);
  if (previous.base === next.base && precisionTypes.has(previous.base)) {
    const previousPrecision = numericArg(previous.args[0]);
    const nextPrecision = numericArg(next.args[0]);
    const previousScale = numericArg(previous.args[1]);
    const nextScale = numericArg(next.args[1]);
    if (
      typeof previousPrecision === 'number' &&
      typeof nextPrecision === 'number' &&
      nextPrecision < previousPrecision
    ) {
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

export function buildAlterColumnPreflightSql(
  tableName: string,
  columnName: string,
  previousSqlType: string,
  nextSqlType: string,
  previousNullable: boolean,
  nextNullable: boolean
): string[] {
  const checks: string[] = [];
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

export function buildAddColumnPreflightSql(tableName: string, field: SchemaField): string[] {
  const checks: string[] = [];
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

export function buildUniqueConstraintPreflightSql(tableName: string, fields: string[]): string[] {
  if (fields.length === 0) return [];

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

export function parseSchemaText(text: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  const lines = text.split('\n');
  let current: SchemaModel | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('//')) continue;

    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      current = {
        name: modelMatch[1],
        tableName: modelMatch[1].toLowerCase() + 's',
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
    if (!current) continue;

    if (line.startsWith('@@map')) {
      const m = line.match(/@@map\("(.+)"\)/);
      if (m) current.tableName = m[1];
      continue;
    }
    if (line.startsWith('@@unique')) {
      const m = line.match(/@@unique\(\[([\w,\s]+)\]\)/);
      if (m) current.compoundUniques.push(m[1].split(',').map(f => f.trim()));
      continue;
    }
    if (line.startsWith('@@index')) {
      const m = line.match(/@@index\(\[([\w,\s]+)\]\)/);
      if (m) current.indexes.push(m[1].split(',').map(f => f.trim()));
      continue;
    }
    if (line.startsWith('@@')) continue;

    const parts = line.split(/\s+/);
    const fieldName = parts[0];
    const fieldType = parts[1];
    if (!fieldName || !fieldType) continue;

    const cleanType = fieldType.replace('[]', '').replace('?', '');
    const sqlBase = parseSqlType(cleanType);
    if (!AN5_TYPES.has(sqlBase)) continue;

    current.fields.push({
      name: fieldName,
      sqlType: cleanType.toUpperCase(),
      isOptional: fieldType.endsWith('?'),
      isId: line.includes('@id'),
      isUnique: line.includes('@unique'),
      defaultValue: line.match(/@default\((.*)\)/)?.[1],
    });
  }

  return models;
}

export function buildCreateTableSql(model: SchemaModel): string {
  const colDefs = model.fields.map(f => {
    let def = `[${f.name}] ${f.sqlType}`;
    if (f.isId) def += ' PRIMARY KEY';
    if (f.defaultValue) def += ` ${mapDefault(f.defaultValue)}`;
    if (!f.isOptional && !f.defaultValue && !f.isId) def += ' NOT NULL';
    if (f.isUnique && !f.isId) def += ' UNIQUE';
    return def;
  });

  for (let idx = 0; idx < model.compoundUniques.length; idx++) {
    const fields = model.compoundUniques[idx];
    const constraintName = compoundUniqueConstraintName(model, idx);
    const fieldsStr = fields.map(f => `[${f}]`).join(', ');
    colDefs.push(`CONSTRAINT [${constraintName}] UNIQUE (${fieldsStr})`);
  }

  return `CREATE TABLE ${quoteTableName(model.tableName)} (\n  ${colDefs.join(',\n  ')}\n)`;
}

export function buildIndexDiff(model: SchemaModel, artifacts: TableArtifacts, ops: MigrationOp[]): void {
  const existingIndexes = new Set((artifacts.indexes || []).map(name => name.toLowerCase()));
  const existingUniques = new Set((artifacts.uniqueConstraints || []).map(name => name.toLowerCase()));
  const expectedIndexes = new Set<string>();
  const expectedUniques = new Set<string>();

  for (const field of model.fields) {
    if (!field.isUnique || field.isId) continue;
    const constraintName = fieldUniqueConstraintName(model, field);
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
    const fields = model.compoundUniques[idx];
    const constraintName = compoundUniqueConstraintName(model, idx);
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

  for (const fields of model.indexes) {
    const name = indexName(model, fields);
    expectedIndexes.add(name.toLowerCase());
    if (!existingIndexes.has(name.toLowerCase())) {
      const fieldsStr = fields.map(f => `[${f}]`).join(', ');
      ops.push({
        type: 'ADD_INDEX',
        table: model.tableName,
        details: fields.join(', '),
        sql: `CREATE INDEX [${name}] ON ${quoteTableName(model.tableName)} (${fieldsStr})`,
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

export function generateColumnDiff(
  model: SchemaModel,
  dbColumns: DbColumn[],
  ops: MigrationOp[]
): void {
  const dbColumnMap = new Map(dbColumns.map(c => [c.columnName.toLowerCase(), c]));
  const schemaFields = model.fields;

  for (const f of schemaFields) {
    const existing = dbColumnMap.get(f.name.toLowerCase());
    if (!existing) {
      let def = `[${f.name}] ${f.sqlType}`;
      if (f.isId) def += ' PRIMARY KEY';
      if (f.defaultValue) def += ` ${mapDefault(f.defaultValue)}`;
      if (!f.isOptional && !f.defaultValue && !f.isId) def += ' NOT NULL';
      if (f.isUnique && !f.isId) def += ' UNIQUE';
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
    const schemaBase = parseSqlType(schemaType);
    const dbBase = parseSqlType(dbType);
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

export async function generateDiff(
  schemaModels: SchemaModel[],
  dbTables: string[],
  introspectTable: (tableName: string) => Promise<DbColumn[]>,
  introspectArtifacts?: (tableName: string) => Promise<TableArtifacts>
): Promise<MigrationOp[]> {
  const ops: MigrationOp[] = [];
  const schemaTableNames = new Set(schemaModels.map(m => m.tableName));

  for (const model of schemaModels) {
    if (!dbTables.includes(model.tableName)) {
      ops.push({ type: 'CREATE_TABLE', table: model.tableName, sql: buildCreateTableSql(model) });
      buildIndexDiff(model, {
        indexes: [],
        uniqueConstraints: [
          ...model.fields.filter(field => field.isUnique && !field.isId).map(field => fieldUniqueConstraintName(model, field)),
          ...model.compoundUniques.map((_, idx) => compoundUniqueConstraintName(model, idx)),
        ],
      }, ops);
    }
  }

  for (const model of schemaModels) {
    if (dbTables.includes(model.tableName)) {
      const dbColumns = await introspectTable(model.tableName);
      generateColumnDiff(model, dbColumns, ops);
      if (introspectArtifacts) {
        buildIndexDiff(model, await introspectArtifacts(model.tableName), ops);
      }
    }
  }

  for (const tableName of dbTables) {
    if (!schemaTableNames.has(tableName)) {
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

export function buildMigrationFile(timestamp: string, ops: MigrationOp[]): string {
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
    if (op.sql) lines.push(op.sql);
    lines.push('');
  }

  lines.push('-- migrate:down');
  const downSql = buildDownMigrationSql(ops);
  if (downSql.trim()) {
    lines.push(downSql);
  } else {
    lines.push('-- Add rollback SQL here. Leave empty to make rollback explicit and non-destructive.');
  }
  lines.push('');

  return lines.join('\n');
}

export function buildDownMigrationSql(ops: MigrationOp[]): string {
  const lines: string[] = [];

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
      if (indexName) lines.push(`DROP INDEX [${indexName}] ON ${table}`);
      continue;
    }
    if (op.type === 'ADD_UNIQUE') {
      const constraintName = matchFirst(op.sql, /ADD\s+CONSTRAINT\s+\[([^\]]+)]/i);
      if (constraintName) lines.push(`ALTER TABLE ${table} DROP CONSTRAINT [${constraintName}]`);
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

export function parseMigrationSections(sql: string): MigrationSections {
  const markerPattern = /^\s*--\s*migrate:(preflight|up|down)\s*$/gim;
  const markers: { name: 'preflight' | 'up' | 'down'; index: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = markerPattern.exec(sql))) {
    markers.push({ name: match[1].toLowerCase() as 'preflight' | 'up' | 'down', index: match.index, end: match.index + match[0].length });
  }

  if (markers.length === 0) {
    return { preflight: '', up: sql.trim(), down: '', hasDown: false };
  }

  const section = (name: 'preflight' | 'up' | 'down'): string => {
    const markerIndex = markers.findIndex(marker => marker.name === name);
    if (markerIndex < 0) return '';
    const start = markers[markerIndex].end;
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

export function splitSqlBatches(sql: string): string[] {
  return sql
    .split(/^\s*GO\s*;?\s*$/gim)
    .map(batch => batch.trim())
    .filter(batch => {
      if (!batch) return false;
      const nonCommentLines = batch
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('--'));
      return nonCommentLines.length > 0;
    });
}

export function parseRollbackSelection(args: string[], applied: AppliedMigrationRef[]): { count: number; label: string } {
  if (args.length === 0) return { count: 1, label: 'latest migration' };

  if (args[0] === '--to') {
    const target = args[1];
    if (!target) throw new Error('Rollback target is required after --to.');
    const index = applied.findIndex(row => row.id === target);
    if (index < 0) throw new Error(`Rollback target is not applied: ${target}`);
    return { count: applied.length - index, label: `through ${target}` };
  }

  const count = Number.parseInt(args[0], 10);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error('Rollback steps must be a positive integer, or use --to <migration-file>.');
  }
  return { count, label: `${count} migration${count === 1 ? '' : 's'}` };
}

export function parseMigrationCommandOptions(args: string[]): MigrationCommandOptions {
  const rest: string[] = [];
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else {
      rest.push(arg);
    }
  }

  return { dryRun, rest };
}

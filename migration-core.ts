import {
  attributeArgs,
  hasAttribute,
  parseIndexDirective,
  splitSchemaLines,
  stringOption,
  unquote,
} from './generator/src/attributes';
import {
  DEFAULT_PROVIDER,
  FieldTypeError,
  FieldTypeIssue,
  Provider,
  readFieldLineHead,
  resolveFieldType,
  unknownFieldTypeMessage,
} from './generator/src/field-types';
import { normalizeViewSql, viewSqlBody } from './generator/src/dialect';
import { orderViewsByDependency } from './generator/src/view-order';

export interface SchemaField {
  name: string;
  sqlType: string;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  uniqueName?: string | undefined;
  defaultValue?: string | undefined;
}

export interface SchemaIndexDefinition {
  fields: string[];
  name?: string;
  includeFields?: string[];
  filter?: string;
  options?: string;
}

export interface SchemaModel {
  name: string;
  /**
   * The table to create, schema-qualified when the model named a schema other than
   * `dbo`. `dbo` stays implicit so an unqualified model produces the same SQL it
   * always has.
   */
  tableName: string;
  fields: SchemaField[];
  compoundUniques: Array<string[] | SchemaIndexDefinition>;
  indexes: Array<string[] | SchemaIndexDefinition>;
  /** A `view` block rather than a table. */
  isView?: boolean;
  /** The `@@sql("...")` body; required for a view. */
  viewSql?: string;
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
  type: 'CREATE_TABLE' | 'ADD_COLUMN' | 'DROP_COLUMN' | 'ALTER_COLUMN' | 'ADD_INDEX' | 'ADD_UNIQUE' | 'DROP_INDEX' | 'DROP_UNIQUE' | 'DROP_TABLE' | 'CREATE_VIEW' | 'DROP_VIEW';
  table: string;
  column?: string;
  details?: string;
  sql?: string;
  /** For `CREATE_VIEW`: the definition to restore on rollback. */
  previousSql?: string;
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
  checksum?: string;
}

export interface AppliedMigrationDrift {
  /** Applied migration files whose contents no longer match the recorded checksum. */
  changed: string[];
  /** Applied migration files that are no longer on disk. */
  missing: string[];
}

/**
 * Compares applied migrations with the files they were applied from.
 *
 * `apply` used to look only at the ids, so editing an applied file was invisible
 * and a fresh database would get different SQL from the one already recorded.
 * Rollback already refuses a changed checksum; this catches it before the next
 * migration is applied, where it can still be fixed without a partial history.
 */
export function verifyAppliedMigrations(
  applied: readonly AppliedMigrationRef[],
  readMigration: (id: string) => string | null,
  checksum: (content: string) => string
): AppliedMigrationDrift {
  const drift: AppliedMigrationDrift = { changed: [], missing: [] };
  for (const migration of applied) {
    if (!migration.checksum) continue;
    const content = readMigration(migration.id);
    if (content === null) {
      drift.missing.push(migration.id);
      continue;
    }
    if (checksum(content) !== migration.checksum) drift.changed.push(migration.id);
  }
  return drift;
}

export interface MigrationCommandOptions {
  preview: boolean;
  rest: string[];
}

export function parseSqlType(raw: string): string {
  const match = raw.match(/^(\w+)/);
  return match?.[1]?.toUpperCase() ?? raw.toUpperCase();
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

function schemaIndexFields(definition: string[] | SchemaIndexDefinition): string[] {
  return Array.isArray(definition) ? definition : definition.fields;
}

function schemaIndexName(
  definition: string[] | SchemaIndexDefinition,
  fallback: (fields: string[]) => string
): string {
  if (!Array.isArray(definition) && definition.name) return definition.name;
  return fallback(schemaIndexFields(definition));
}

function parseMappedIndex(line: string, directive: '@@unique' | '@@index'): SchemaIndexDefinition | null {
  const parsed = parseIndexDirective(attributeArgs(line, directive));
  if (!parsed) return null;
  const definition: SchemaIndexDefinition = { fields: parsed.fields };
  if (parsed.name) definition.name = parsed.name;
  if (parsed.includeFields && parsed.includeFields.length > 0) definition.includeFields = parsed.includeFields;
  if (parsed.filter !== undefined) definition.filter = parsed.filter;
  if (parsed.options !== undefined) definition.options = parsed.options;
  return definition;
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

export function tableIdentityName(raw: string): string {
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

function matchFirst(sql: string | undefined, pattern: RegExp): string | null {
  if (!sql) return null;
  const match = sql.match(pattern);
  return match?.[1] ?? null;
}

function parseTypeArgs(sqlType: string): { base: string; args: string[] } {
  const match = sqlType.match(/^(\w+)(?:\(([^)]+)\))?/);
  const typeArgs = match?.[2];
  return {
    base: match?.[1]?.toUpperCase() ?? parseSqlType(sqlType),
    args: typeArgs ? typeArgs.split(',').map(arg => arg.trim().toUpperCase()) : [],
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

/**
 * Reads a `.an5` schema into models to compare against the database.
 *
 * `provider` decides what counts as a column and what counts as a relation; it
 * defaults to SQL Server. A type the provider does not have is reported rather
 * than skipped — skipping it means the migration silently never mentions that
 * column. A token matching a model in the schema is a relation, so that
 * comparison waits until the whole schema has been read.
 */
export function parseSchemaText(text: string, provider: Provider = DEFAULT_PROVIDER): SchemaModel[] {
  const models: SchemaModel[] = [];
  const typeIssues: FieldTypeIssue[] = [];
  const modelRefs: Array<{ model: string; field: string; type: string }> = [];
  const viewRefs: Array<{ view: string; field: string; type: string }> = [];
  /** `@@schema` per model, applied after the model is read rather than mid-loop. */
  const schemas = new Map<SchemaModel, string>();
  const lines = splitSchemaLines(text);
  let current: SchemaModel | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('//')) continue;

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
    if (!current) continue;

    if (line.startsWith('@@sql') || line.startsWith('@@definition')) {
      if (current.isView) {
        const attribute = line.startsWith('@@sql') ? '@@sql' : '@@definition';
        const sql = unquote(attributeArgs(line, attribute));
        if (sql !== undefined) current.viewSql = sql.trim();
      }
      continue;
    }
    if (line.startsWith('@@map')) {
      // Just the table name. A schema comes from `@@schema` alone, because a mapped
      // name may legitimately contain a dot: `@@map("reports.daily")` is one table
      // whose name has a dot in it, not a table called `daily` in a schema called
      // `reports`.
      const mapped = unquote(attributeArgs(line, '@@map'));
      if (mapped) current.tableName = mapped;
      continue;
    }
    if (line.startsWith('@@schema')) {
      // The directive used to be dropped here while `db:push` and the generators
      // honoured it, so a migration created the table in the connection's default
      // schema and the client then read the one the schema file named. Composed in
      // once the whole model has been read, below.
      const declared = unquote(attributeArgs(line, '@@schema'));
      if (declared !== undefined) schemas.set(current, declared.trim());
      continue;
    }
    if (line.startsWith('@@unique')) {
      if (current.isView) continue;
      const parsed = parseMappedIndex(line, '@@unique');
      if (parsed) current.compoundUniques.push(parsed);
      continue;
    }
    if (line.startsWith('@@index')) {
      if (current.isView) continue;
      const parsed = parseMappedIndex(line, '@@index');
      if (parsed) current.indexes.push(parsed);
      continue;
    }
    if (line.startsWith('@@')) continue;

    const head = readFieldLineHead(line);
    if (!head) continue;

    if (!resolveFieldType(head.type, provider)) {
      if (current.isView) {
        viewRefs.push({ view: current.name, field: head.name, type: head.type });
      } else {
        modelRefs.push({ model: current.name, field: head.name, type: head.type });
      }
      continue;
    }

    const uniqueArgs = attributeArgs(line, '@unique');
    current.fields.push({
      name: head.name,
      sqlType: head.type.toUpperCase(),
      isOptional: head.isOptional,
      isId: hasAttribute(line, '@id'),
      isUnique: hasAttribute(line, '@unique'),
      uniqueName: uniqueArgs ? stringOption(uniqueArgs, 'map') : undefined,
      // `@updatedAt` is `now()` under another name, and db:push treats it as such.
      // Without this here a stamp column looked like it had no default and every
      // diff wanted to add one.
      defaultValue: attributeArgs(line, '@default')
        ?? (hasAttribute(line, '@updatedAt') ? 'now()' : undefined),
    });
  }

  // `dbo` stays implicit: an unqualified model produces the SQL it always has, and a
  // named one is qualified with the schema the schema file asked for.
  for (const model of models) {
    const schema = schemas.get(model) ?? '';
    if (schema && schema !== 'dbo') model.tableName = `${schema}.${model.tableName}`;
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
        message: unknownFieldTypeMessage(ref.type, provider, tableNames),
      });
    }
  }
  for (const ref of viewRefs) {
    typeIssues.push({
      path: `${ref.view}.${ref.field}`,
      message: unknownFieldTypeMessage(ref.type, provider, modelNames),
    });
  }

  for (const model of models) {
    if (model.isView && !model.viewSql?.trim()) {
      typeIssues.push({ path: model.name, message: 'a view needs @@sql("SELECT ...")' });
    }
  }

  if (typeIssues.length > 0) throw new FieldTypeError(provider, typeIssues);

  return models;
}

export function buildCreateTableSql(model: SchemaModel): string {
  const colDefs = model.fields.map(f => {
    let def = `[${f.name}] ${f.sqlType}`;
    if (f.isId) def += ' PRIMARY KEY';
    // A default does not make a column nullable. Skipping NOT NULL here created a
    // nullable column that the next diff then wanted to alter back.
    if (!f.isOptional && !f.isId) def += ' NOT NULL';
    if (f.defaultValue) def += ` ${mapDefault(f.defaultValue)}`;
    // Always named: an unnamed UNIQUE gets a database-generated name, which the
    // next diff cannot match against `UQ_<table>_<field>` and tries to add again.
    if (f.isUnique && !f.isId) def += ` CONSTRAINT [${f.uniqueName ?? fieldUniqueConstraintName(model, f)}] UNIQUE`;
    return def;
  });

  for (let idx = 0; idx < model.compoundUniques.length; idx++) {
    const definition = model.compoundUniques[idx];
    if (definition === undefined) continue;
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
export function buildCreateViewSql(model: SchemaModel): string {
  if (!model.viewSql?.trim()) {
    throw new Error(`View "${model.name}" has no @@sql("SELECT ...") definition.`);
  }
  // A pasted catalog definition keeps its `CREATE VIEW` header; the header this
  // function writes is the one that names the migrated object.
  const body = viewSqlBody(model.viewSql);
  return `CREATE OR ALTER VIEW ${quoteTableName(model.tableName)} AS\n${body}`;
}

export function buildIndexDiff(model: SchemaModel, artifacts: TableArtifacts, ops: MigrationOp[]): void {
  const existingIndexes = new Set((artifacts.indexes || []).map(name => name.toLowerCase()));
  const existingUniques = new Set((artifacts.uniqueConstraints || []).map(name => name.toLowerCase()));
  const expectedIndexes = new Set<string>();
  const expectedUniques = new Set<string>();

  for (const field of model.fields) {
    if (!field.isUnique || field.isId) continue;
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
    if (definition === undefined) continue;
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
      if (!f.isOptional && !f.isId) def += ' NOT NULL';
      if (f.defaultValue) def += ` ${mapDefault(f.defaultValue)}`;
      if (f.isUnique && !f.isId) def += ` CONSTRAINT [${f.uniqueName ?? fieldUniqueConstraintName(model, f)}] UNIQUE`;
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

export async function generateDiff(
  schemaModels: SchemaModel[],
  dbTables: string[],
  introspectTable: (tableName: string) => Promise<DbColumn[]>,
  introspectArtifacts?: (tableName: string) => Promise<TableArtifacts>,
  dbViews: string[] = [],
  introspectViewDefinition?: (viewName: string) => Promise<string | null>
): Promise<MigrationOp[]> {
  const ops: MigrationOp[] = [];
  const tableModels = schemaModels.filter(model => !model.isView);
  // A view may read another view. The migration applies its operations in
  // order, so the referenced view has to be created first.
  const viewModels = orderViewsByDependency(
    schemaModels.filter(model => model.isView).map(model => ({
      model,
      names: [model.tableName, model.name],
      sql: model.viewSql ?? '',
    })),
  ).ordered.map(entry => entry.model);
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

    if (existingName !== undefined && normalizeViewSql(existingDefinition) === normalizeViewSql(view.viewSql)) {
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
    // `CREATE VIEW` has to be the first statement in a T-SQL batch, so it is fenced
    // with GO. Without this, a migration that creates a table and then a view fails
    // with "'CREATE VIEW' must be the first statement in a query batch".
    const lastMeaningfulLine = [...lines].reverse().find(line => line.trim() !== '');
    if (op.type === 'CREATE_VIEW' && lastMeaningfulLine !== 'GO') lines.push('GO');

    lines.push(`-- ${op.type}: ${op.table}`);
    for (const warning of op.riskWarnings || []) {
      lines.push(`-- WARNING: ${warning}`);
    }
    if (op.sql) lines.push(op.sql);
    if (op.type === 'CREATE_VIEW') lines.push('GO');
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
    markers.push({ name: (match[1] ?? 'up').toLowerCase() as 'preflight' | 'up' | 'down', index: match.index, end: match.index + match[0].length });
  }

  if (markers.length === 0) {
    return { preflight: '', up: sql.trim(), down: '', hasDown: false };
  }

  const section = (name: 'preflight' | 'up' | 'down'): string => {
    const markerIndex = markers.findIndex(marker => marker.name === name);
    if (markerIndex < 0) return '';
    const marker = markers[markerIndex];
    if (!marker) return '';
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

  const count = Number.parseInt(args[0] ?? '', 10);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error('Rollback steps must be a positive integer, or use --to <migration-file>.');
  }
  return { count, label: `${count} migration${count === 1 ? '' : 's'}` };
}

export function parseMigrationCommandOptions(args: string[]): MigrationCommandOptions {
  const rest: string[] = [];
  let preview = false;

  for (const arg of args) {
    if (arg === '--preview') {
      preview = true;
    } else {
      if (arg.startsWith('-') && arg !== '--to') throw new Error(`Unknown migration option: ${arg}; use --preview to inspect SQL`);
      rest.push(arg);
    }
  }

  return { preview, rest };
}

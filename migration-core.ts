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
import { dialectFor, normalizeViewSql, viewSqlBody } from './generator/src/dialect';
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
  provider?: Provider;
  maxLength?: number;
  precision?: number;
  scale?: number;
  datetimePrecision?: number;
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

type SqlLexicalMode = 'normal' | 'single-quoted' | 'double-quoted' | 'bracketed' | 'line-comment' | 'block-comment' | 'dollar-quoted';

interface SqlLexicalState {
  mode: SqlLexicalMode;
  blockDepth: number;
  dollarTag: string | null;
}

function advanceSqlLexicalState(line: string, state: SqlLexicalState): void {
  for (let i = 0; i < line.length; i++) {
    const current = line[i];
    const next = line[i + 1];

    if (state.mode === 'line-comment') break;
    if (state.mode === 'single-quoted') {
      if (current === "'" && next === "'") i++;
      else if (current === "'") state.mode = 'normal';
      continue;
    }
    if (state.mode === 'double-quoted') {
      if (current === '"' && next === '"') i++;
      else if (current === '"') state.mode = 'normal';
      continue;
    }
    if (state.mode === 'bracketed') {
      if (current === ']' && next === ']') i++;
      else if (current === ']') state.mode = 'normal';
      continue;
    }
    if (state.mode === 'dollar-quoted') {
      if (state.dollarTag && line.startsWith(state.dollarTag, i)) {
        i += state.dollarTag.length - 1;
        state.mode = 'normal';
        state.dollarTag = null;
      }
      continue;
    }
    if (state.mode === 'block-comment') {
      if (current === '/' && next === '*') {
        state.blockDepth++;
        i++;
      } else if (current === '*' && next === '/') {
        state.blockDepth--;
        i++;
        if (state.blockDepth === 0) state.mode = 'normal';
      }
      continue;
    }

    if (current === '-' && next === '-') {
      state.mode = 'line-comment';
      break;
    }
    if (current === '/' && next === '*') {
      state.mode = 'block-comment';
      state.blockDepth = 1;
      i++;
    } else if (current === '$') {
      const match = line.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        state.mode = 'dollar-quoted';
        state.dollarTag = match[0];
        i += match[0].length - 1;
      }
    } else if (current === "'") {
      state.mode = 'single-quoted';
    } else if (current === '"') {
      state.mode = 'double-quoted';
    } else if (current === '[') {
      state.mode = 'bracketed';
    }
  }

  if (state.mode === 'line-comment') state.mode = 'normal';
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

export function isValidMigrationId(id: string): boolean {
  if (typeof id !== 'string') return false;
  const stem = id.toLowerCase().replace(/\.sql$/, '');
  return id.length > 0 &&
    id.length <= 255 &&
    id !== '.' &&
    id !== '..' &&
    id === id.trim() &&
    id.toLowerCase().endsWith('.sql') &&
    !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(id) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/.test(stem);
}

export function migrationFileName(timestamp: string, attempt: number): string {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error('Migration filename attempt must be a non-negative integer.');
  }
  const suffix = attempt === 0 ? '' : `_${String(attempt).padStart(3, '0')}`;
  return `${timestamp}_migration${suffix}.sql`;
}

export interface MigrationCommandOptions {
  preview: boolean;
  rest: string[];
}

export function parseSqlType(raw: string): string {
  const match = raw.match(/^(\w+)/);
  return match?.[1]?.toUpperCase() ?? raw.toUpperCase();
}

export function formatDbColumnSqlType(column: DbColumn, provider: Provider = column.provider ?? DEFAULT_PROVIDER): string {
  const rawType = (column.dataType || '').trim().toUpperCase();
  if (provider === 'postgres') {
    const base = normalizePostgresType(rawType);
    if ((base === 'VARCHAR' || base === 'CHAR') && typeof column.maxLength === 'number') {
      return `${base}(${column.maxLength})`;
    }
    if ((base === 'DECIMAL' || base === 'NUMERIC') && typeof column.precision === 'number' && typeof column.scale === 'number') {
      return `${base}(${column.precision},${column.scale})`;
    }
    if (['TIME', 'TIMETZ', 'TIMESTAMP', 'TIMESTAMPTZ'].includes(base) && typeof column.datetimePrecision === 'number' && column.datetimePrecision !== 6) {
      return `${base}(${column.datetimePrecision})`;
    }
    return base;
  }
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

function normalizePostgresType(rawType: string): string {
  return rawType
    .replace(/^CHARACTER VARYING(?=\s|\(|$)/, 'VARCHAR')
    .replace(/^CHARACTER(?=\s|\(|$)/, 'CHAR')
    .replace(/^TIMESTAMP WITH TIME ZONE(?=\s|\(|$)/, 'TIMESTAMPTZ')
    .replace(/^TIMESTAMP WITHOUT TIME ZONE(?=\s|\(|$)/, 'TIMESTAMP')
    .replace(/^TIME WITH TIME ZONE(?=\s|\(|$)/, 'TIMETZ')
    .replace(/^TIME WITHOUT TIME ZONE(?=\s|\(|$)/, 'TIME')
    .replace(/^BIGSERIAL(?=\s|\(|$)/, 'BIGINT')
    .replace(/^SMALLSERIAL(?=\s|\(|$)/, 'SMALLINT')
    .replace(/^SERIAL(?=\s|\(|$)/, 'INTEGER')
    .replace(/^(TIME|TIMETZ|TIMESTAMP|TIMESTAMPTZ)\(6\)$/, '$1');
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

export function quoteTableName(raw: string, provider: Provider = DEFAULT_PROVIDER): string {
  if (provider === 'mssql') {
    return raw
      .replace(/"/g, '')
      .split('.')
      .map(part => part.trim().replace(/^\[|\]$/g, ''))
      .filter(Boolean)
      .map(part => `[${part.replace(/]/g, ']]')}]`)
      .join('.');
  }
  return dialectFor(provider).quoteTable(raw);
}

export function tableIdentityName(raw: string, defaultSchema?: string): string {
  const cleaned = raw
    .replace(/"/g, '')
    .split('.')
    .map(part => part.trim().replace(/^\[|\]$/g, '').toLowerCase())
    .filter(Boolean);
  if (cleaned.length > 1 && cleaned[0] === 'dbo' && (!defaultSchema || defaultSchema.toLowerCase() === 'dbo')) {
    cleaned.shift();
  }
  if (cleaned.length > 1 && defaultSchema && cleaned[0] === defaultSchema.toLowerCase()) {
    cleaned.shift();
  }
  return cleaned.join('.');
}

function matchCaptured(sql: string | undefined, pattern: RegExp): string | null {
  if (!sql) return null;
  const match = sql.match(pattern);
  return match?.slice(1).find((capture): capture is string => capture !== undefined) ?? null;
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

function quoteColumnName(raw: string, provider: Provider = DEFAULT_PROVIDER): string {
  return dialectFor(provider).quote(raw);
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
  nextNullable: boolean,
  provider: Provider = DEFAULT_PROVIDER
): string[] {
  const checks: string[] = [];
  const table = quoteTableName(tableName, provider);
  const col = quoteColumnName(columnName, provider);
  const label = `${tableName}.${columnName}`;
  const previous = parseTypeArgs(previousSqlType);
  const next = parseTypeArgs(nextSqlType);
  const guardedCheck = (condition: string, message: string): string => {
    if (provider === 'mssql') {
      return `IF ${condition}\n  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(message)}', 1`;
    }
    return `DO $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'an5 migration preflight failed: ${escapeSqlString(message)}'; END IF; END $$`;
  };

  if (previousNullable && !nextNullable) {
    checks.push(guardedCheck(`EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NULL)`, `${label} contains NULL values.`));
  }

  const previousSize = numericArg(previous.args[0]);
  const nextSize = numericArg(next.args[0]);
  const stringTypes = new Set(['NVARCHAR', 'NCHAR', 'VARCHAR', 'CHAR']);
  const binaryTypes = new Set(['VARBINARY', 'BINARY']);
  if (previous.base === next.base && stringTypes.has(previous.base)) {
    if ((previousSize === 'MAX' && typeof nextSize === 'number') || (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize)) {
      const length = provider === 'postgres' ? `char_length(${col})` : `LEN(${col})`;
      checks.push(guardedCheck(
        `EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND ${length} > ${nextSize})`,
        `${label} has values longer than ${nextSize}.`,
      ));
    }
  }
  if (previous.base === next.base && binaryTypes.has(previous.base)) {
    if ((previousSize === 'MAX' && typeof nextSize === 'number') || (typeof previousSize === 'number' && typeof nextSize === 'number' && nextSize < previousSize)) {
      const length = provider === 'postgres' ? `octet_length(${col})` : `DATALENGTH(${col})`;
      checks.push(guardedCheck(
        `EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND ${length} > ${nextSize})`,
        `${label} has binary values longer than ${nextSize} bytes.`,
      ));
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
  if (provider === 'mssql' && (previous.base !== next.base || precisionShrinks)) {
    checks.push(guardedCheck(
      `EXISTS (SELECT 1 FROM ${table} WHERE ${col} IS NOT NULL AND TRY_CONVERT(${nextSqlType}, ${col}) IS NULL)`,
      `${label} contains values that cannot convert to ${nextSqlType}.`,
    ));
  }

  return checks;
}

export function buildAddColumnPreflightSql(tableName: string, field: SchemaField, provider: Provider = DEFAULT_PROVIDER): string[] {
  const checks: string[] = [];
  const table = quoteTableName(tableName, provider);
  const label = `${tableName}.${field.name}`;
  const guardedCheck = (condition: string, message: string): string => {
    if (provider === 'mssql') {
      return `IF ${condition}\n  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(message)}', 1`;
    }
    return `DO $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'an5 migration preflight failed: ${escapeSqlString(message)}'; END IF; END $$`;
  };

  if (!field.isOptional && !field.defaultValue && !field.isId) {
    checks.push(guardedCheck(`EXISTS (SELECT 1 FROM ${table})`, `${label} is NOT NULL without a default on a non-empty table.`));
  }

  if (provider === 'mssql' && field.isUnique && !field.isId) {
    const count = 'COUNT_BIG(*)';
    checks.push(guardedCheck(
      `(SELECT ${count} FROM ${table}) > 1`,
      `${label} is a new UNIQUE column; existing rows would receive duplicate NULL values.`,
    ));
  }

  return checks;
}

export function buildUniqueConstraintPreflightSql(tableName: string, fields: string[], provider: Provider = DEFAULT_PROVIDER): string[] {
  if (fields.length === 0) return [];

  const table = quoteTableName(tableName, provider);
  const columns = fields.map(field => quoteColumnName(field, provider));
  const columnsSql = columns.join(', ');
  const label = `${tableName}.${fields.join(',')}`;
  const where = provider === 'postgres'
    ? `WHERE ${columns.map(column => `${column} IS NOT NULL`).join(' AND ')}`
    : '';

  const condition = `EXISTS (
  SELECT 1
  FROM ${table}
  ${where}
  GROUP BY ${columnsSql}
  HAVING COUNT_BIG(*) > 1
)`;
  if (provider === 'mssql') {
    return [`IF ${condition}
  THROW 51000, 'an5 migration preflight failed: ${escapeSqlString(`${label} has duplicate values for a UNIQUE constraint.`)}', 1`];
  }
  return [`DO $$ BEGIN IF ${condition.replace('COUNT_BIG(*)', 'COUNT(*)')} THEN RAISE EXCEPTION 'an5 migration preflight failed: ${escapeSqlString(`${label} has duplicate values for a UNIQUE constraint.`)}'; END IF; END $$`];
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

  // SQL Server's default `dbo` stays implicit. Other providers keep the schema
  // exactly as declared because their default schema is connection-specific.
  for (const model of models) {
    const schema = schemas.get(model) ?? '';
    if (schema && (provider !== 'mssql' || schema !== 'dbo')) model.tableName = `${schema}.${model.tableName}`;
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

export function buildCreateTableSql(model: SchemaModel, provider: Provider = DEFAULT_PROVIDER): string {
  const dialect = dialectFor(provider);
  const colDefs = model.fields.map(f => dialect.columnDefinition({
    name: f.name,
    sqlType: f.sqlType,
    isId: f.isId,
    isUnique: f.isUnique && !f.isId,
    isOptional: f.isOptional,
    uniqueName: f.uniqueName ?? (f.isUnique && !f.isId ? fieldUniqueConstraintName(model, f) : undefined),
    defaultExpr: f.defaultValue,
  }));

  for (let idx = 0; idx < model.compoundUniques.length; idx++) {
    const definition = model.compoundUniques[idx];
    if (definition === undefined) continue;
    const fields = schemaIndexFields(definition);
    const constraintName = schemaIndexName(definition, () => compoundUniqueConstraintName(model, idx));
    const quotedFields = fields.map(field => dialect.quote(field));
    if (dialect.supportsNamedUniqueConstraint) {
      colDefs.push(`CONSTRAINT ${dialect.quote(constraintName)} UNIQUE (${quotedFields.join(', ')})`);
    } else {
      colDefs.push(`UNIQUE (${quotedFields.join(', ')})`);
    }
  }

  return dialect.createTable(quoteTableName(model.tableName, provider), colDefs);
}

/**
 * The migration DDL for a view.
 *
 * The body is expected to be a single `SELECT` (`@@sql`); the provider dialect
 * supplies the view statement that migration files can execute.
 */
export function buildCreateViewSql(model: SchemaModel, provider: Provider = DEFAULT_PROVIDER): string {
  if (!model.viewSql?.trim()) {
    throw new Error(`View "${model.name}" has no @@sql("SELECT ...") definition.`);
  }
  // A pasted catalog definition keeps its `CREATE VIEW` header; the header this
  // function writes is the one that names the migrated object.
  const dialect = dialectFor(provider);
  return dialect.createView(quoteTableName(model.tableName, provider), viewSqlBody(model.viewSql));
}

export function buildIndexDiff(model: SchemaModel, artifacts: TableArtifacts, ops: MigrationOp[], provider: Provider = DEFAULT_PROVIDER): void {
  const dialect = dialectFor(provider);
  const existingIndexes = new Set((artifacts.indexes || []).map(name => name.toLowerCase()));
  const existingUniques = new Set((artifacts.uniqueConstraints || []).map(name => name.toLowerCase()));
  const expectedIndexes = new Set<string>();
  const expectedUniques = new Set<string>();

  for (const field of model.fields) {
    if (!field.isUnique || field.isId) continue;
    const constraintName = field.uniqueName || fieldUniqueConstraintName(model, field);
    expectedUniques.add(constraintName.toLowerCase());
    if (!existingUniques.has(constraintName.toLowerCase())) {
      const quotedTable = quoteTableName(model.tableName, provider);
      const quotedName = dialect.quote(constraintName);
      const quotedField = dialect.quote(field.name);
      ops.push({
        type: 'ADD_UNIQUE',
        table: model.tableName,
        column: field.name,
        details: field.name,
        sql: dialect.addUniqueConstraint(quotedName, quotedTable, [quotedField]),
        preflightSql: buildUniqueConstraintPreflightSql(model.tableName, [field.name], provider),
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
      const quotedTable = quoteTableName(model.tableName, provider);
      const quotedName = dialect.quote(constraintName);
      const quotedFields = fields.map(field => dialect.quote(field));
      ops.push({
        type: 'ADD_UNIQUE',
        table: model.tableName,
        details: fields.join(', '),
        sql: dialect.addUniqueConstraint(quotedName, quotedTable, quotedFields),
        preflightSql: buildUniqueConstraintPreflightSql(model.tableName, fields, provider),
      });
    }
  }

  for (const definition of model.indexes) {
    const fields = schemaIndexFields(definition);
    const name = schemaIndexName(definition, fields => indexName(model, fields));
    expectedIndexes.add(name.toLowerCase());
    if (!existingIndexes.has(name.toLowerCase())) {
      const includeFields = Array.isArray(definition) ? [] : definition.includeFields || [];
      const filter = Array.isArray(definition) ? undefined : definition.filter;
      const options = Array.isArray(definition) ? undefined : definition.options;
      ops.push({
        type: 'ADD_INDEX',
        table: model.tableName,
        details: [
          fields.join(', '),
          includeFields.length > 0 ? `include ${includeFields.join(', ')}` : '',
          filter ? `filter ${filter}` : '',
          options ? `options ${options}` : '',
        ].filter(Boolean).join(' '),
        sql: dialect.createIndex(
          dialect.quote(name),
          quoteTableName(model.tableName, provider),
          fields.map(field => dialect.quote(field)),
          {
            includeFields: includeFields.map(field => dialect.quote(field)),
            filter,
            options,
          },
        ),
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
        sql: provider === 'postgres'
          ? `-- DROP INDEX ${dialect.quote(name)}`
          : `-- DROP INDEX ${dialect.quote(name)} ON ${quoteTableName(model.tableName, provider)}`,
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
        sql: `-- ALTER TABLE ${quoteTableName(model.tableName, provider)} DROP CONSTRAINT ${dialect.quote(name)}`,
      });
    }
  }
}

export function generateColumnDiff(
  model: SchemaModel,
  dbColumns: DbColumn[],
  ops: MigrationOp[],
  provider: Provider = DEFAULT_PROVIDER
): void {
  const dialect = dialectFor(provider);
  const dbColumnMap = new Map(dbColumns.map(c => [c.columnName.toLowerCase(), c]));
  const schemaFields = model.fields;

  for (const f of schemaFields) {
    const existing = dbColumnMap.get(f.name.toLowerCase());
    if (!existing) {
      const column = {
        name: f.name,
        sqlType: f.sqlType,
        isId: f.isId,
        isUnique: f.isUnique && !f.isId,
        isOptional: f.isOptional,
        uniqueName: f.uniqueName ?? (f.isUnique && !f.isId ? fieldUniqueConstraintName(model, f) : undefined),
        defaultExpr: f.defaultValue,
      };
      ops.push({
        type: 'ADD_COLUMN',
        table: model.tableName,
        column: f.name,
        sql: dialect.addColumn(quoteTableName(model.tableName, provider), column),
        preflightSql: buildAddColumnPreflightSql(model.tableName, f, provider),
      });
      continue;
    }

    const schemaType = provider === 'postgres'
      ? normalizePostgresType(f.sqlType.toUpperCase())
      : f.sqlType.toUpperCase();
    const dbType = formatDbColumnSqlType(existing, provider);
    const schemaNullable = f.isOptional;
    const dbNullable = Boolean(existing.isNullable);
    const typeChanged = schemaType !== dbType;
    const nullableChanged = schemaNullable !== dbNullable;

    if (typeChanged || nullableChanged) {
      const riskWarnings = buildAlterColumnWarnings(dbType, schemaType, dbNullable, schemaNullable);
      const preflightSql = buildAlterColumnPreflightSql(
        model.tableName,
        f.name,
        dbType,
        schemaType,
        dbNullable,
        schemaNullable,
        provider,
      );
      const table = quoteTableName(model.tableName, provider);
      const column = dialect.quote(f.name);
      const statements: string[] = [];
      if (provider === 'mssql') {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${f.sqlType}${schemaNullable ? ' NULL' : ' NOT NULL'}`);
      } else {
        if (typeChanged) statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${f.sqlType}`);
        if (nullableChanged) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${column} ${schemaNullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
        );
        }
      }
      ops.push({
        type: 'ALTER_COLUMN',
        table: model.tableName,
        column: f.name,
        details: typeChanged
          ? `type ${dbType} -> ${schemaType}${nullableChanged ? `, nullable ${dbNullable} -> ${schemaNullable}` : ''}`
          : `nullable ${dbNullable} -> ${schemaNullable}`,
        sql: statements.join(';\n'),
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
        sql: `-- ALTER TABLE ${quoteTableName(model.tableName, provider)} DROP COLUMN ${dialect.quote(c.columnName)}`,
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
  introspectViewDefinition?: (viewName: string) => Promise<string | null>,
  provider: Provider = DEFAULT_PROVIDER,
  defaultSchema?: string,
): Promise<MigrationOp[]> {
  const dialect = dialectFor(provider);
  const identityName = (raw: string) => tableIdentityName(raw, provider === 'postgres' ? defaultSchema : undefined);
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
  const dbTableIdentities = new Set(dbTables.map(identityName));
  const schemaTableNames = new Set(tableModels.map(m => identityName(m.tableName)));

  for (const model of tableModels) {
    if (!dbTableIdentities.has(identityName(model.tableName))) {
      ops.push({ type: 'CREATE_TABLE', table: model.tableName, sql: buildCreateTableSql(model, provider) });
      buildIndexDiff(model, {
        indexes: [],
        uniqueConstraints: [
          ...model.fields.filter(field => field.isUnique && !field.isId).map(field => field.uniqueName || fieldUniqueConstraintName(model, field)),
          ...model.compoundUniques.map((definition, idx) => schemaIndexName(definition, () => compoundUniqueConstraintName(model, idx))),
        ],
      }, ops, provider);
    }
  }

  for (const model of tableModels) {
    if (dbTableIdentities.has(identityName(model.tableName))) {
      const dbColumns = await introspectTable(model.tableName);
      generateColumnDiff(model, dbColumns, ops, provider);
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
        }, ops, provider);
      }
    }
  }

  for (const tableName of dbTables) {
    if (!schemaTableNames.has(identityName(tableName))) {
      ops.push({
        type: 'DROP_TABLE',
        table: tableName,
        details: 'Table not in schema',
        sql: `-- DROP TABLE ${quoteTableName(tableName, provider)}`,
      });
    }
  }

  // Views are compared by their SQL body rather than by name alone: a view whose
  // query changed has to be replaced, and a catalog that reformats whitespace must
  // not make every diff think it did.
  const dbViewIdentities = new Map(dbViews.map(name => [identityName(name), name]));
  const schemaViewNames = new Set(viewModels.map(view => identityName(view.tableName)));

  for (const view of viewModels) {
    const existingName = dbViewIdentities.get(identityName(view.tableName));
    const existingDefinition = existingName !== undefined && introspectViewDefinition
      ? await introspectViewDefinition(existingName)
      : null;

    if (existingName !== undefined && normalizeViewSql(existingDefinition) === normalizeViewSql(view.viewSql)) {
      continue;
    }

    const previousSql = existingDefinition
      ? dialect.createView(quoteTableName(view.tableName, provider), existingDefinition)
      : undefined;

    ops.push({
      type: 'CREATE_VIEW',
      table: view.tableName,
      details: existingName !== undefined ? 'View definition changed' : 'View not in database',
      sql: buildCreateViewSql(view, provider),
      ...(previousSql !== undefined ? { previousSql } : {}),
    });
  }

  for (const viewName of dbViews) {
    if (!schemaViewNames.has(identityName(viewName))) {
      ops.push({
        type: 'DROP_VIEW',
        table: viewName,
        details: 'View not in schema',
        sql: `-- DROP VIEW ${quoteTableName(viewName, provider)}`,
      });
    }
  }

  return ops;
}

export function buildMigrationFile(timestamp: string, ops: MigrationOp[], provider: Provider = DEFAULT_PROVIDER): string {
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
      lines.push(provider === 'postgres' && !sql.trimEnd().endsWith(';') ? `${sql};` : sql);
      if (provider === 'mssql') lines.push('GO');
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
    if (provider === 'mssql' && op.type === 'CREATE_VIEW' && lastMeaningfulLine !== 'GO') lines.push('GO');

    lines.push(`-- ${op.type}: ${op.table}`);
    for (const warning of op.riskWarnings || []) {
      lines.push(`-- WARNING: ${warning}`);
    }
    if (op.sql) {
      lines.push(provider === 'postgres' && !op.sql.trimEnd().endsWith(';') ? `${op.sql};` : op.sql);
    }
    if (provider === 'mssql' && op.type === 'CREATE_VIEW') lines.push('GO');
    lines.push('');
  }

  lines.push('-- migrate:down');
  const downSql = buildDownMigrationSql(ops, provider);
  if (downSql.trim()) {
    lines.push(downSql);
  } else {
    lines.push('-- Add rollback SQL here. Leave empty to make rollback explicit and non-destructive.');
  }
  lines.push('');

  return lines.join('\n');
}

export function buildDownMigrationSql(ops: MigrationOp[], provider: Provider = DEFAULT_PROVIDER): string {
  const lines: string[] = [];
  const dialect = dialectFor(provider);

  for (const op of [...ops].reverse()) {
    const table = quoteTableName(op.table, provider);
    if (op.type === 'CREATE_TABLE') {
      lines.push(`DROP TABLE ${table}`);
      continue;
    }
    if (op.type === 'CREATE_VIEW') {
      // A replaced view is restored to its old definition; a newly created one is
      // simply dropped.
      lines.push(op.previousSql ? op.previousSql.trim() : provider === 'mssql' ? `DROP VIEW ${table}` : dialect.dropView(table));
      continue;
    }
    if (op.type === 'DROP_VIEW') {
      // Its up SQL is a commented `DROP VIEW`; dropping a view is never automatic,
      // so there is nothing to undo here.
      continue;
    }
    if (op.type === 'ADD_COLUMN' && op.column) {
      lines.push(`ALTER TABLE ${table} DROP COLUMN ${dialect.quote(op.column)}`);
      continue;
    }
    if (op.type === 'ADD_INDEX') {
      const indexName = matchCaptured(op.sql, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:\[([^\]]+)]|"((?:""|[^"])*)"|`((?:``|[^`])*)`)/i);
      if (indexName) {
        lines.push(provider === 'postgres'
          ? `DROP INDEX ${dialect.quote(indexName.replace(/""/g, '"'))}`
          : `DROP INDEX ${dialect.quote(indexName)} ON ${table}`);
      }
      continue;
    }
    if (op.type === 'ADD_UNIQUE') {
      const constraintName = matchCaptured(op.sql, /ADD\s+CONSTRAINT\s+(?:\[([^\]]+)]|"((?:""|[^"])*)"|`((?:``|[^`])*)`)/i);
      if (constraintName) lines.push(`ALTER TABLE ${table} DROP CONSTRAINT ${dialect.quote(constraintName.replace(/""/g, '"'))}`);
      continue;
    }
    if (op.sql && !op.sql.trim().startsWith('--')) {
      if (op.type === 'ALTER_COLUMN' && op.column && op.previousSqlType && typeof op.previousNullable === 'boolean') {
        const column = dialect.quote(op.column);
        if (provider === 'postgres') {
          lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${op.previousSqlType}`);
          lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${op.previousNullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`);
        } else {
          lines.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${op.previousSqlType}${op.previousNullable ? ' NULL' : ' NOT NULL'}`);
        }
        continue;
      }
      lines.push(`-- Manual rollback required for ${op.type}: ${op.table}${op.column ? `.${op.column}` : ''}`);
    }
  }

  return lines.join(provider === 'mssql' ? '\nGO\n' : ';\n');
}

export function parseMigrationSections(sql: string): MigrationSections {
  const markerPattern = /^\s*--\s*migrate:(preflight|up|down)\s*$/gim;
  const markers: { name: 'preflight' | 'up' | 'down'; index: number; end: number }[] = [];
  const state: SqlLexicalState = { mode: 'normal', blockDepth: 0, dollarTag: null };
  let offset = 0;
  for (const line of sql.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []) {
    if (!line) continue;
    const content = line.replace(/(?:\r\n|\n|\r)$/, '');
    if (state.mode === 'normal') {
      markerPattern.lastIndex = 0;
      const match = markerPattern.exec(content);
      if (match) {
        markers.push({
          name: (match[1] ?? 'up').toLowerCase() as 'preflight' | 'up' | 'down',
          index: offset,
          end: offset + line.length,
        });
        offset += line.length;
        continue;
      }
    }
    advanceSqlLexicalState(content, state);
    offset += line.length;
  }

  if (markers.length === 0) {
    return { preflight: '', up: sql.trim(), down: '', hasDown: false };
  }

  const names = markers.map(marker => marker.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Migration file contains duplicate section markers.');
  }
  const upIndex = names.indexOf('up');
  const preflightIndex = names.indexOf('preflight');
  const downIndex = names.indexOf('down');
  if (upIndex < 0 || (preflightIndex >= 0 && preflightIndex > upIndex) || (downIndex >= 0 && downIndex < upIndex)) {
    throw new Error('Migration sections must be ordered as preflight, up, then down; up is required.');
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
  const batches: string[] = [];
  const state: SqlLexicalState = { mode: 'normal', blockDepth: 0, dollarTag: null };
  let current: string[] = [];
  for (const line of sql.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []) {
    if (!line) continue;
    const content = line.replace(/(?:\r\n|\n|\r)$/, '');
    if (state.mode === 'normal' && /^\s*GO\s*;?\s*$/i.test(content)) {
      batches.push(current.join(''));
      current = [];
      continue;
    }
    current.push(line);
    advanceSqlLexicalState(content, state);
  }
  batches.push(current.join(''));

  return batches
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
    if (args.length !== 2) throw new Error('Use --to <migration-file> with exactly one target.');
    const target = args[1];
    if (!target) throw new Error('Rollback target is required after --to.');
    const index = applied.findIndex(row => row.id === target);
    if (index < 0) throw new Error(`Rollback target is not applied: ${target}`);
    return { count: applied.length - index, label: `through ${target}` };
  }

  if (args.length !== 1 || !/^[0-9]+$/.test(args[0] ?? '')) {
    throw new Error('Rollback steps must be a positive integer, or use --to <migration-file>.');
  }
  const count = Number(args[0]);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Rollback steps must be a positive integer, or use --to <migration-file>.');
  }
  if (count > applied.length) {
    const available = applied.length === 1 ? 'migration is' : 'migrations are';
    throw new Error(`Requested ${count} rollback steps, but only ${applied.length} ${available} applied.`);
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

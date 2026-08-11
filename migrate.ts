/**
 * an5Orm Migration Tool
 * Compares schema files with database and generates migration SQL.
 *
 * Usage:
 *   npx tsx migrate.ts diff       # Show differences
 *   npx tsx migrate.ts generate   # Generate migration file
 *   npx tsx migrate.ts apply      # Apply pending migrations
 *   npx tsx migrate.ts rollback [steps|--to file] # Roll back applied migrations
 *   npx tsx migrate.ts status     # Show migration status
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { An5Adapter } from '@an5/adapters';
import {
  DbColumn,
  SchemaModel,
  TableArtifacts,
  buildMigrationFile,
  generateDiff,
  parseMigrationCommandOptions,
  parseMigrationSections,
  parseRollbackSelection,
  parseSchemaText,
  splitSqlBatches,
} from './migration-core';

const rootDir = process.cwd();
let config: any = {};
try {
  let configPath = path.join(rootDir, 'an5Orm.config.js');
  if (!fs.existsSync(configPath)) {
    configPath = path.join(rootDir, 'an5Orm.config.cjs');
  }
  if (fs.existsSync(configPath)) {
    config = require(configPath);
  }
} catch { /* ignore */ }

const schemaDir = path.resolve(rootDir, config.schemaDir || 'an5Schema');
const migrationsDir = path.resolve(rootDir, 'migrations');
const migrationTableName = '[dbo].[_an5_migrations]';

let _adapter: An5Adapter | null = null;
function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for migration commands.');
  }
}

async function getDb(): Promise<An5Adapter> {
  if (!_adapter) {
    requireDatabaseUrl();
    _adapter = new An5Adapter({ connectionString: process.env.DATABASE_URL! });
    await _adapter.$connect();
  }
  return _adapter;
}

// ─── Schema Parser ───────────────────────────────────────────────────────────

function parseSchema(): SchemaModel[] {
  if (!fs.existsSync(schemaDir)) return [];

  const files = fs.readdirSync(schemaDir).filter(f => f.endsWith('.an5'));
  let text = '';
  for (const file of files) {
    text += fs.readFileSync(path.join(schemaDir, file), 'utf8') + '\n';
  }

  return parseSchemaText(text);
}

// ─── Database Introspection ──────────────────────────────────────────────────

async function introspectTable(tableName: string): Promise<DbColumn[]> {
  return (await getDb()).$queryRawUnsafe<DbColumn>(`
    SELECT
      c.name AS columnName,
      ty.name AS dataType,
      c.max_length AS maxLength,
      c.precision AS precision,
      c.scale AS scale,
      c.is_nullable AS isNullable,
      pk.is_primary_key AS isPrimaryKey,
      c.is_identity AS isIdentity,
      d.definition AS defaultValue
    FROM sys.columns c
    JOIN sys.types ty ON c.user_type_id = ty.user_type_id
    LEFT JOIN (
      SELECT ic.object_id, ic.column_id, i.is_primary_key
      FROM sys.index_columns ic
      JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      WHERE i.is_primary_key = 1
    ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
    LEFT JOIN sys.default_constraints d ON c.default_object_id = d.object_id
    WHERE c.object_id = OBJECT_ID(@p_0)
    ORDER BY c.column_id
  `, tableName);
}

async function getExistingTables(): Promise<string[]> {
  const rows = await (await getDb()).$queryRawUnsafe<{ name: string }>(`
    SELECT name FROM sys.tables WHERE is_ms_shipped = 0 ORDER BY name
  `);
  return rows.map(r => r.name);
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }
  return fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
}

function checksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationTable(): Promise<void> {
  await (await getDb()).$executeRawUnsafe(`
    IF OBJECT_ID('dbo._an5_migrations', 'U') IS NULL
    CREATE TABLE ${migrationTableName} (
      [id] NVARCHAR(255) NOT NULL PRIMARY KEY,
      [checksum] NVARCHAR(64) NOT NULL,
      [appliedAt] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `);
}

async function migrationTableExists(): Promise<boolean> {
  const rows = await (await getDb()).$queryRawUnsafe<{ name: string }>(
    `SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('dbo._an5_migrations')`
  );
  return rows.length > 0;
}

async function getAppliedMigrations(options: { ensure?: boolean } = {}): Promise<{ id: string; checksum: string; appliedAt: Date | string }[]> {
  if (options.ensure) {
    await ensureMigrationTable();
  } else if (!(await migrationTableExists())) {
    return [];
  }
  return (await getDb()).$queryRawUnsafe<{ id: string; checksum: string; appliedAt: Date | string }>(
    `SELECT [id], [checksum], [appliedAt] FROM ${migrationTableName} ORDER BY [id] ASC`
  );
}

async function executeBatches(executor: { _executeRaw?: (sql: string, params?: Record<string, any>) => Promise<number>; $executeRawUnsafe?: (sql: string, ...values: any[]) => Promise<number> }, sql: string): Promise<void> {
  for (const batch of splitSqlBatches(sql)) {
    if (executor._executeRaw) {
      await executor._executeRaw(batch);
    } else if (executor.$executeRawUnsafe) {
      await executor.$executeRawUnsafe(batch);
    } else {
      throw new Error('Migration executor does not support raw execution.');
    }
  }
}

function printBatches(title: string, sql: string): void {
  const batches = splitSqlBatches(sql);
  console.log(title);
  for (let i = 0; i < batches.length; i++) {
    console.log(`-- batch ${i + 1}`);
    console.log(batches[i]);
  }
}

async function introspectTableArtifacts(tableName: string): Promise<TableArtifacts> {
  const indexes = await (await getDb()).$queryRawUnsafe<{ name: string }>(`
    SELECT name
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(@p_0)
      AND is_primary_key = 0
      AND is_unique_constraint = 0
      AND name IS NOT NULL
  `, tableName);

  const uniqueConstraints = await (await getDb()).$queryRawUnsafe<{ name: string }>(`
    SELECT name
    FROM sys.objects
    WHERE type = 'UQ'
      AND parent_object_id = OBJECT_ID(@p_0)
  `, tableName);

  return {
    indexes: indexes.map(row => row.name),
    uniqueConstraints: uniqueConstraints.map(row => row.name),
  };
}

// ─── Diff Engine ─────────────────────────────────────────────────────────────

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdDiff() {
  requireDatabaseUrl();
  console.log('\n🔍 Comparing schema with database...\n');

  const schemaModels = parseSchema();
  const dbTables = await getExistingTables();

  console.log(`Schema: ${schemaModels.length} models`);
  console.log(`Database: ${dbTables.length} tables\n`);

  const ops = await generateDiff(schemaModels, dbTables, introspectTable, introspectTableArtifacts);

  if (ops.length === 0) {
    console.log('✅ Schema is in sync with database.');
    return;
  }

  console.log(`Found ${ops.length} difference(s):\n`);
  for (const op of ops) {
    console.log(`  ${op.type}: ${op.table}`);
    if (op.details) console.log(`    ${op.details}`);
    if (op.sql) console.log(`    SQL: ${op.sql}`);
  }
}

async function cmdGenerate() {
  requireDatabaseUrl();
  console.log('\n📝 Generating migration file...\n');

  const schemaModels = parseSchema();
  const dbTables = await getExistingTables();
  const ops = await generateDiff(schemaModels, dbTables, introspectTable, introspectTableArtifacts);

  if (ops.length === 0) {
    console.log('No migrations needed.');
    return;
  }

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${timestamp}_migration.sql`;
  const filepath = path.join(migrationsDir, filename);

  fs.writeFileSync(filepath, buildMigrationFile(timestamp, ops));
  console.log(`✅ Migration written to: ${filepath}`);
}

async function cmdApply(args: string[] = []) {
  requireDatabaseUrl();
  const options = parseMigrationCommandOptions(args);
  console.log(options.dryRun ? '\n👀 Previewing pending migrations...\n' : '\n🚀 Applying migrations...\n');

  const db = await getDb();
  const applied = new Map((await getAppliedMigrations({ ensure: true })).map(row => [row.id, row.checksum]));
  const files = listMigrationFiles();
  const pending = files.filter(file => !applied.has(file));

  if (pending.length === 0) {
    console.log('✅ No pending migrations.');
    return;
  }

  for (const file of pending) {
    const filepath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filepath, 'utf8');
    const sections = parseMigrationSections(content);
    const digest = checksum(content);

    if (splitSqlBatches(sections.up).length === 0) {
      throw new Error(`Migration ${file} has no up SQL to apply.`);
    }

    if (options.dryRun) {
      if (splitSqlBatches(sections.preflight).length > 0) {
        printBatches(`-- ${file} preflight`, sections.preflight);
      }
      printBatches(`-- ${file} up`, sections.up);
      continue;
    }

    await db.$transaction(async (tx) => {
      if (splitSqlBatches(sections.preflight).length > 0) {
        await executeBatches(tx, sections.preflight);
      }
      await executeBatches(tx, sections.up);
      await tx._executeRaw(
        `INSERT INTO ${migrationTableName} ([id], [checksum]) VALUES (@id, @checksum)`,
        { id: file, checksum: digest }
      );
    });
    console.log(`✅ Applied ${file}`);
  }
}

async function rollbackOne(db: An5Adapter, migration: { id: string; checksum: string }): Promise<void> {
  const filepath = path.join(migrationsDir, migration.id);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Applied migration file is missing: ${migration.id}`);
  }

  const content = fs.readFileSync(filepath, 'utf8');
  if (checksum(content) !== migration.checksum) {
    throw new Error(`Applied migration checksum changed: ${migration.id}`);
  }

  const sections = parseMigrationSections(content);
  if (!sections.hasDown || splitSqlBatches(sections.down).length === 0) {
    throw new Error(`Migration ${migration.id} does not contain rollback SQL after -- migrate:down.`);
  }

  await db.$transaction(async (tx) => {
    await executeBatches(tx, sections.down);
    await tx._executeRaw(`DELETE FROM ${migrationTableName} WHERE [id] = @id`, { id: migration.id });
  });
  console.log(`✅ Rolled back ${migration.id}`);
}

function readRollbackSql(migration: { id: string; checksum: string }): string {
  const filepath = path.join(migrationsDir, migration.id);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Applied migration file is missing: ${migration.id}`);
  }

  const content = fs.readFileSync(filepath, 'utf8');
  if (checksum(content) !== migration.checksum) {
    throw new Error(`Applied migration checksum changed: ${migration.id}`);
  }

  const sections = parseMigrationSections(content);
  if (!sections.hasDown || splitSqlBatches(sections.down).length === 0) {
    throw new Error(`Migration ${migration.id} does not contain rollback SQL after -- migrate:down.`);
  }
  return sections.down;
}

async function cmdRollback(args: string[] = []) {
  requireDatabaseUrl();
  const options = parseMigrationCommandOptions(args);

  const db = await getDb();
  const applied = await getAppliedMigrations({ ensure: true });
  if (applied.length === 0) {
    console.log('✅ No applied migrations to roll back.');
    return;
  }

  const selection = parseRollbackSelection(options.rest, applied);
  const targets = applied.slice(Math.max(0, applied.length - selection.count)).reverse();
  console.log(options.dryRun ? `\n👀 Previewing rollback ${selection.label}...\n` : `\n↩️ Rolling back ${selection.label}...\n`);

  if (targets.length < selection.count) {
    console.log(`Only ${targets.length} applied migration${targets.length === 1 ? '' : 's'} available.`);
  }

  for (const migration of targets) {
    if (options.dryRun) {
      printBatches(`-- ${migration.id} down`, readRollbackSql(migration));
    } else {
      await rollbackOne(db, migration);
    }
  }
}

async function cmdStatus() {
  requireDatabaseUrl();
  console.log('\n📊 Migration Status\n');

  const schemaModels = parseSchema();
  const dbTables = await getExistingTables();

  console.log('Schema Models:');
  for (const model of schemaModels) {
    const exists = dbTables.includes(model.tableName);
    const icon = exists ? '✅' : '⚠️';
    console.log(`  ${icon} ${model.name} → ${model.tableName} (${model.fields.length} fields)`);
  }

  console.log('\nDatabase Tables:');
  for (const table of dbTables) {
    const inSchema = schemaModels.some(m => m.tableName === table);
    const icon = inSchema ? '✅' : '⚠️';
    console.log(`  ${icon} ${table}`);
  }

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }
  const migrations = listMigrationFiles();
  const applied = await getAppliedMigrations();
  const appliedIds = new Set(applied.map(row => row.id));
  console.log(`\nMigration files: ${migrations.length}`);
  console.log(`Applied migrations: ${applied.length}`);
  console.log(`Pending migrations: ${migrations.filter(file => !appliedIds.has(file)).length}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || 'diff';
  const args = process.argv.slice(3);

  switch (command) {
    case 'diff': await cmdDiff(); break;
    case 'generate': await cmdGenerate(); break;
    case 'apply': await cmdApply(args); break;
    case 'rollback': await cmdRollback(args); break;
    case 'status': await cmdStatus(); break;
    default:
      console.log('Usage: npx tsx migrate.ts [diff|generate|apply [--dry-run]|rollback [--dry-run] [steps|--to file]|status]');
      process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ Migration failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}

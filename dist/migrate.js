"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
require("dotenv/config");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adapters_1 = require("@an5/adapters");
const config_1 = require("./generator/src/config");
const field_types_1 = require("./generator/src/field-types");
const provider_support_1 = require("./provider-support");
const migration_core_1 = require("./migration-core");
const rootDir = process.cwd();
const { config, outputs } = (0, config_1.loadConfig)();
const schemaDir = outputs.schemaDir;
const migrationsDir = path_1.default.resolve(rootDir, 'migrations');
const migrationTableName = '[dbo].[_an5_migrations]';
let _adapter = null;
async function getDb() {
    if (!_adapter) {
        _adapter = new adapters_1.An5Adapter({
            connectionString: (0, config_1.resolveConnectionString)(config, process.env, 'db:migrate'),
        });
        await _adapter.$connect();
    }
    return _adapter;
}
// ─── Schema Parser ───────────────────────────────────────────────────────────
function parseSchema() {
    if (!fs_1.default.existsSync(schemaDir))
        return [];
    const files = fs_1.default.readdirSync(schemaDir).filter(f => f.endsWith('.an5'));
    let text = '';
    for (const file of files) {
        text += fs_1.default.readFileSync(path_1.default.join(schemaDir, file), 'utf8') + '\n';
    }
    return (0, migration_core_1.parseSchemaText)(text, (0, config_1.providerFromConfig)(config, process.env));
}
// ─── Database Introspection ──────────────────────────────────────────────────
async function introspectTable(tableName) {
    return (await getDb()).$queryRawUnsafe(`
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
async function getExistingTables() {
    const rows = await (await getDb()).$queryRawUnsafe(`
    SELECT
      CASE
        WHEN SCHEMA_NAME(schema_id) = 'dbo' THEN name
        ELSE SCHEMA_NAME(schema_id) + '.' + name
      END AS name
    FROM sys.tables
    WHERE is_ms_shipped = 0
    ORDER BY SCHEMA_NAME(schema_id), name
  `);
    return rows.map(r => r.name);
}
async function getExistingViews() {
    const rows = await (await getDb()).$queryRawUnsafe(`
    SELECT
      CASE
        WHEN SCHEMA_NAME(schema_id) = 'dbo' THEN name
        ELSE SCHEMA_NAME(schema_id) + '.' + name
      END AS name
    FROM sys.views
    WHERE is_ms_shipped = 0
    ORDER BY SCHEMA_NAME(schema_id), name
  `);
    return rows.map(r => r.name);
}
async function introspectViewDefinition(viewName) {
    const rows = await (await getDb()).$queryRawUnsafe(`SELECT OBJECT_DEFINITION(OBJECT_ID(@p_0)) AS definition`, viewName);
    return rows[0]?.definition ?? null;
}
function listMigrationFiles() {
    if (!fs_1.default.existsSync(migrationsDir)) {
        fs_1.default.mkdirSync(migrationsDir, { recursive: true });
    }
    return fs_1.default.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
}
function checksum(content) {
    return crypto_1.default.createHash('sha256').update(content).digest('hex');
}
async function ensureMigrationTable() {
    await (await getDb()).$executeRawUnsafe(`
    IF OBJECT_ID('dbo._an5_migrations', 'U') IS NULL
    CREATE TABLE ${migrationTableName} (
      [id] NVARCHAR(255) NOT NULL PRIMARY KEY,
      [checksum] NVARCHAR(64) NOT NULL,
      [appliedAt] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `);
}
async function migrationTableExists() {
    const rows = await (await getDb()).$queryRawUnsafe(`SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('dbo._an5_migrations')`);
    return rows.length > 0;
}
async function getAppliedMigrations(options = {}) {
    if (options.ensure) {
        await ensureMigrationTable();
    }
    else if (!(await migrationTableExists())) {
        return [];
    }
    return (await getDb()).$queryRawUnsafe(`SELECT [id], [checksum], [appliedAt] FROM ${migrationTableName} ORDER BY [id] ASC`);
}
async function executeBatches(executor, sql) {
    for (const batch of (0, migration_core_1.splitSqlBatches)(sql)) {
        if (executor._executeRaw) {
            await executor._executeRaw(batch);
        }
        else if (executor.$executeRawUnsafe) {
            await executor.$executeRawUnsafe(batch);
        }
        else {
            throw new Error('Migration executor does not support raw execution.');
        }
    }
}
function printBatches(title, sql) {
    const batches = (0, migration_core_1.splitSqlBatches)(sql);
    console.log(title);
    for (let i = 0; i < batches.length; i++) {
        console.log(`-- batch ${i + 1}`);
        console.log(batches[i]);
    }
}
async function introspectTableArtifacts(tableName) {
    const indexes = await (await getDb()).$queryRawUnsafe(`
    SELECT name
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(@p_0)
      AND is_primary_key = 0
      AND is_unique_constraint = 0
      AND name IS NOT NULL
  `, tableName);
    const uniqueConstraints = await (await getDb()).$queryRawUnsafe(`
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
    console.log('\n🔍 Comparing schema with database...\n');
    const schemaModels = parseSchema();
    const dbTables = await getExistingTables();
    const dbViews = await getExistingViews();
    const modelCount = schemaModels.filter(model => !model.isView).length;
    const viewCount = schemaModels.length - modelCount;
    console.log(`Schema: ${modelCount} models, ${viewCount} views`);
    console.log(`Database: ${dbTables.length} tables, ${dbViews.length} views\n`);
    const ops = await (0, migration_core_1.generateDiff)(schemaModels, dbTables, introspectTable, introspectTableArtifacts, dbViews, introspectViewDefinition);
    if (ops.length === 0) {
        console.log('✅ Schema is in sync with database.');
        return;
    }
    console.log(`Found ${ops.length} difference(s):\n`);
    for (const op of ops) {
        console.log(`  ${op.type}: ${op.table}`);
        if (op.details)
            console.log(`    ${op.details}`);
        if (op.sql)
            console.log(`    SQL: ${op.sql}`);
    }
}
async function cmdGenerate() {
    console.log('\n📝 Generating migration file...\n');
    const schemaModels = parseSchema();
    const dbTables = await getExistingTables();
    const dbViews = await getExistingViews();
    const ops = await (0, migration_core_1.generateDiff)(schemaModels, dbTables, introspectTable, introspectTableArtifacts, dbViews, introspectViewDefinition);
    if (ops.length === 0) {
        console.log('No migrations needed.');
        return;
    }
    if (!fs_1.default.existsSync(migrationsDir)) {
        fs_1.default.mkdirSync(migrationsDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}_migration.sql`;
    const filepath = path_1.default.join(migrationsDir, filename);
    fs_1.default.writeFileSync(filepath, (0, migration_core_1.buildMigrationFile)(timestamp, ops));
    console.log(`✅ Migration written to: ${filepath}`);
}
async function cmdApply(args = []) {
    const options = (0, migration_core_1.parseMigrationCommandOptions)(args);
    console.log(options.preview ? '\n👀 Previewing pending migrations...\n' : '\n🚀 Applying migrations...\n');
    const db = await getDb();
    const appliedRows = await getAppliedMigrations({ ensure: true });
    const applied = new Map(appliedRows.map(row => [row.id, row.checksum]));
    const files = listMigrationFiles();
    // An applied file that changed on disk no longer describes what the database
    // contains. Applying the rest would build on a history that cannot be reproduced.
    const drift = (0, migration_core_1.verifyAppliedMigrations)(appliedRows, (id) => {
        const filepath = path_1.default.join(migrationsDir, id);
        return fs_1.default.existsSync(filepath) ? fs_1.default.readFileSync(filepath, 'utf8') : null;
    }, checksum);
    if (drift.changed.length > 0 || drift.missing.length > 0) {
        const details = [
            ...drift.changed.map(id => `  changed: ${id}`),
            ...drift.missing.map(id => `  missing: ${id}`),
        ].join('\n');
        throw new Error(`Applied migration history does not match the files on disk:\n${details}\n` +
            'Restore the files, or mark the affected migrations as unapplied deliberately before continuing.');
    }
    const pending = files.filter(file => !applied.has(file));
    if (pending.length === 0) {
        console.log('✅ No pending migrations.');
        return;
    }
    for (const file of pending) {
        const filepath = path_1.default.join(migrationsDir, file);
        const content = fs_1.default.readFileSync(filepath, 'utf8');
        const sections = (0, migration_core_1.parseMigrationSections)(content);
        const digest = checksum(content);
        if ((0, migration_core_1.splitSqlBatches)(sections.up).length === 0) {
            throw new Error(`Migration ${file} has no up SQL to apply.`);
        }
        if (options.preview) {
            if ((0, migration_core_1.splitSqlBatches)(sections.preflight).length > 0) {
                printBatches(`-- ${file} preflight`, sections.preflight);
            }
            printBatches(`-- ${file} up`, sections.up);
            continue;
        }
        await db.$transaction(async (tx) => {
            if ((0, migration_core_1.splitSqlBatches)(sections.preflight).length > 0) {
                await executeBatches(tx, sections.preflight);
            }
            await executeBatches(tx, sections.up);
            await tx._executeRaw(`INSERT INTO ${migrationTableName} ([id], [checksum]) VALUES (@id, @checksum)`, { id: file, checksum: digest });
        });
        console.log(`✅ Applied ${file}`);
    }
}
async function rollbackOne(db, migration) {
    const filepath = path_1.default.join(migrationsDir, migration.id);
    if (!fs_1.default.existsSync(filepath)) {
        throw new Error(`Applied migration file is missing: ${migration.id}`);
    }
    const content = fs_1.default.readFileSync(filepath, 'utf8');
    if (checksum(content) !== migration.checksum) {
        throw new Error(`Applied migration checksum changed: ${migration.id}`);
    }
    const sections = (0, migration_core_1.parseMigrationSections)(content);
    if (!sections.hasDown || (0, migration_core_1.splitSqlBatches)(sections.down).length === 0) {
        throw new Error(`Migration ${migration.id} does not contain rollback SQL after -- migrate:down.`);
    }
    await db.$transaction(async (tx) => {
        await executeBatches(tx, sections.down);
        await tx._executeRaw(`DELETE FROM ${migrationTableName} WHERE [id] = @id`, { id: migration.id });
    });
    console.log(`✅ Rolled back ${migration.id}`);
}
function readRollbackSql(migration) {
    const filepath = path_1.default.join(migrationsDir, migration.id);
    if (!fs_1.default.existsSync(filepath)) {
        throw new Error(`Applied migration file is missing: ${migration.id}`);
    }
    const content = fs_1.default.readFileSync(filepath, 'utf8');
    if (checksum(content) !== migration.checksum) {
        throw new Error(`Applied migration checksum changed: ${migration.id}`);
    }
    const sections = (0, migration_core_1.parseMigrationSections)(content);
    if (!sections.hasDown || (0, migration_core_1.splitSqlBatches)(sections.down).length === 0) {
        throw new Error(`Migration ${migration.id} does not contain rollback SQL after -- migrate:down.`);
    }
    return sections.down;
}
async function cmdRollback(args = []) {
    const options = (0, migration_core_1.parseMigrationCommandOptions)(args);
    const db = await getDb();
    const applied = await getAppliedMigrations({ ensure: true });
    if (applied.length === 0) {
        console.log('✅ No applied migrations to roll back.');
        return;
    }
    const selection = (0, migration_core_1.parseRollbackSelection)(options.rest, applied);
    const targets = applied.slice(Math.max(0, applied.length - selection.count)).reverse();
    console.log(options.preview ? `\n👀 Previewing rollback ${selection.label}...\n` : `\n↩️ Rolling back ${selection.label}...\n`);
    if (targets.length < selection.count) {
        console.log(`Only ${targets.length} applied migration${targets.length === 1 ? '' : 's'} available.`);
    }
    for (const migration of targets) {
        if (options.preview) {
            printBatches(`-- ${migration.id} down`, readRollbackSql(migration));
        }
        else {
            await rollbackOne(db, migration);
        }
    }
}
async function cmdStatus() {
    console.log('\n📊 Migration Status\n');
    const schemaModels = parseSchema();
    const dbTables = await getExistingTables();
    const dbViews = await getExistingViews();
    const tableModels = schemaModels.filter(model => !model.isView);
    const viewModels = schemaModels.filter(model => model.isView);
    console.log('Schema Models:');
    const dbTableIdentities = new Set(dbTables.map(migration_core_1.tableIdentityName));
    for (const model of tableModels) {
        const exists = dbTableIdentities.has((0, migration_core_1.tableIdentityName)(model.tableName));
        const icon = exists ? '✅' : '⚠️';
        console.log(`  ${icon} ${model.name} → ${model.tableName} (${model.fields.length} fields)`);
    }
    const dbViewIdentities = new Set(dbViews.map(migration_core_1.tableIdentityName));
    if (viewModels.length > 0 || dbViews.length > 0) {
        console.log('\nSchema Views:');
        for (const view of viewModels) {
            const exists = dbViewIdentities.has((0, migration_core_1.tableIdentityName)(view.tableName));
            const icon = exists ? '✅' : '⚠️';
            console.log(`  ${icon} ${view.name} → ${view.tableName} (${view.fields.length} fields)`);
        }
    }
    console.log('\nDatabase Tables:');
    const schemaTableIdentities = new Set(tableModels.map(model => (0, migration_core_1.tableIdentityName)(model.tableName)));
    for (const table of dbTables) {
        const inSchema = schemaTableIdentities.has((0, migration_core_1.tableIdentityName)(table));
        const icon = inSchema ? '✅' : '⚠️';
        console.log(`  ${icon} ${table}`);
    }
    if (dbViews.length > 0) {
        console.log('\nDatabase Views:');
        const schemaViewIdentities = new Set(viewModels.map(view => (0, migration_core_1.tableIdentityName)(view.tableName)));
        for (const view of dbViews) {
            const inSchema = schemaViewIdentities.has((0, migration_core_1.tableIdentityName)(view));
            const icon = inSchema ? '✅' : '⚠️';
            console.log(`  ${icon} ${view}`);
        }
    }
    if (!fs_1.default.existsSync(migrationsDir)) {
        fs_1.default.mkdirSync(migrationsDir, { recursive: true });
    }
    const migrations = listMigrationFiles();
    const applied = await getAppliedMigrations();
    const appliedIds = new Set(applied.map(row => row.id));
    console.log(`\nMigration files: ${migrations.length}`);
    console.log(`Applied migrations: ${applied.length}`);
    console.log(`Pending migrations: ${migrations.filter(file => !appliedIds.has(file)).length}`);
}
// ─── Main ────────────────────────────────────────────────────────────────────
/**
 * Prints why a command cannot run against this provider and exits.
 *
 * The decision and the wording live in `./provider-support`, which stays free of Node
 * globals so it can be imported and tested anywhere; only the command files, which
 * are Node programs, do the exiting.
 */
function refuseIfNotSqlServer(provider, command) {
    const message = (0, provider_support_1.sqlServerOnlyError)(provider, command);
    if (message === null)
        return;
    console.error(message);
    process.exit(1);
}
const MIGRATION_COMMANDS = ['diff', 'generate', 'apply', 'rollback', 'status'];
async function main() {
    const command = process.argv[2] || 'diff';
    const args = process.argv.slice(3);
    // Checked after the subcommand is known, so a typo gets the usage line instead of
    // a warning about the wrong database.
    if (!MIGRATION_COMMANDS.includes(command)) {
        console.log('Usage: npx tsx migrate.ts [diff|generate|apply [--preview]|rollback [--preview] [steps|--to file]|status]');
        process.exit(1);
    }
    // Every subcommand reads sys.* and writes T-SQL, so a non-SQL Server connection
    // string is a mistake worth naming before any of it runs.
    refuseIfNotSqlServer((0, config_1.providerFromConfig)(config, process.env), process.argv[2] ? `db:migrate:${command}` : 'db:migrate');
    switch (command) {
        case 'diff':
            await cmdDiff();
            break;
        case 'generate':
            await cmdGenerate();
            break;
        case 'apply':
            await cmdApply(args);
            break;
        case 'rollback':
            await cmdRollback(args);
            break;
        case 'status':
            await cmdStatus();
            break;
    }
    process.exit(0);
}
if (require.main === module) {
    main().catch((err) => {
        // A field type error carries one line per offending field; the message alone
        // would name the provider without saying which fields to fix.
        if (err instanceof field_types_1.FieldTypeError) {
            console.error(`❌ ${err.message}:`);
            console.error((0, config_1.formatIssues)(err.issues));
        }
        else {
            console.error(`❌ Migration failed: ${err instanceof Error ? err.message : err}`);
        }
        process.exit(1);
    });
}

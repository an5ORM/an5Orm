"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeNewMigrationFile = writeNewMigrationFile;
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
const dialect_1 = require("./generator/src/dialect");
const provider_support_1 = require("./provider-support");
const migration_core_1 = require("./migration-core");
const rootDir = process.cwd();
const { config, outputs } = (0, config_1.loadConfig)();
const migrationProvider = (0, config_1.providerFromConfig)(config, process.env);
const migrationDialect = (0, dialect_1.dialectFor)(migrationProvider);
const schemaDir = outputs.schemaDir;
const migrationsDir = path_1.default.resolve(rootDir, 'migrations');
const migrationTableName = migrationProvider === 'mssql'
    ? '[dbo].[_an5_migrations]'
    : migrationDialect.quoteTable('_an5_migrations');
let postgresDefaultSchema;
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
async function migrationQuery(executor, query, ...values) {
    if ('$queryRawUnsafe' in executor) {
        return executor.$queryRawUnsafe(query, ...values);
    }
    const params = Object.fromEntries(values.map((value, index) => [`p_${index}`, value]));
    return executor.exec(query, params);
}
async function migrationExecute(executor, query) {
    if ('$executeRawUnsafe' in executor) {
        return executor.$executeRawUnsafe(query);
    }
    return executor._executeRaw(query);
}
async function withMigrationLock(db, operation) {
    return db.$transaction(async (tx) => {
        if (migrationProvider === 'mssql') {
            const rows = await tx.exec(`
        DECLARE @lockResult INT;
        EXEC @lockResult = sys.sp_getapplock
          @Resource = N'an5Orm:db:migrations',
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 60000;
        SELECT @lockResult AS lockResult;
      `);
            const lockResult = rows[0]?.lockResult;
            if (typeof lockResult !== 'number' || lockResult < 0) {
                throw new Error(`Could not acquire the SQL Server migration lock (result: ${String(lockResult)}).`);
            }
        }
        else {
            await tx.exec(`SELECT pg_advisory_xact_lock(hashtext('an5Orm:db:migrations')::bigint)`);
        }
        return operation(tx);
    });
}
function postgresTableParts(tableName) {
    const parts = tableName.replace(/["`\[\]]/g, '').split('.').filter(Boolean);
    if (parts.length > 1) {
        return { schema: parts.slice(0, -1).join('.'), name: parts[parts.length - 1] ?? tableName };
    }
    return { name: parts[0] ?? tableName };
}
async function getPostgresDefaultSchema() {
    if (postgresDefaultSchema)
        return postgresDefaultSchema;
    const rows = await (await getDb()).$queryRawUnsafe('SELECT current_schema() AS name');
    const schema = rows[0]?.name;
    if (!schema)
        throw new Error('PostgreSQL has no current schema in the active search_path.');
    postgresDefaultSchema = schema;
    return schema;
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
    if (migrationProvider === 'postgres') {
        const { schema, name } = postgresTableParts(tableName);
        const schemaPredicate = schema ? 'c.table_schema = @p_1' : 'c.table_schema = current_schema()';
        return (await getDb()).$queryRawUnsafe(`
      SELECT
        c.column_name AS "columnName",
        c.data_type AS "dataType",
        c.character_maximum_length AS "maxLength",
        c.numeric_precision AS "precision",
        c.numeric_scale AS "scale",
        c.datetime_precision AS "datetimePrecision",
        (c.is_nullable = 'YES') AS "isNullable",
        EXISTS (
          SELECT 1
          FROM pg_index pi
          WHERE pi.indrelid = t.oid
            AND pi.indisprimary
            AND a.attnum = ANY(pi.indkey)
        ) AS "isPrimaryKey",
        (a.attidentity <> '') AS "isIdentity",
        pg_get_expr(d.adbin, d.adrelid) AS "defaultValue"
      FROM information_schema.columns c
      JOIN pg_namespace n ON n.nspname = c.table_schema
      JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
      LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
      WHERE ${schemaPredicate} AND c.table_name = @p_0
      ORDER BY c.ordinal_position
    `, name, ...(schema ? [schema] : []));
    }
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
    if (migrationProvider === 'postgres') {
        await getPostgresDefaultSchema();
        const rows = await (await getDb()).$queryRawUnsafe(`
      SELECT schemaname || '.' || tablename AS name
      FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename
    `);
        return rows.map(row => row.name);
    }
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
    if (migrationProvider === 'postgres') {
        await getPostgresDefaultSchema();
        const rows = await (await getDb()).$queryRawUnsafe(`
      SELECT schemaname || '.' || viewname AS name
      FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, viewname
    `);
        return rows.map(row => row.name);
    }
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
    if (migrationProvider === 'postgres') {
        const { schema, name } = postgresTableParts(viewName);
        const schemaPredicate = schema ? 'schemaname = @p_1' : 'schemaname = current_schema()';
        const rows = await (await getDb()).$queryRawUnsafe(`
      SELECT definition
      FROM pg_views
      WHERE ${schemaPredicate} AND viewname = @p_0
    `, name, ...(schema ? [schema] : []));
        return rows[0]?.definition ?? null;
    }
    const rows = await (await getDb()).$queryRawUnsafe(`SELECT OBJECT_DEFINITION(OBJECT_ID(@p_0)) AS definition`, viewName);
    return rows[0]?.definition ?? null;
}
function listMigrationFiles() {
    if (!fs_1.default.existsSync(migrationsDir))
        return [];
    const seen = new Set();
    return fs_1.default.readdirSync(migrationsDir).filter((file) => {
        if (!file.endsWith('.sql'))
            return false;
        if (!(0, migration_core_1.isValidMigrationId)(file)) {
            throw new Error(`Invalid migration filename: ${JSON.stringify(file)}.`);
        }
        const normalized = file.toLowerCase();
        if (seen.has(normalized)) {
            throw new Error(`Migration filenames differ only by case: ${JSON.stringify(file)}.`);
        }
        seen.add(normalized);
        const entry = fs_1.default.lstatSync(path_1.default.join(migrationsDir, file));
        if (!entry.isFile() || entry.isSymbolicLink()) {
            throw new Error(`Migration entry is not a regular file: ${JSON.stringify(file)}.`);
        }
        return true;
    }).sort();
}
function writeNewMigrationFile(directory, timestamp, content) {
    fs_1.default.mkdirSync(directory, { recursive: true });
    for (let attempt = 0; attempt < 1000; attempt++) {
        const filename = (0, migration_core_1.migrationFileName)(timestamp, attempt);
        const candidate = path_1.default.join(directory, filename);
        try {
            fs_1.default.writeFileSync(candidate, content, { flag: 'wx' });
            return candidate;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
    throw new Error('Could not allocate a unique migration filename after 1000 attempts.');
}
function migrationFilePath(id) {
    if (!(0, migration_core_1.isValidMigrationId)(id)) {
        throw new Error(`Invalid migration id in history: ${JSON.stringify(id)}.`);
    }
    return path_1.default.join(migrationsDir, id);
}
function checksum(content) {
    return crypto_1.default.createHash('sha256').update(content).digest('hex');
}
async function ensureMigrationTable(executor) {
    if (migrationProvider === 'postgres') {
        await migrationExecute(executor, `
      CREATE TABLE IF NOT EXISTS ${migrationTableName} (
        ${migrationDialect.quote('id')} VARCHAR(255) PRIMARY KEY,
        ${migrationDialect.quote('checksum')} VARCHAR(64) NOT NULL,
        ${migrationDialect.quote('appliedAt')} TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
        return;
    }
    await migrationExecute(executor, `
    IF OBJECT_ID('dbo._an5_migrations', 'U') IS NULL
    CREATE TABLE ${migrationTableName} (
      [id] NVARCHAR(255) NOT NULL PRIMARY KEY,
      [checksum] NVARCHAR(64) NOT NULL,
      [appliedAt] DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    )
  `);
}
async function migrationTableExists(executor) {
    if (migrationProvider === 'postgres') {
        const rows = await migrationQuery(executor, `SELECT to_regclass('_an5_migrations') IS NOT NULL AS "exists"`);
        return rows[0]?.exists === true;
    }
    const rows = await migrationQuery(executor, `SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('dbo._an5_migrations')`);
    return rows.length > 0;
}
async function getAppliedMigrations(executor, options = {}) {
    if (options.ensure) {
        await ensureMigrationTable(executor);
    }
    else if (!(await migrationTableExists(executor))) {
        return [];
    }
    return migrationQuery(executor, `SELECT ${migrationDialect.quote('id')}, ${migrationDialect.quote('checksum')}, ${migrationDialect.quote('appliedAt')} ` +
        `FROM ${migrationTableName} ORDER BY ${migrationDialect.quote('id')} ASC`);
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
    if (migrationProvider === 'postgres') {
        const { schema, name } = postgresTableParts(tableName);
        const schemaPredicate = schema ? 'n.nspname = @p_1' : 'n.nspname = current_schema()';
        const indexes = await (await getDb()).$queryRawUnsafe(`
      SELECT idx.relname AS name
      FROM pg_class tbl
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      JOIN pg_index pi ON pi.indrelid = tbl.oid
      JOIN pg_class idx ON idx.oid = pi.indexrelid
      WHERE ${schemaPredicate}
        AND tbl.relname = @p_0
        AND NOT pi.indisprimary
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con
          WHERE con.conindid = idx.oid AND con.contype = 'u'
        )
    `, name, ...(schema ? [schema] : []));
        const uniqueConstraints = await (await getDb()).$queryRawUnsafe(`
      SELECT con.conname AS name
      FROM pg_constraint con
      JOIN pg_class tbl ON tbl.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      WHERE ${schemaPredicate}
        AND tbl.relname = @p_0
        AND con.contype = 'u'
    `, name, ...(schema ? [schema] : []));
        return {
            indexes: indexes.map(row => row.name),
            uniqueConstraints: uniqueConstraints.map(row => row.name),
        };
    }
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
    const ops = await (0, migration_core_1.generateDiff)(schemaModels, dbTables, introspectTable, introspectTableArtifacts, dbViews, introspectViewDefinition, migrationProvider, postgresDefaultSchema);
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
    const ops = await (0, migration_core_1.generateDiff)(schemaModels, dbTables, introspectTable, introspectTableArtifacts, dbViews, introspectViewDefinition, migrationProvider, postgresDefaultSchema);
    if (ops.length === 0) {
        console.log('No migrations needed.');
        return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    const content = (0, migration_core_1.buildMigrationFile)(timestamp, ops, migrationProvider);
    const filepath = writeNewMigrationFile(migrationsDir, timestamp, content);
    console.log(`✅ Migration written to: ${filepath}`);
}
function verifyMigrationHistory(appliedRows) {
    const files = new Set(listMigrationFiles());
    const drift = (0, migration_core_1.verifyAppliedMigrations)(appliedRows, (id) => {
        if (!files.has(id))
            return null;
        const filepath = migrationFilePath(id);
        return fs_1.default.readFileSync(filepath, 'utf8');
    }, checksum);
    if (drift.changed.length > 0 || drift.missing.length > 0) {
        const details = [
            ...drift.changed.map(id => `  changed: ${id}`),
            ...drift.missing.map(id => `  missing: ${id}`),
        ].join('\n');
        throw new Error(`Applied migration history does not match the files on disk:\n${details}\n` +
            'Restore the files, or mark the affected migrations as unapplied deliberately before continuing.');
    }
}
async function cmdApply(args = []) {
    const options = (0, migration_core_1.parseMigrationCommandOptions)(args);
    if (options.rest.length > 0)
        throw new Error('Apply accepts only the --preview option.');
    console.log(options.preview ? '\n👀 Previewing pending migrations...\n' : '\n🚀 Applying migrations...\n');
    if (listMigrationFiles().length === 0) {
        console.log('✅ No pending migrations.');
        return;
    }
    const db = await getDb();
    if (options.preview) {
        await withMigrationLock(db, async (tx) => {
            const appliedRows = await getAppliedMigrations(tx);
            verifyMigrationHistory(appliedRows);
            const applied = new Set(appliedRows.map(row => row.id));
            const pending = listMigrationFiles().filter(file => !applied.has(file));
            if (pending.length === 0) {
                console.log('✅ No pending migrations.');
                return;
            }
            for (const file of pending) {
                const content = fs_1.default.readFileSync(migrationFilePath(file), 'utf8');
                const sections = (0, migration_core_1.parseMigrationSections)(content);
                if ((0, migration_core_1.splitSqlBatches)(sections.up).length === 0) {
                    throw new Error(`Migration ${file} has no up SQL to apply.`);
                }
                if ((0, migration_core_1.splitSqlBatches)(sections.preflight).length > 0) {
                    printBatches(`-- ${file} preflight`, sections.preflight);
                }
                printBatches(`-- ${file} up`, sections.up);
            }
        });
        return;
    }
    let appliedCount = 0;
    while (true) {
        const next = await withMigrationLock(db, async (tx) => {
            const files = listMigrationFiles();
            if (files.length === 0)
                return null;
            await ensureMigrationTable(tx);
            const appliedRows = await getAppliedMigrations(tx);
            verifyMigrationHistory(appliedRows);
            const applied = new Set(appliedRows.map(row => row.id));
            const file = files.find(candidate => !applied.has(candidate));
            if (!file)
                return null;
            const content = fs_1.default.readFileSync(migrationFilePath(file), 'utf8');
            const sections = (0, migration_core_1.parseMigrationSections)(content);
            const digest = checksum(content);
            if ((0, migration_core_1.splitSqlBatches)(sections.up).length === 0) {
                throw new Error(`Migration ${file} has no up SQL to apply.`);
            }
            if ((0, migration_core_1.splitSqlBatches)(sections.preflight).length > 0) {
                await executeBatches(tx, sections.preflight);
            }
            await executeBatches(tx, sections.up);
            await tx._executeRaw(`INSERT INTO ${migrationTableName} (${migrationDialect.quote('id')}, ${migrationDialect.quote('checksum')}) VALUES (@id, @checksum)`, { id: file, checksum: digest });
            return file;
        });
        if (!next)
            break;
        appliedCount++;
        console.log(`✅ Applied ${next}`);
    }
    if (appliedCount === 0) {
        console.log('✅ No pending migrations.');
    }
}
async function rollbackOne(tx, migration) {
    const filepath = migrationFilePath(migration.id);
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
    await executeBatches(tx, sections.down);
    await tx._executeRaw(`DELETE FROM ${migrationTableName} WHERE ${migrationDialect.quote('id')} = @id`, { id: migration.id });
}
function readRollbackSql(migration) {
    const filepath = migrationFilePath(migration.id);
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
    const targets = await withMigrationLock(db, async (tx) => {
        const applied = await getAppliedMigrations(tx);
        verifyMigrationHistory(applied);
        if (applied.length === 0)
            return [];
        const selection = (0, migration_core_1.parseRollbackSelection)(options.rest, applied);
        const selected = applied.slice(Math.max(0, applied.length - selection.count)).reverse();
        console.log(options.preview
            ? `\n👀 Previewing rollback ${selection.label}...\n`
            : `\n↩️ Rolling back ${selection.label}...\n`);
        for (const migration of selected) {
            if (options.preview)
                printBatches(`-- ${migration.id} down`, readRollbackSql(migration));
        }
        return selected;
    });
    if (targets.length === 0) {
        console.log('✅ No applied migrations to roll back.');
        return;
    }
    if (options.preview)
        return;
    for (const migration of targets) {
        await withMigrationLock(db, async (tx) => {
            const applied = await getAppliedMigrations(tx);
            verifyMigrationHistory(applied);
            const latest = applied[applied.length - 1];
            if (!latest || latest.id !== migration.id || latest.checksum !== migration.checksum) {
                throw new Error(`Migration history changed after rollback selection; expected ${migration.id} to be the latest applied migration. ` +
                    'Inspect status and retry the rollback.');
            }
            await rollbackOne(tx, migration);
        });
        console.log(`✅ Rolled back ${migration.id}`);
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
    const dbTableIdentities = new Set(dbTables.map(name => (0, migration_core_1.tableIdentityName)(name, postgresDefaultSchema)));
    for (const model of tableModels) {
        const exists = dbTableIdentities.has((0, migration_core_1.tableIdentityName)(model.tableName, postgresDefaultSchema));
        const icon = exists ? '✅' : '⚠️';
        console.log(`  ${icon} ${model.name} → ${model.tableName} (${model.fields.length} fields)`);
    }
    const dbViewIdentities = new Set(dbViews.map(name => (0, migration_core_1.tableIdentityName)(name, postgresDefaultSchema)));
    if (viewModels.length > 0 || dbViews.length > 0) {
        console.log('\nSchema Views:');
        for (const view of viewModels) {
            const exists = dbViewIdentities.has((0, migration_core_1.tableIdentityName)(view.tableName, postgresDefaultSchema));
            const icon = exists ? '✅' : '⚠️';
            console.log(`  ${icon} ${view.name} → ${view.tableName} (${view.fields.length} fields)`);
        }
    }
    console.log('\nDatabase Tables:');
    const schemaTableIdentities = new Set(tableModels.map(model => (0, migration_core_1.tableIdentityName)(model.tableName, postgresDefaultSchema)));
    for (const table of dbTables) {
        const inSchema = schemaTableIdentities.has((0, migration_core_1.tableIdentityName)(table, postgresDefaultSchema));
        const icon = inSchema ? '✅' : '⚠️';
        console.log(`  ${icon} ${table}`);
    }
    if (dbViews.length > 0) {
        console.log('\nDatabase Views:');
        const schemaViewIdentities = new Set(viewModels.map(view => (0, migration_core_1.tableIdentityName)(view.tableName, postgresDefaultSchema)));
        for (const view of dbViews) {
            const inSchema = schemaViewIdentities.has((0, migration_core_1.tableIdentityName)(view, postgresDefaultSchema));
            const icon = inSchema ? '✅' : '⚠️';
            console.log(`  ${icon} ${view}`);
        }
    }
    const migrations = listMigrationFiles();
    const applied = await getAppliedMigrations(await getDb());
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
function refuseUnsupportedMigrationProvider(provider, command) {
    const message = (0, provider_support_1.migrationProviderError)(provider, command);
    if (message === null)
        return;
    throw new Error(message);
}
const MIGRATION_COMMANDS = ['diff', 'generate', 'apply', 'rollback', 'status'];
async function main() {
    const command = process.argv[2] || 'diff';
    const args = process.argv.slice(3);
    // Checked after the subcommand is known, so a typo gets the usage line instead of
    // a warning about the wrong database.
    if (!MIGRATION_COMMANDS.includes(command)) {
        console.log('Usage: npx tsx migrate.ts [diff|generate|apply [--preview]|rollback [--preview] [steps|--to file]|status]');
        process.exitCode = 1;
        return;
    }
    if (command !== 'apply' && command !== 'rollback' && args.length > 0) {
        throw new Error(`${command} does not accept additional arguments.`);
    }
    // Every subcommand needs a supported relational migration dialect.
    refuseUnsupportedMigrationProvider(migrationProvider, process.argv[2] ? `db:migrate:${command}` : 'db:migrate');
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
}
if (require.main === module) {
    main()
        .catch((err) => {
        // A field type error carries one line per offending field; the message alone
        // would name the provider without saying which fields to fix.
        if (err instanceof field_types_1.FieldTypeError) {
            console.error(`❌ ${err.message}:`);
            console.error((0, config_1.formatIssues)(err.issues));
        }
        else {
            console.error(`❌ Migration failed: ${err instanceof Error ? err.message : err}`);
        }
        process.exitCode = 1;
    })
        .finally(async () => {
        if (!_adapter)
            return;
        try {
            await _adapter.$disconnect();
            _adapter = null;
        }
        catch (error) {
            console.error(`❌ Failed to disconnect migration adapter: ${error instanceof Error ? error.message : error}`);
            process.exitCode = 1;
        }
    });
}

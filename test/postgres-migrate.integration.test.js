const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { An5Adapter } = require('@an5/adapters');
const { buildMigrationFile } = require('../dist/migration-core.js');

const POSTGRES_URL = process.env.POSTGRES_DATABASE_URL;
const REQUIRE_LIVE_DB = process.env.REQUIRE_POSTGRES_LIVE_DB === '1';

function scopedConnectionString(connectionString, schema) {
  const url = new URL(connectionString);
  const options = [url.searchParams.get('options'), `-c search_path=${schema}`].filter(Boolean).join(' ');
  url.searchParams.set('options', options);
  return url.toString();
}

function runMigrationCli(workspace, connectionString, ...args) {
  return execFileSync(process.execPath, [
    require.resolve('tsx/cli'),
    path.join(__dirname, '..', 'migrate.ts'),
    ...args,
  ], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: connectionString },
    encoding: 'utf8',
    timeout: 90000,
  });
}

function runMigrationCliAsync(workspace, connectionString, ...args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      require.resolve('tsx/cli'),
      path.join(__dirname, '..', 'migrate.ts'),
      ...args,
    ], {
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
      timeout: 90000,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Migration CLI failed: ${error.message}\n${stdout || ''}\n${stderr || ''}`));
        return;
      }
      resolve(`${stdout || ''}${stderr || ''}`);
    });
  });
}

async function exists(adapter, relation) {
  const rows = await adapter.$queryRawUnsafe(
    'SELECT to_regclass(@p_0) IS NOT NULL AS "exists"',
    relation,
  );
  return rows[0]?.exists === true;
}

async function main() {
  if (!POSTGRES_URL) {
    const message = 'No PostgreSQL test database configured. Set POSTGRES_DATABASE_URL to a disposable database.';
    if (REQUIRE_LIVE_DB) throw new Error(message);
    console.log(`${message} Skipping PostgreSQL migration integration.`);
    return;
  }
  if (!/^postgres(?:ql)?:\/\//i.test(POSTGRES_URL)) {
    throw new Error('POSTGRES_DATABASE_URL must use a postgres:// or postgresql:// URL.');
  }

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const schema = `an5_migrate_${suffix}`;
  const connectionString = scopedConnectionString(POSTGRES_URL, schema);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-postgres-migrate-'));
  const migrationsDir = path.join(workspace, 'migrations');
  const schemaDir = path.join(workspace, 'schema');
  const tableName = `pgmigrateprobe_${suffix}`;
  const concurrentTableName = `pgmigrateprobe_concurrent_${suffix}`;
  const setup = new An5Adapter({ connectionString: POSTGRES_URL });
  let database;
  let schemaCreated = false;

  try {
    await setup.$connect();
    await setup._executeRaw(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;

    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspace, 'an5Orm.config.js'),
      'module.exports = { schemaDir: "schema" };\n',
    );
    fs.writeFileSync(path.join(schemaDir, 'Probe.an5'), [
      'model PgMigrateProbe {',
      '  id INTEGER @id @default(autoincrement())',
      '  label VARCHAR(100)?',
      `  @@map("${tableName}")`,
      '}',
      '',
    ].join('\n'));

    database = new An5Adapter({ connectionString });
    await database.$connect();

    const diff = runMigrationCli(workspace, connectionString, 'diff');
    assert.match(diff, new RegExp(`CREATE_TABLE: ${tableName}`));
    runMigrationCli(workspace, connectionString, 'generate');
    const generated = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql'));
    assert.strictEqual(generated.length, 1);
    const generatedSql = fs.readFileSync(path.join(migrationsDir, generated[0]), 'utf8');
    assert.match(generatedSql, /CREATE TABLE "pgmigrateprobe_/);
    assert.doesNotMatch(generatedSql, /\bGO\b|\[[^\]]+\]|IDENTITY\(1,1\)/);

    const concurrentId = 'zzzz_postgres_concurrent.sql';
    fs.writeFileSync(path.join(migrationsDir, concurrentId), buildMigrationFile('postgres-concurrent', [{
      type: 'CREATE_TABLE',
      table: concurrentTableName,
      sql: `CREATE TABLE "${concurrentTableName}" ("id" INTEGER PRIMARY KEY)`,
    }], 'postgres'));

    assert.strictEqual(await exists(database, tableName), false);
    assert.strictEqual(await exists(database, '_an5_migrations'), false);
    runMigrationCli(workspace, connectionString, 'apply', '--preview');
    runMigrationCli(workspace, connectionString, 'rollback', '--preview', '2');
    assert.strictEqual(await exists(database, tableName), false);
    assert.strictEqual(await exists(database, '_an5_migrations'), false);

    await Promise.all([
      runMigrationCliAsync(workspace, connectionString, 'apply'),
      runMigrationCliAsync(workspace, connectionString, 'apply'),
    ]);
    assert.strictEqual(await exists(database, tableName), true);
    assert.strictEqual(await exists(database, concurrentTableName), true);
    const appliedRows = await database.$queryRawUnsafe(
      'SELECT id FROM "_an5_migrations" ORDER BY id',
    );
    assert.deepStrictEqual(appliedRows.map(row => row.id), [...generated, concurrentId].sort());

    runMigrationCli(workspace, connectionString, 'rollback', '2');
    assert.strictEqual(await exists(database, tableName), false);
    assert.strictEqual(await exists(database, concurrentTableName), false);
    console.log('PostgreSQL migration integration passed');
  } finally {
    if (database) await database.$disconnect();
    if (schemaCreated) await setup._executeRaw(`DROP SCHEMA "${schema}" CASCADE`);
    await setup.$disconnect();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

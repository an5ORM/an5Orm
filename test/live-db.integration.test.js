const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { An5ORM } = require('../dist/index.js');
const { buildMigrationFile } = require('../dist/migration-core.js');
const { An5Adapter } = require('@an5/adapters');

const MSSQL_URL = process.env.MSSQL_DATABASE_URL || process.env.DATABASE_URL;
const REQUIRE_LIVE_DB = process.env.REQUIRE_LIVE_DB === '1' || process.env.REQUIRE_ORM_LIVE_DB === '1';

function q(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

async function waitForConnection(adapter) {
  let lastError;
  for (let i = 0; i < 40; i++) {
    try {
      await adapter.$connect();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw new Error(`SQL Server did not become ready: ${lastError?.message || lastError}`);
}

function runMigrationCli(workspace, command) {
  const parts = Array.isArray(command) ? command : [command];
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execFileSync(npx, ['tsx', path.join(__dirname, '..', 'migrate.ts'), ...parts], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: MSSQL_URL },
    stdio: 'pipe',
  });
}

async function tableExists(adapter, tableName) {
  const rows = await adapter.$queryRawUnsafe(
    `SELECT name FROM sys.tables WHERE object_id = OBJECT_ID(@p_0)`,
    `dbo.${tableName}`
  );
  return rows.length > 0;
}

async function main() {
  if (!MSSQL_URL || !/^sqlserver:\/\//i.test(MSSQL_URL)) {
    const message = 'No SQL Server live database URL configured. Set MSSQL_DATABASE_URL or DATABASE_URL.';
    if (REQUIRE_LIVE_DB) throw new Error(message);
    console.log(`${message} Skipping ORM live DB integration.`);
    return;
  }

  process.env.DATABASE_URL = MSSQL_URL;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
  const userTable = `an5_orm_live_users_${suffix}`;
  const orderTable = `an5_orm_live_orders_${suffix}`;
  const migrationTable = `an5_orm_migrate_${suffix}`;
  const migrationTableB = `an5_orm_migrate_b_${suffix}`;
  const userTableSql = `[dbo].${q(userTable)}`;
  const orderTableSql = `[dbo].${q(orderTable)}`;
  const migrationTableSql = `[dbo].${q(migrationTable)}`;
  const migrationTableBSql = `[dbo].${q(migrationTableB)}`;

  const setup = new An5Adapter({ connectionString: MSSQL_URL, connectionTimeout: 30000, requestTimeout: 60000 });
  let db;

  const metadata = {
    modelToTable: {
      liveUser: `dbo.${userTable}`,
      LiveUser: `dbo.${userTable}`,
      liveUsers: `dbo.${userTable}`,
      LiveUsers: `dbo.${userTable}`,
      liveOrder: `dbo.${orderTable}`,
      LiveOrder: `dbo.${orderTable}`,
      liveOrders: `dbo.${orderTable}`,
      LiveOrders: `dbo.${orderTable}`,
    },
    modelFields: {
      liveUser: {
        id: { ts: 'string', sql: 'NVARCHAR(64)' },
        email: { ts: 'string', sql: 'NVARCHAR(255)' },
        name: { ts: 'string', sql: 'NVARCHAR(255)' },
        score: { ts: 'number', sql: 'INT' },
        embedding: { ts: 'string', sql: 'NVARCHAR(MAX)' },
        createdAt: { ts: 'Date', sql: 'DATETIME2' },
        updatedAt: { ts: 'Date', sql: 'DATETIME2' },
      },
      liveOrder: {
        id: { ts: 'string', sql: 'NVARCHAR(64)' },
        userId: { ts: 'string', sql: 'NVARCHAR(64)' },
        total: { ts: 'number', sql: 'INT' },
        status: { ts: 'string', sql: 'NVARCHAR(64)' },
      },
    },
    relationMap: {
      liveUser: {
        orders: { modelName: 'liveOrder', relationType: 'many', foreignKey: 'userId', localKey: 'id' },
      },
      liveOrder: {
        user: { modelName: 'liveUser', relationType: 'one', foreignKey: 'userId', localKey: 'id' },
      },
    },
  };

  try {
    await waitForConnection(setup);
    await setup._executeRaw(`IF OBJECT_ID('dbo.${orderTable}', 'U') IS NOT NULL DROP TABLE ${orderTableSql}`);
    await setup._executeRaw(`IF OBJECT_ID('dbo.${userTable}', 'U') IS NOT NULL DROP TABLE ${userTableSql}`);
    await setup._executeRaw(`
      CREATE TABLE ${userTableSql} (
        [id] NVARCHAR(64) NOT NULL PRIMARY KEY,
        [email] NVARCHAR(255) NOT NULL UNIQUE,
        [name] NVARCHAR(255) NULL,
        [score] INT NOT NULL DEFAULT 0,
        [embedding] NVARCHAR(MAX) NULL,
        [createdAt] DATETIME2 NULL,
        [updatedAt] DATETIME2 NULL
      )
    `);
    await setup._executeRaw(`
      CREATE TABLE ${orderTableSql} (
        [id] NVARCHAR(64) NOT NULL PRIMARY KEY,
        [userId] NVARCHAR(64) NULL,
        [total] INT NOT NULL DEFAULT 0,
        [status] NVARCHAR(64) NULL,
        CONSTRAINT ${q(`FK_${orderTable}_user`)} FOREIGN KEY ([userId]) REFERENCES ${userTableSql}([id])
      )
    `);

    db = new An5ORM(undefined, metadata);

    const created = await db.liveUser.create({
      data: {
        id: 'u1',
        email: 'alpha@example.com',
        name: 'Alpha',
        score: 10,
        embedding: '[1,0,0]',
        orders: {
          create: [
            { id: 'o1', total: 10, status: 'open' },
            { id: 'o2', total: 25, status: 'paid' },
          ],
        },
      },
      include: {
        orders: { orderBy: { total: 'asc' } },
        _count: true,
      },
    });

    assert.strictEqual(created.id, 'u1');
    assert.deepStrictEqual(created.orders.map((row) => row.id), ['o1', 'o2']);
    assert.deepStrictEqual(created._count, { orders: 2 });

    await db.liveUser.create({
      data: {
        id: 'u2',
        email: 'beta@example.com',
        name: 'Beta',
        score: 20,
        embedding: '[0.8,0.2,0]',
        orders: { create: { id: 'o3', total: 5, status: 'open' } },
      },
    });

    const relationFiltered = await db.liveUser.findMany({
      where: {
        orders: { some: { total: { gte: 20 } } },
        NOT: { name: { equals: 'Beta' } },
      },
      include: { orders: { select: { id: true, total: true } }, _count: true },
    });
    assert.deepStrictEqual(relationFiltered.map((row) => row.id), ['u1']);
    assert.deepStrictEqual(relationFiltered[0].orders.map((row) => row.id).sort(), ['o1', 'o2']);
    assert.strictEqual(relationFiltered[0]._count.orders, 2);

    const selected = await db.liveUser.findMany({
      where: { id: 'u1' },
      select: {
        name: true,
        orders: { select: { id: true }, orderBy: { id: 'asc' } },
        _count: true,
      },
    });
    assert.deepStrictEqual(selected, [{ name: 'Alpha', orders: [{ id: 'o1' }, { id: 'o2' }], _count: { orders: 2 } }]);

    const updated = await db.liveUser.update({
      where: { id: 'u1' },
      data: {
        score: { increment: 5 },
        orders: {
          update: { where: { id: 'o1' }, data: { total: { multiply: 2 } } },
          disconnect: { id: 'o2' },
          create: { id: 'o4', total: 30, status: 'paid' },
        },
      },
      include: { orders: { orderBy: { id: 'asc' } }, _count: true },
    });
    assert.strictEqual(Number(updated.score), 15);
    assert.deepStrictEqual(updated.orders.map((row) => row.id), ['o1', 'o4']);
    assert.deepStrictEqual(updated.orders.map((row) => Number(row.total)), [20, 30]);
    assert.strictEqual(updated._count.orders, 2);

    const disconnected = await db.liveOrder.findUnique({ where: { id: 'o2' }, include: { user: true } });
    assert.strictEqual(disconnected.userId, null);
    assert.strictEqual(disconnected.user, null);

    const aggregate = await db.liveOrder.aggregate({
      where: { userId: { not: null } },
      _count: true,
      _sum: { total: true },
      _avg: { total: true },
    });
    assert.strictEqual(Number(aggregate._count._all), 3);
    assert.strictEqual(Number(aggregate._sum.total), 55);
    assert.ok(Math.abs(Number(aggregate._avg.total) - 18.3333) < 0.01);

    const grouped = await db.liveOrder.groupBy({
      by: 'status',
      _count: true,
      _sum: { total: true },
      orderBy: { status: 'asc' },
    });
    const byStatus = Object.fromEntries(grouped.map((row) => [row.status, { count: Number(row._count._all), sum: Number(row._sum.total) }]));
    assert.deepStrictEqual(byStatus.open, { count: 2, sum: 25 });
    assert.deepStrictEqual(byStatus.paid, { count: 2, sum: 55 });

    await assert.rejects(
      () => db.$transaction(async (tx) => {
        await tx.liveUser.updateMany({ where: { id: 'u1' }, data: { score: { set: 999 } } });
        throw new Error('rollback live orm');
      }),
      /rollback live orm/
    );
    assert.strictEqual(Number((await db.liveUser.findUnique({ where: { id: 'u1' } })).score), 15);

    await db.$transaction(async (tx) => {
      return tx.liveUser.updateMany({ where: { id: 'u1' }, data: { score: { decrement: 2 } } });
    });
    assert.strictEqual(Number((await db.liveUser.findUnique({ where: { id: 'u1' } })).score), 13);

    const vectorRows = await db.liveUser.vectorSearch({ vector: [1, 0, 0], take: 2, vectorField: 'embedding' });
    assert.deepStrictEqual(vectorRows.map((row) => row.id), ['u1', 'u2']);
    assert.ok(vectorRows.every((row) => typeof row.distance === 'number'));

    const migrationWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-orm-migrate-live-'));
    const migrationsDir = path.join(migrationWorkspace, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationWorkspace, 'an5Orm.config.js'), 'module.exports = { schemaDir: "schema" };\n');
    fs.writeFileSync(path.join(migrationsDir, `9999_${migrationTable}.sql`), buildMigrationFile('9999-live', [
      {
        type: 'CREATE_TABLE',
        table: `dbo.${migrationTable}`,
        sql: `CREATE TABLE ${migrationTableSql} (
  [id] INT NOT NULL PRIMARY KEY,
  [name] NVARCHAR(64) NULL
)`,
      },
      {
        type: 'ADD_COLUMN',
        table: `dbo.${migrationTable}`,
        column: 'flag',
        sql: `ALTER TABLE ${migrationTableSql} ADD [flag] BIT NULL`,
      },
    ]));
    fs.writeFileSync(path.join(migrationsDir, `9999_${migrationTableB}.sql`), buildMigrationFile('9999-live-b', [
      {
        type: 'CREATE_TABLE',
        table: `dbo.${migrationTableB}`,
        sql: `CREATE TABLE ${migrationTableBSql} (
  [id] INT NOT NULL PRIMARY KEY
)`,
      },
    ]));

    await setup._executeRaw(`IF OBJECT_ID('dbo.${migrationTable}', 'U') IS NOT NULL DROP TABLE ${migrationTableSql}`);
    await setup._executeRaw(`IF OBJECT_ID('dbo.${migrationTableB}', 'U') IS NOT NULL DROP TABLE ${migrationTableBSql}`);
    runMigrationCli(migrationWorkspace, ['apply', '--dry-run']);
    assert.strictEqual(await tableExists(setup, migrationTable), false);
    runMigrationCli(migrationWorkspace, 'apply');
    assert.strictEqual(await tableExists(setup, migrationTable), true);
    assert.strictEqual(await tableExists(setup, migrationTableB), true);
    runMigrationCli(migrationWorkspace, ['rollback', '--dry-run', '2']);
    assert.strictEqual(await tableExists(setup, migrationTable), true);
    runMigrationCli(migrationWorkspace, ['rollback', '2']);
    assert.strictEqual(await tableExists(setup, migrationTable), false);
    assert.strictEqual(await tableExists(setup, migrationTableB), false);

    const deleted = await db.liveOrder.delete({ where: { id: 'o3' } });
    assert.strictEqual(deleted.id, 'o3');
    assert.deepStrictEqual(await db.liveOrder.deleteMany({ where: { userId: null } }), { count: 1 });

    console.log('an5Orm live DB integration passed');
  } finally {
    if (db) await db.$disconnect().catch(() => {});
    await setup._executeRaw(`IF OBJECT_ID('dbo.${orderTable}', 'U') IS NOT NULL DROP TABLE ${orderTableSql}`).catch(() => {});
    await setup._executeRaw(`IF OBJECT_ID('dbo.${migrationTable}', 'U') IS NOT NULL DROP TABLE ${migrationTableSql}`).catch(() => {});
    await setup._executeRaw(`IF OBJECT_ID('dbo.${migrationTableB}', 'U') IS NOT NULL DROP TABLE ${migrationTableBSql}`).catch(() => {});
    await setup._executeRaw(`IF OBJECT_ID('dbo.${userTable}', 'U') IS NOT NULL DROP TABLE ${userTableSql}`).catch(() => {});
    await setup.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

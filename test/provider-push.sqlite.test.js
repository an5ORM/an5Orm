/**
 * db:push against a real SQLite database.
 *
 * The unit tests in provider-push.test.js pin the SQL each dialect emits; this one
 * runs that SQL, because "looks right" and "SQLite accepts it" are different claims.
 * The schema goes in through `parsePushSchema`, the DDL through the dialect, exactly
 * as push.ts does — only the database connection is better-sqlite3 directly, since
 * the CLI needs a live server.
 *
 * Skipped when better-sqlite3 is not installed, so the suite still runs in a bare
 * checkout.
 *
 * Run: node --test test/provider-push.sqlite.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const distSrc = path.join(__dirname, '..', 'dist', 'generator', 'src');
const { dialectFor } = require(path.join(distSrc, 'dialect.js'));
const { parsePushSchema } = require(path.join(distSrc, 'push-schema.js'));
const { applySchema } = require(path.join(distSrc, 'push-apply.js'));

/** better-sqlite3 ships with the example repo, which is where it is installed. */
function loadSqlite() {
  for (const candidate of [
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', '..', 'an5example', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'),
  ]) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  return null;
}

const SQLite = loadSqlite();
const maybe = SQLite ? test : test.skip;

maybe('VECTOR declarations create BLOB columns in SQLite', async () => {
  const { models, issues } = parsePushSchema('model Document {\n id TEXT @id\n embedding VECTOR(3)\n @@map("documents")\n}', 'sqlite');
  assert.deepEqual(issues, []);
  const db = new SQLite(':memory:');
  try {
    await push(db, models);
    assert.equal(db.prepare("SELECT type FROM pragma_table_info('documents') WHERE name = 'embedding'").get().type, 'BLOB');
  } finally {
    db.close();
  }
});

const SCHEMA = `
model Widget {
  id        INTEGER       @id @default(autoincrement())
  sku       VARCHAR(64)   @unique
  name      VARCHAR(255)?
  weight    REAL          @default(0)
  createdAt DATETIME      @default(now())
  @@map("widgets")
  @@unique([name, weight])
  @@index([createdAt])
}

model Order {
  id        INTEGER     @id @default(autoincrement())
  widgetId  INTEGER
  quantity  INTEGER     @default(1)
  @@schema("")
  @@map("orders")
}
`;

/**
 * Runs the real apply sequence against a SQLite file.
 *
 * `applySchema` is the same function `db:push` calls — only the two database calls
 * and the logging are supplied here, so this exercises the shipped sequence rather
 * than a copy of it.
 */
function push(db, models) {
  const statements = [];
  return applySchema(models, dialectFor('sqlite'), {
    query: async (sql) => {
      statements.push(sql);
      return db.prepare(sql).all();
    },
    execute: async (sql) => {
      statements.push(sql);
      db.exec(sql);
    },
    log: () => {},
  }).then((result) => ({ result, statements }));
}

function openDb() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'an5-push-sqlite-')), 'push.db');
  return { db: new SQLite(file), file };
}

maybe('a schema is created in SQLite and the DDL runs again unchanged', async () => {
  const { models, issues } = parsePushSchema(SCHEMA, 'sqlite');
  assert.deepEqual(issues, []);

  const { db } = openDb();
  const first = (await push(db, models)).statements;

  // The table exists with its columns...
  // `sqlite_sequence` is SQLite's own bookkeeping for AUTOINCREMENT, not ours.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  assert.deepEqual(tables.sort(), ['orders', 'widgets']);

  const columns = db.prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info('widgets')").all();
  assert.deepEqual(columns.map((column) => column.name), ['id', 'sku', 'name', 'weight', 'createdAt']);
  const idColumn = columns.find((column) => column.name === 'id');
  assert.equal(idColumn.type, 'INTEGER');
  assert.equal(idColumn.pk, 1, 'id must be the primary key');
  const nameColumn = columns.find((column) => column.name === 'name');
  assert.equal(nameColumn.notnull, 0, 'a `?` field is nullable');
  const skuColumn = columns.find((column) => column.name === 'sku');
  assert.equal(skuColumn.notnull, 1, 'a required field is NOT NULL');
  const weightColumn = columns.find((column) => column.name === 'weight');
  assert.equal(weightColumn.notnull, 1, 'a defaulted required field is NOT NULL too');

  // ...the auto-increment really increments...
  db.prepare('INSERT INTO widgets (sku, name, weight) VALUES (?, ?, ?)').run('A-1', 'bolt', 1.5);
  db.prepare('INSERT INTO widgets (sku, name, weight) VALUES (?, ?, ?)').run('A-2', 'nut', 2);
  const ids = db.prepare('SELECT id FROM widgets ORDER BY id').all().map((row) => row.id);
  assert.deepEqual(ids, [1, 2]);

  // ...the default fills in...
  const created = db.prepare('SELECT createdAt FROM widgets WHERE id = 1').get();
  assert.ok(String(created.createdAt).length > 0, 'the now() default must apply');

  // ...and the unique index really rejects a duplicate compound pair.
  assert.throws(
    () => db.prepare('INSERT INTO widgets (sku, name, weight) VALUES (?, ?, ?)').run('A-3', 'bolt', 1.5),
    /UNIQUE constraint failed/,
  );

  // A second push must find everything already there and change nothing.
  const secondRun = await push(db, models);
  assert.equal(secondRun.result.tablesCreated, 0);
  assert.equal(secondRun.result.columnsAdded, 0);
  assert.equal(secondRun.result.indexesCreated, 0);
  assert.equal(secondRun.result.uniqueConstraintsAdded, 0);
  assert.ok(
    secondRun.statements.some((sql) => /sqlite_master|pragma_table_info/.test(sql)),
    'the second push still checks the catalog',
  );
  db.close();
});

maybe('a new column is added to an existing SQLite table, unique and all', async () => {
  const { db } = openDb();
  db.exec('CREATE TABLE [widgets] ([id] INTEGER PRIMARY KEY, [sku] VARCHAR(64) NOT NULL)');

  const { models } = parsePushSchema(
    `model Widget {
       id     INTEGER     @id
       sku    VARCHAR(64) @unique
       email  VARCHAR(255) @unique
       colour VARCHAR(32)
       note   TEXT?
     }`,
    'sqlite',
  );

  const { statements } = await push(db, models);

  const added = statements.filter((sql) => /^ALTER TABLE/i.test(sql));
  assert.deepEqual(
    added,
    [
      'ALTER TABLE [widgets] ADD [email] VARCHAR(255) NOT NULL',
      'ALTER TABLE [widgets] ADD [colour] VARCHAR(32) NOT NULL',
      'ALTER TABLE [widgets] ADD [note] TEXT',
    ],
    `unexpected ADD COLUMN statements: ${added.join(' | ')}`,
  );
  // SQLite refuses "Cannot add a UNIQUE column", so the unique becomes an index.
  assert.doesNotMatch(added.join('\n'), /UNIQUE/i);
  assert.ok(
    statements.includes('CREATE UNIQUE INDEX [UQ_widgets_email] ON [widgets] ([email])'),
    `expected a unique index for email: ${statements.join(' | ')}`,
  );

  const columns = db.prepare("SELECT name, \"notnull\" FROM pragma_table_info('widgets')").all();
  assert.deepEqual(columns.map((c) => c.name), ['id', 'sku', 'email', 'colour', 'note']);
  assert.equal(columns.find((c) => c.name === 'email').notnull, 1);
  assert.equal(columns.find((c) => c.name === 'note').notnull, 0);

  // The unique is real: a second row with the same email is refused.
  // `colour` is required and has no default, so every row must carry one.
  db.prepare('INSERT INTO widgets (sku, email, colour) VALUES (?, ?, ?)').run('A-1', 'a@example.com', 'red');
  assert.throws(
    () => db.prepare('INSERT INTO widgets (sku, email, colour) VALUES (?, ?, ?)').run('A-2', 'a@example.com', 'blue'),
    /UNIQUE constraint failed: widgets.email/,
  );

  // And a second push adds nothing.
  const again = await push(db, models);
  assert.equal(again.result.columnsAdded, 0);
  assert.equal(again.result.uniqueConstraintsAdded, 0);
  db.close();
});

maybe('a string key with uuid() is left to the adapter on SQLite', () => {
  const dialect = dialectFor('sqlite');
  const { db } = openDb();
  void dialect;
  db.exec(dialect.createTable('[widgets]', [
    dialect.columnDefinition({ name: 'id', sqlType: 'VARCHAR(1000)', isOptional: false, isId: true, isUnique: false, defaultExpr: 'uuid()' }),
  ]));
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'widgets'").get().sql;
  assert.doesNotMatch(sql, /DEFAULT/, 'SQLite has no default functions; the adapter fills the key in');
  db.prepare('INSERT INTO widgets (id) VALUES (?)').run('generated-by-the-adapter');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM widgets').get().n, 1);
  db.close();
});

maybe('the SQLite autoincrement rules are enforced before any SQL runs', () => {
  const dialect = dialectFor('sqlite');
  const { models } = parsePushSchema(`
    model Bad {
      id   VARCHAR(64) @id @default(autoincrement())
      name VARCHAR(10)
    }
  `, 'sqlite');
  assert.throws(
    () => dialect.columnDefinition(models[0].fields[0]),
    /needs the type INTEGER/,
  );
});

test('the SQLite dialect is the one an SQLite connection string selects', () => {
  const { detectProvider } = require(path.join(distSrc, 'config.js'));
  assert.equal(detectProvider('sqlite://./app.db'), 'sqlite');
  assert.equal(dialectFor(detectProvider('sqlite://./app.db')).provider, 'sqlite');
});

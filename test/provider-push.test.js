/**
 * db:push, per provider.
 *
 * What matters is that each provider gets SQL it understands, and that SQL Server
 * gets exactly what it got before the dialect layer existed — a project already
 * pushed to SQL Server must not see its DDL change underneath it.
 *
 * The two bugs these tests pin down are ones the old single-dialect code had:
 * `ALTER TABLE ... ADD` appended NULL to a *required* column (the inner `else` was
 * unreachable), and `@default(autoincrement())` was emitted as
 * `INT DEFAULT IDENTITY(1,1)`, which SQL Server rejects — identity is a property of
 * the column type, not a default value.
 *
 * Run: node --test test/provider-push.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const distSrc = path.join(__dirname, '..', 'dist', 'generator', 'src');
assert.ok(fs.existsSync(path.join(distSrc, 'dialect.js')), `Expected built dialect at ${distSrc}`);

const { dialectFor, defaultClause } = require(path.join(distSrc, 'dialect.js'));

const column = (over = {}) => ({
  name: 'email',
  sqlType: 'NVARCHAR(255)',
  isId: false,
  isUnique: false,
  isOptional: false,
  ...over,
});

// ─── Quoting ─────────────────────────────────────────────────────────────────

test('identifiers are quoted the way each provider expects', () => {
  assert.equal(dialectFor('mssql').quote('email'), '[email]');
  assert.equal(dialectFor('sqlite').quote('email'), '[email]');
  assert.equal(dialectFor('postgres').quote('email'), '"email"');
  assert.equal(dialectFor('mysql').quote('email'), '`email`');
  // An embedded quote is doubled, not dropped.
  assert.equal(dialectFor('mssql').quote('we]ird'), '[we]]ird]');
  assert.equal(dialectFor('postgres').quote('we"ird'), '"we""ird"');
  assert.equal(dialectFor('mysql').quote('we`ird'), '`we``ird`');
  // Already-quoted input is not double-quoted.
  assert.equal(dialectFor('mssql').quote('[email]'), '[email]');
  assert.equal(dialectFor('postgres').quote('"email"'), '"email"');
});

test('a schema-qualified table keeps its prefix, an empty one drops it', () => {
  assert.equal(dialectFor('mssql').quoteTable('dbo.widgets'), '[dbo].[widgets]');
  assert.equal(dialectFor('postgres').quoteTable('main.widgets'), '"main"."widgets"');
  assert.equal(dialectFor('mysql').quoteTable('app.widgets'), '`app`.`widgets`');
  // `@@schema("")` for a database with no schemas.
  assert.equal(dialectFor('sqlite').quoteTable('widgets'), '[widgets]');
});

// ─── Existence checks ───────────────────────────────────────────────────────

test('each provider asks its own catalog whether the table exists', () => {
  assert.equal(
    dialectFor('mssql').tableExists('dbo.widgets'),
    "SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('dbo.widgets')",
  );
  // An unqualified PostgreSQL name is looked for in current_schema(): search_path
  // decides where CREATE puts it, and that is usually not `public`.
  assert.equal(
    dialectFor('postgres').tableExists('widgets'),
    "SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'widgets'",
  );
  assert.equal(
    dialectFor('postgres').tableExists('main.widgets'),
    "SELECT tablename FROM pg_tables WHERE schemaname = 'main' AND tablename = 'widgets'",
  );
  assert.equal(
    dialectFor('mysql').tableExists('widgets'),
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'widgets'",
  );
  assert.equal(
    dialectFor('sqlite').tableExists('widgets'),
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'widgets'",
  );
});

test('column and index lookups use the provider catalog', () => {
  assert.equal(
    dialectFor('mssql').columnExists('dbo.widgets', 'email'),
    "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.widgets') AND name = 'email'",
  );
  assert.match(dialectFor('postgres').columnExists('widgets', 'email'), /information_schema\.columns/);
  assert.match(dialectFor('mysql').columnExists('widgets', 'email'), /information_schema\.columns/);
  assert.equal(
    dialectFor('sqlite').columnExists('widgets', 'email'),
    "SELECT name FROM pragma_table_info('widgets') WHERE name = 'email'",
  );

  assert.match(dialectFor('mssql').indexExists('dbo.widgets', 'IX_w_email'), /sys\.indexes/);
  assert.match(dialectFor('postgres').indexExists('widgets', 'IX_w_email'), /pg_indexes/);
  assert.match(dialectFor('mysql').indexExists('widgets', 'IX_w_email'), /information_schema\.statistics/);
  assert.match(dialectFor('sqlite').indexExists('widgets', 'IX_w_email'), /sqlite_master/);

  assert.match(dialectFor('mssql').uniqueConstraintExists('dbo.widgets', 'UQ_w'), /type = 'UQ'/);
  assert.match(dialectFor('postgres').uniqueConstraintExists('widgets', 'UQ_w'), /pg_constraint/);
  assert.match(dialectFor('mysql').uniqueConstraintExists('widgets', 'UQ_w'), /table_constraints/);
  // SQLite has no named constraints, so the index catalog answers instead.
  assert.equal(dialectFor('sqlite').supportsNamedUniqueConstraint, false);
  assert.equal(
    dialectFor('sqlite').uniqueConstraintExists('widgets', 'UQ_w'),
    dialectFor('sqlite').indexExists('widgets', 'UQ_w'),
  );
});

test('an apostrophe in a name cannot break out of the literal', () => {
  assert.equal(
    dialectFor('sqlite').tableExists("o'brien"),
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'o''brien'",
  );
  assert.equal(
    dialectFor('mssql').columnExists('dbo.widgets', "o'brien"),
    "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.widgets') AND name = 'o''brien'",
  );
});

// ─── Column definitions: SQL Server must not change ─────────────────────────

test('SQL Server column definitions are what db:push already produced', () => {
  const mssql = dialectFor('mssql');
  assert.equal(mssql.columnDefinition(column()), '[email] NVARCHAR(255) NOT NULL');
  assert.equal(
    mssql.columnDefinition(column({ isId: true })),
    '[email] NVARCHAR(255) PRIMARY KEY',
  );
  assert.equal(
    mssql.columnDefinition(column({ isUnique: true })),
    '[email] NVARCHAR(255) NOT NULL UNIQUE',
  );
  assert.equal(
    mssql.columnDefinition(column({ isOptional: true })),
    '[email] NVARCHAR(255)',
  );
  // A default does not imply NOT NULL: the old code skipped the keyword whenever a
  // default was present, so `createdAt DATETIME2 @default(now())` created a
  // *nullable* column and a row could still leave it empty.
  assert.equal(
    mssql.columnDefinition(column({ defaultExpr: 'now()' })),
    '[email] NVARCHAR(255) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  );
  assert.equal(mssql.addColumn('[dbo].[widgets]', column()), 'ALTER TABLE [dbo].[widgets] ADD [email] NVARCHAR(255) NOT NULL');
});

test('a required column is NOT NULL when added, which it was not before', () => {
  // The old code appended NULL to a required column: the branch meant to emit
  // NOT NULL sat behind `else` of a condition that was already known.
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite']) {
    assert.match(
      dialectFor(provider).addColumn(dialectFor(provider).quoteTable('widgets'), column()),
      / NOT NULL$/,
      `${provider} should add a required column as NOT NULL`,
    );
  }
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite']) {
    assert.doesNotMatch(
      dialectFor(provider).addColumn(dialectFor(provider).quoteTable('widgets'), column()),
      /(?<!NOT) NULL$/,
      `${provider} must not end an ADD COLUMN with a bare NULL`,
    );
  }
  assert.doesNotMatch(
    dialectFor('sqlite').addColumn('[widgets]', column({ isOptional: true })),
    /NOT NULL/,
    'an optional column stays nullable',
  );
});

test('autoincrement is an identity on the column type, not a default value', () => {
  // `INT DEFAULT IDENTITY(1,1)` is not valid T-SQL.
  assert.equal(
    dialectFor('mssql').columnDefinition(column({ name: 'id', sqlType: 'INT', isId: true, defaultExpr: 'autoincrement()' })),
    '[id] INT IDENTITY(1,1) PRIMARY KEY',
  );
  assert.equal(defaultClause('autoincrement()', 'mssql'), '');
  assert.equal(
    dialectFor('postgres').columnDefinition(column({ name: 'id', sqlType: 'INTEGER', isId: true, defaultExpr: 'autoincrement()' })),
    '"id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
  );
  // No NOT NULL: a primary key is already NOT NULL, and spelling it out is noise.
  assert.match(
    dialectFor('mysql').columnDefinition(column({ name: 'id', sqlType: 'INT', isId: true, defaultExpr: 'autoincrement()' })),
    /^`id` INT AUTO_INCREMENT PRIMARY KEY$/,
  );
  assert.equal(
    dialectFor('sqlite').columnDefinition(column({ name: 'id', sqlType: 'INTEGER', isId: true, defaultExpr: 'autoincrement()' })),
    '[id] INTEGER PRIMARY KEY AUTOINCREMENT',
  );
});

test('SQLite refuses an auto-increment it cannot do', () => {
  const sqlite = dialectFor('sqlite');
  assert.throws(
    () => sqlite.columnDefinition(column({ name: 'id', sqlType: 'BIGINT', isId: true, defaultExpr: 'autoincrement()' })),
    /needs the type INTEGER/,
  );
  assert.throws(
    () => sqlite.columnDefinition(column({ name: 'id', sqlType: 'INTEGER', defaultExpr: 'autoincrement()' })),
    /needs @id/,
  );
});

// ─── Defaults ────────────────────────────────────────────────────────────────

test('uuid() becomes the provider default function, or nothing where there is none', () => {
  assert.equal(defaultClause('uuid()', 'mssql'), 'DEFAULT NEWID()');
  assert.equal(defaultClause('cuid()', 'mssql'), 'DEFAULT NEWID()');
  assert.equal(defaultClause('uuid()', 'postgres'), 'DEFAULT gen_random_uuid()');
  assert.equal(defaultClause('uuid()', 'mysql'), 'DEFAULT (UUID())');
  // SQLite has no default functions; the adapter fills a string key in instead.
  assert.equal(defaultClause('uuid()', 'sqlite'), '');
  assert.equal(dialectFor('sqlite').columnDefinition(column({ isId: true, defaultExpr: 'uuid()' })), '[email] NVARCHAR(255) PRIMARY KEY');
});

test('now(), booleans and literals are carried over', () => {
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite']) {
    assert.equal(defaultClause('now()', provider), 'DEFAULT CURRENT_TIMESTAMP', provider);
    assert.equal(defaultClause('true', provider), provider === 'postgres' ? 'DEFAULT TRUE' : 'DEFAULT 1', provider);
    assert.equal(defaultClause('false', provider), provider === 'postgres' ? 'DEFAULT FALSE' : 'DEFAULT 0', provider);
    assert.equal(defaultClause('"draft"', provider), "DEFAULT 'draft'", provider);
  }
  assert.equal(defaultClause(undefined, 'mssql'), '');
  assert.equal(defaultClause('', 'mssql'), '');
});

// ─── Statements ──────────────────────────────────────────────────────────────

test('CREATE TABLE and CREATE INDEX keep their shape across providers', () => {
  const postgres = dialectFor('postgres');
  assert.equal(
    postgres.createTable('"widgets"', ['"id" INTEGER PRIMARY KEY', '"email" VARCHAR(255) NOT NULL UNIQUE']),
    'CREATE TABLE "widgets" (\n  "id" INTEGER PRIMARY KEY,\n  "email" VARCHAR(255) NOT NULL UNIQUE\n)',
  );
  assert.equal(postgres.createIndex('"IX_w_email"', '"widgets"', ['"email"']), 'CREATE INDEX "IX_w_email" ON "widgets" ("email")');
  assert.equal(postgres.addUniqueConstraint('"UQ_w"', '"widgets"', ['"a"', '"b"']), 'ALTER TABLE "widgets" ADD CONSTRAINT "UQ_w" UNIQUE ("a", "b")');

  const mysql = dialectFor('mysql');
  assert.equal(mysql.createIndex('`IX_w_email`', '`widgets`', ['`email`']), 'CREATE INDEX `IX_w_email` ON `widgets` (`email`)');
  assert.equal(mysql.createUniqueIndex('`UQ_w`', '`widgets`', ['`a`']), 'CREATE UNIQUE INDEX `UQ_w` ON `widgets` (`a`)');

  const sqlite = dialectFor('sqlite');
  assert.equal(sqlite.createUniqueIndex('[UQ_w]', '[widgets]', ['[a]', '[b]']), 'CREATE UNIQUE INDEX [UQ_w] ON [widgets] ([a], [b])');
});

// ─── Google Sheets ───────────────────────────────────────────────────────────

test('Google Sheets refuses DDL instead of sending SQL it cannot run', () => {
  const sheets = dialectFor('googlesheets');
  assert.equal(sheets.supportsDdl, false);
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite']) {
    assert.equal(dialectFor(provider).supportsDdl, true, provider);
  }
});

// ─── Every provider answers everything push asks of it ───────────────────────

test('every provider implements the whole dialect surface', () => {
  const asked = [
    'quote', 'quoteTable', 'tableExists', 'columnExists', 'uniqueConstraintExists',
    'indexExists', 'columnDefinition', 'createTable', 'createIndex',
    'createUniqueIndex', 'addColumn', 'addUniqueConstraint',
  ];
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite', 'googlesheets']) {
    const dialect = dialectFor(provider);
    for (const name of asked) {
      assert.equal(typeof dialect[name], 'function', `${provider} is missing ${name}`);
    }
  }
});

// ─── Regressions found while reviewing the dialect layer ─────────────────────

test('an unqualified PostgreSQL table is looked for where CREATE puts it', () => {
  // search_path = "$user", public by default, so an unqualified CREATE lands in the
  // role's schema. Looking only in `public` meant the table was never found and
  // every push re-issued CREATE TABLE, failing with "relation already exists".
  const postgres = dialectFor('postgres');
  assert.match(postgres.tableExists('widgets'), /schemaname = current_schema\(\)/);
  assert.equal(postgres.quoteTable('widgets'), '"widgets"');
  assert.match(postgres.columnExists('widgets', 'email'), /table_schema = current_schema\(\)/);
  assert.match(postgres.indexExists('widgets', 'IX_w_email'), /schemaname = current_schema\(\)/);
  assert.match(postgres.uniqueConstraintExists('widgets', 'UQ_w'), /nspname = current_schema\(\)/);
  // An explicit schema is still honoured.
  assert.match(postgres.tableExists('main.widgets'), /schemaname = 'main'/);
});

test('an unqualified MySQL table is looked for in the connected database', () => {
  const mysql = dialectFor('mysql');
  assert.match(mysql.tableExists('widgets'), /table_schema = DATABASE\(\)/);
  assert.match(mysql.tableExists('app.widgets'), /table_schema = 'app'/);
});

test('the SQLite autoincrement check looks at the whole type, not its base', () => {
  // `INTEGER(8)` has the base name INTEGER but is not an INTEGER PRIMARY KEY to
  // SQLite; letting it through only moved the message to the driver.
  assert.throws(
    () => dialectFor('sqlite').columnDefinition(column({ name: 'id', sqlType: 'INTEGER(8)', isId: true, defaultExpr: 'autoincrement()' })),
    /needs the type INTEGER/,
  );
});

test('SQLite drops UNIQUE from ADD COLUMN, because it cannot add one', () => {
  // Verified against SQLite: "Cannot add a UNIQUE column". The unique is added as a
  // separate index by the caller instead of being lost.
  assert.equal(dialectFor('sqlite').supportsUniqueInlineOnAddColumn, false);
  const added = dialectFor('sqlite').addColumn('[widgets]', column({ isUnique: true }));
  assert.equal(added, 'ALTER TABLE [widgets] ADD [email] NVARCHAR(255) NOT NULL');
  for (const provider of ['mssql', 'postgres', 'mysql']) {
    assert.equal(dialectFor(provider).supportsUniqueInlineOnAddColumn, true, provider);
    assert.match(dialectFor(provider).addColumn(dialectFor(provider).quoteTable('widgets'), column({ isUnique: true })), /UNIQUE$/, provider);
  }
});

test('a PostgreSQL TIMETZ spelled out is a type it has', () => {
  const { resolveFieldType } = require(path.join(distSrc, 'field-types.js'));
  assert.equal(resolveFieldType('TIME WITH TIME ZONE', 'postgres').ts, 'Date');
  assert.equal(resolveFieldType('TIME WITHOUT TIME ZONE', 'postgres').ts, 'Date');
});

test('the default schema is never forced, on any provider', () => {
  // Forcing `dbo` made SQL Server push miss the table it had created itself, and made
  // SQLite fail with "unknown database [dbo]".
  const { defaultSchemaFor, qualifiedTableName, parsePushSchema } = require(path.join(distSrc, 'push-schema.js'));
  for (const provider of ['mssql', 'postgres', 'mysql', 'sqlite']) {
    assert.equal(defaultSchemaFor(provider), '', provider);
  }
  const { models } = parsePushSchema('model Widget {\n  id VARCHAR(8) @id\n}', 'sqlite');
  assert.equal(qualifiedTableName(models[0]), 'widgets');
  assert.equal(models[0].declaredSchema, undefined);
  // An explicit schema is still used, and a `dbo` one is reported where it cannot work.
  const explicit = parsePushSchema('model Widget {\n  @@schema("main")\n  id VARCHAR(8) @id\n}', 'postgres');
  assert.equal(qualifiedTableName(explicit.models[0]), 'main.widgets');
  const wrong = parsePushSchema('model Widget {\n  @@schema("dbo")\n  id VARCHAR(8) @id\n}', 'sqlite');
  assert.match(wrong.issues[0].message, /schema "dbo" does not exist/);
});

test('a mapped @@unique or @@index is not silently dropped', () => {
  const { parsePushSchema } = require(path.join(distSrc, 'push-schema.js'));
  const { models, issues } = parsePushSchema(
    `model Widget {
       id       VARCHAR(8)  @id
       tenantId VARCHAR(8)
       email    VARCHAR(255)
       age      INT
       @@unique([tenantId, email], map: "UQ_widgets")
       @@index([age], filter: "age > 0")
     }`,
    'mssql',
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(models[0].compoundUniques.map((d) => d.fields), [['tenantId', 'email']]);
  assert.deepEqual(models[0].indexes.map((d) => d.fields), [['age']]);
});

test('db:push and db:migrate name an artifact the same way', () => {
  // If the two invented different names for the same directive, push would create
  // one constraint and the next migration would keep trying to add the other.
  const { parsePushSchema, directiveName } = require(path.join(distSrc, 'push-schema.js'));
  const { parseSchemaText } = require(path.join(__dirname, '..', 'dist', 'migration-core.js'));
  const schema = `model Widget {
     id       VARCHAR(8)  @id
     tenantId VARCHAR(8)
     email    VARCHAR(255)
     age      INT
     @@unique([tenantId, email], map: "UQ_widgets_tenant_email")
     @@index([age], map: "IX_widgets_age")
     @@index([tenantId])
   }`;

  const push = parsePushSchema(schema, 'mssql').models[0];
  const migrate = parseSchemaText(schema, 'mssql')[0];

  assert.deepEqual(
    push.compoundUniques.map((d, i) => directiveName(d, 'widgets', 'compound', i)),
    migrate.compoundUniques.map((c) => c.name),
  );
  // The unnamed index gets the derived name in both, so push's artifact is the one
  // the diff recognises as managed.
  assert.deepEqual(
    push.indexes.map((d, i) => directiveName(d, 'widgets', 'index', i)),
    ['IX_widgets_age', 'IX_widgets_tenantId'],
  );
  assert.equal(migrate.indexes[1].name, undefined, 'unnamed in the schema, derived by both');
});

test('SQL Server push still looks for an unqualified table, as before', () => {
  assert.equal(
    dialectFor('mssql').tableExists('widgets'),
    "SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('widgets')",
  );
  assert.equal(dialectFor('mssql').quoteTable('widgets'), '[widgets]');
});

test('a connection string is read the same way whatever its case', () => {
  const { detectProvider } = require(path.join(distSrc, 'config.js'));
  assert.equal(detectProvider('MySQL://root@localhost/db'), 'mysql');
  assert.equal(detectProvider('SQLITE://./app.db'), 'sqlite');
  assert.equal(detectProvider('./data/app.sqlite3'), 'sqlite');
  assert.equal(dialectFor(detectProvider('./data/app.sqlite3')).provider, 'sqlite');
});

test('no provider emits T-SQL syntax it does not own', () => {
  for (const provider of ['postgres', 'mysql', 'sqlite']) {
    const sql = [
      dialectFor(provider).tableExists('widgets'),
      dialectFor(provider).columnExists('widgets', 'email'),
      dialectFor(provider).indexExists('widgets', 'IX_w_email'),
      dialectFor(provider).createTable(dialectFor(provider).quoteTable('widgets'), ['c INTEGER']),
      dialectFor(provider).addColumn(dialectFor(provider).quoteTable('widgets'), column()),
    ].join('\n');
    assert.doesNotMatch(sql, /sys\.|OBJECT_ID|NOLOCK|IDENTITY\(1,1\)|TOP \(/i, provider);
  }
});
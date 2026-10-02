/**
 * Field type validation, per database provider.
 *
 * The behaviour worth protecting is that the valid field types are a property of
 * the provider, not one shared list. Before, a single table covered every
 * database: SQLite-only types such as `INTEGER` were generated into the client
 * and then dropped silently by db:push, while `SERIAL` or `JSONB` passed
 * validation and only failed at DDL time.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// The generator builds to dist/, which the test suite produces first.
const distSrc = path.join(__dirname, '..', 'dist', 'generator', 'src');
assert.ok(fs.existsSync(path.join(distSrc, 'field-types.js')), `Expected built field-types at ${distSrc}`);

const {
  PROVIDERS,
  PROVIDER_FIELD_TYPES,
  DEFAULT_PROVIDER,
  FieldTypeError,
  fieldTypesFor,
  readFieldLineHead,
  resolveFieldType,
  splitTypeParams,
  unknownFieldTypeMessage,
} = require(path.join(distSrc, 'field-types.js'));
const { SchemaParser, sqlTypeToTs } = require(path.join(distSrc, 'parser.js'));
const { detectProvider, providerFromConfig, providerForProject } = require(path.join(distSrc, 'config.js'));
const { parseSchemaText } = require(path.join(__dirname, '..', 'dist', 'migration-core.js'));
const { SQL_SERVER_ONLY_COMMANDS } = require(path.join(__dirname, '..', 'dist', 'provider-support.js'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-field-types-'));
let dirCounter = 0;

function writeSchema(body) {
  const dir = path.join(tmpRoot, String(dirCounter++));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schema.an5'), body, 'utf8');
  return dir;
}

function parse(body, provider) {
  return new SchemaParser(writeSchema(body), provider).parse();
}

// VARCHAR is the one string type every SQL provider here accepts, so the id
// column never makes the test about the provider rather than the field under test.
function schemaWithField(line) {
  return `model Widget {\n  id   VARCHAR(64) @id\n  ${line}\n}\n`;
}

// ─── The tables themselves ───────────────────────────────────────────────────

test('every provider has its own type table', () => {
  assert.deepEqual([...PROVIDERS], ['mssql', 'postgres', 'mysql', 'sqlite', 'googlesheets']);
  for (const provider of PROVIDERS) {
    const types = fieldTypesFor(provider);
    assert.ok(Object.keys(types).length > 0, `${provider} must have types`);
  }
});

test('the default provider is SQL Server, the only one push/pull/migrate support', () => {
  assert.equal(DEFAULT_PROVIDER, 'mssql');
});

test('type names are upper case so a lookup cannot miss on capitalisation', () => {
  for (const provider of PROVIDERS) {
    for (const name of Object.keys(PROVIDER_FIELD_TYPES[provider])) {
      assert.equal(name, name.toUpperCase(), `${provider} has non upper-case type "${name}"`);
    }
  }
});

// ─── The same type is not valid everywhere ───────────────────────────────────

test('INTEGER is a SQLite type and is rejected for SQL Server', async () => {
  await assert.doesNotReject(parse(schemaWithField('position INTEGER'), 'sqlite'));
  await assert.rejects(parse(schemaWithField('position INTEGER'), 'mssql'), (err) => {
    assert.ok(err instanceof FieldTypeError);
    assert.equal(err.provider, 'mssql');
    assert.deepEqual(err.issues.map((issue) => issue.path), ['Widget.position']);
    assert.match(err.issues[0].message, /unknown type "INTEGER" for SQL Server/);
    return true;
  });
});

test('BOOLEAN, BOOL and BLOB belong to SQLite, not to SQL Server', () => {
  for (const type of ['BOOLEAN', 'BOOL', 'BLOB']) {
    assert.equal(resolveFieldType(type, 'sqlite') !== null, true, `${type} should be a SQLite type`);
    assert.equal(resolveFieldType(type, 'mssql'), null, `${type} should not be a SQL Server type`);
  }
});

test('NVARCHAR and UNIQUEIDENTIFIER belong to SQL Server, not to SQLite', () => {
  for (const type of ['MONEY', 'UNIQUEIDENTIFIER', 'SQL_VARIANT', 'SMALLDATETIME']) {
    assert.ok(resolveFieldType(type, 'mssql'), `${type} should be a SQL Server type`);
    assert.equal(resolveFieldType(type, 'sqlite'), null, `${type} should not be a SQLite type`);
  }
});

test('SQLite accepts VARCHAR/NVARCHAR because it never enforces the name', () => {
  // SQLite derives an affinity from the declared name and stores anything, so
  // VARCHAR/NVARCHAR are accepted even though they mean nothing to the engine.
  assert.equal(resolveFieldType('VARCHAR(255)', 'sqlite').ts, 'string');
  assert.equal(resolveFieldType('NVARCHAR(255)', 'sqlite').ts, 'string');
});

test('PostgreSQL-only types are rejected elsewhere', () => {
  for (const type of ['SMALLSERIAL', 'BIGSERIAL', 'JSONB', 'BYTEA', 'TIMESTAMPTZ', 'INT4']) {
    assert.ok(resolveFieldType(type, 'postgres'), `${type} should be a PostgreSQL type`);
    assert.equal(resolveFieldType(type, 'mssql'), null);
    assert.equal(resolveFieldType(type, 'sqlite'), null);
  }
});

test('SERIAL is valid on PostgreSQL and MySQL, which both alias it', () => {
  assert.ok(resolveFieldType('SERIAL', 'postgres'));
  assert.ok(resolveFieldType('SERIAL', 'mysql'));
  assert.equal(resolveFieldType('SERIAL', 'mssql'), null);
});

test('INT is valid on SQL Server and MySQL but not on PostgreSQL', () => {
  // PostgreSQL spells it INTEGER or INT4; `INT` fails at DDL time.
  assert.ok(resolveFieldType('INT', 'mssql'));
  assert.ok(resolveFieldType('INT', 'mysql'));
  assert.equal(resolveFieldType('INT', 'postgres'), null);
  assert.ok(resolveFieldType('INTEGER', 'postgres'));
});

test('UUID is a PostgreSQL and SQLite type, but MySQL has none', () => {
  assert.ok(resolveFieldType('UUID', 'postgres'));
  assert.ok(resolveFieldType('UUID', 'sqlite'));
  assert.equal(resolveFieldType('UUID', 'mysql'), null);
});

test('a model named after a type still parses as a column', () => {
  // PostgreSQL's `USER`/`NAME` types are left out of the table on purpose, so
  // this is a column rather than a relation to a model called USER.
  assert.equal(resolveFieldType('USER', 'postgres'), null);
  const resolved = resolveFieldType('TEXT', 'postgres');
  assert.equal(resolved.ts, 'string');
});

// ─── Multi-word types ────────────────────────────────────────────────────────

test('a multi-word type is not truncated to its first word', () => {
  assert.deepEqual(splitTypeParams('DOUBLE PRECISION'), { base: 'DOUBLE PRECISION', params: '' });
  assert.equal(resolveFieldType('DOUBLE PRECISION', 'postgres').ts, 'number');
  assert.equal(resolveFieldType('TIMESTAMP WITH TIME ZONE', 'postgres').ts, 'Date');
});

test('every token before @attribute belongs to the type', () => {
  const head = readFieldLineHead('amount DOUBLE PRECISION @description("Total")');
  assert.equal(head.type, 'DOUBLE PRECISION');
  assert.equal(head.name, 'amount');
});

test('a multi-word type parses as a column, not as a relation', async () => {
  const models = await parse(schemaWithField('amount DOUBLE PRECISION'), 'postgres');
  const widget = models.find((model) => model.name === 'Widget');
  assert.equal(widget.fields.find((f) => f.name === 'amount').type, 'number');
  assert.equal(widget.relations.length, 0);
});

test('array and nullable suffixes are stripped before the lookup', () => {
  const head = readFieldLineHead('payload BLOB?');
  assert.equal(head.type, 'BLOB');
  assert.equal(head.isOptional, true);
  assert.equal(head.isArray, false);
});

// ─── Relations vs unknown types ──────────────────────────────────────────────

test('a token naming a model in the schema is a relation, not an error', async () => {
  const body = `model User {\n  id NVARCHAR(64) @id\n}\n\nmodel Post {\n  id       NVARCHAR(64) @id\n  authorId NVARCHAR(64)\n  author   User @relation(fields: [authorId], references: [id])\n}\n`;
  const models = await parse(body, 'mssql');
  const post = models.find((model) => model.name === 'Post');
  assert.equal(post.relations.length, 1);
  assert.equal(post.relations[0].type, 'User');
  assert.equal(post.relations[0].foreignKey, 'authorId');
  assert.equal(post.relations[0].localKey, 'id');
});

test('a forward reference to a later model is still a relation', async () => {
  const body = `model Post {\n  id       NVARCHAR(64) @id\n  authorId NVARCHAR(64)\n  author   User @relation(fields: [authorId], references: [id])\n}\n\nmodel User {\n  id NVARCHAR(64) @id\n}\n`;
  const models = await parse(body, 'mssql');
  assert.equal(models.find((model) => model.name === 'Post').relations[0].type, 'User');
});

test('an upper-case token that is neither a type nor a model is an error', async () => {
  await assert.rejects(parse(schemaWithField('score STRINGY(10)'), 'mssql'), (err) => {
    assert.ok(err instanceof FieldTypeError);
    assert.match(err.issues[0].message, /unknown type "STRINGY\(10\)" for SQL Server/);
    return true;
  });
});

test('a mistyped model name is reported instead of becoming a dangling relation', async () => {
  const body = `model User {\n  id NVARCHAR(64) @id\n}\n\nmodel Post {\n  id     NVARCHAR(64) @id\n  author Users @relation(fields: [id], references: [id])\n}\n`;
  await assert.rejects(parse(body, 'mssql'), (err) => {
    assert.match(err.issues[0].message, /no model named "Users"/);
    assert.match(err.issues[0].message, /did you mean the model "User"/);
    return true;
  });
});

// ─── All bad fields are reported at once ─────────────────────────────────────

test('every bad field type is reported in one pass', async () => {
  const body = `model Widget {\n  id       NVARCHAR(64) @id\n  position INTEGER\n  weight   SERIAL\n  label    STRINGY(10)\n}\n`;
  await assert.rejects(parse(body, 'mssql'), (err) => {
    assert.ok(err instanceof FieldTypeError);
    assert.equal(err.message, 'Invalid field types for SQL Server');
    assert.deepEqual(err.issues.map((issue) => issue.path), [
      'Widget.position',
      'Widget.weight',
      'Widget.label',
    ]);
    return true;
  });
});

test('the message names the provider and suggests the nearest valid type', () => {
  assert.match(unknownFieldTypeMessage('NVARCHAR2(10)', 'postgres'), /unknown type "NVARCHAR2\(10\)" for PostgreSQL; did you mean "VARCHAR"\?/);
  // No type is close, so the message falls back to the model names it knows.
  assert.match(
    unknownFieldTypeMessage('Zzz', 'sqlite', ['User', 'Post']),
    /unknown type "Zzz" for SQLite, and no model named "Zzz" in this schema/,
  );
});

// ─── Generated TypeScript types follow the provider ──────────────────────────

test('the same schema text maps to different types per provider', () => {
  assert.equal(sqlTypeToTs('VARCHAR(10)'), 'string');
  assert.equal(sqlTypeToTs('INTEGER', 'sqlite'), 'number');
  assert.equal(sqlTypeToTs('INT', 'mssql'), 'number');
  assert.equal(sqlTypeToTs('BOOLEAN', 'sqlite'), 'boolean');
  assert.equal(sqlTypeToTs('BIT', 'mssql'), 'boolean');
  assert.equal(sqlTypeToTs('BIT', 'mysql'), 'number');
  assert.equal(sqlTypeToTs('SERIAL', 'postgres'), 'number');
  assert.equal(sqlTypeToTs('BYTEA', 'postgres'), 'Buffer');
  assert.equal(sqlTypeToTs('TIMESTAMP', 'mssql'), 'Buffer');
  assert.equal(sqlTypeToTs('TIMESTAMP', 'postgres'), 'Date');
  assert.equal(sqlTypeToTs('JSONB', 'postgres'), 'any');
});

test('sqlTypeToTs still answers for a type the provider does not have', () => {
  // Kept for callers outside generation; validation is what should stop a bad
  // type from reaching the database.
  assert.equal(sqlTypeToTs('JSONB', 'mssql'), 'any');
});

test('a field keeps the sqlType written in the schema', async () => {
  const models = await parse(schemaWithField('label nvarchar(255)'), 'mssql');
  assert.equal(models[0].fields.find((f) => f.name === 'label').sqlType, 'nvarchar(255)');
});

// ─── Provider detection ──────────────────────────────────────────────────────

test('the provider is read from the connection string scheme', () => {
  assert.equal(detectProvider('sqlserver://localhost:1433;database=db'), 'mssql');
  assert.equal(detectProvider('mssql://localhost:1433'), 'mssql');
  assert.equal(detectProvider('postgres://user:pw@localhost:5432/db'), 'postgres');
  assert.equal(detectProvider('postgresql://localhost/db'), 'postgres');
  assert.equal(detectProvider('mysql://root@localhost:3306/db'), 'mysql');
  assert.equal(detectProvider('mariadb://root@localhost/db'), 'mysql');
  assert.equal(detectProvider('sqlite://./local.db'), 'sqlite');
  assert.equal(detectProvider('./data/app.sqlite'), 'sqlite');
  assert.equal(detectProvider('googlesheets://sheet-id'), 'googlesheets');
});

test('an unknown or missing connection string means SQL Server', () => {
  assert.equal(detectProvider(undefined), 'mssql');
  assert.equal(detectProvider(''), 'mssql');
  assert.equal(detectProvider('Server=localhost;Database=db'), 'mssql');
});

test('DATABASE_URL wins over the connection string in the config', () => {
  const config = { connectionString: 'sqlserver://localhost' };
  assert.equal(providerFromConfig(config, {}), 'mssql');
  assert.equal(providerFromConfig(config, { DATABASE_URL: 'postgres://localhost/db' }), 'postgres');
  // An empty DATABASE_URL must not shadow the config file.
  assert.equal(providerFromConfig(config, { DATABASE_URL: '' }), 'mssql');
});

// ─── providerForProject, for the tools that read schemas from outside ─────────

test('providerForProject reads the provider from the project config', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-project-'));
  fs.writeFileSync(
    path.join(project, 'an5Orm.config.js'),
    "module.exports = { schemaDir: 'schema', connectionString: 'postgres://localhost:5432/db' };\n",
  );
  assert.equal(providerForProject(project, {}), 'postgres');
  // DATABASE_URL still wins, exactly as for the generator.
  assert.equal(providerForProject(project, { DATABASE_URL: 'mysql://localhost/db' }), 'mysql');
});

test('providerForProject works from a relative directory too', () => {
  // `require` reads a bare specifier as a package name, so the loader has to
  // resolve the path itself or a relative `cwd` silently loses the config.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-relative-'));
  fs.writeFileSync(
    path.join(project, 'an5Orm.config.js'),
    "module.exports = { schemaDir: 'schema', connectionString: 'sqlite://./local.db' };\n",
  );
  const relative = path.relative(process.cwd(), project);
  assert.ok(!path.isAbsolute(relative));
  assert.equal(providerForProject(relative, {}), 'sqlite');
});

test('providerForProject falls back to SQL Server instead of throwing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-empty-'));
  assert.equal(providerForProject(empty, {}), 'mssql');

  // A config that fails to validate must not take the caller down with it: the
  // agent and the extension call this on every schema read.
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-broken-'));
  fs.writeFileSync(path.join(broken, 'an5Orm.config.js'), 'module.exports = { outputs: 5 };\n');
  assert.equal(providerForProject(broken, {}), 'mssql');
});

// ─── db:pull output has to survive the validator ─────────────────────────────

test('the types db:pull writes are valid for SQL Server', () => {
  // db:pull copies the name straight from sys.types, so a type the validator
  // rejects would make a pulled schema impossible to generate from again.
  const pulled = `
    model Catalog {
      id         SYSNAME            @id
      code       NVARCHAR(50)
      big        NVARCHAR(MAX)
      money      DECIMAL(18, 2)
      created    DATETIMEOFFSET
      revision   TIMESTAMP
      payload    VARBINARY(MAX)
      unknown    SQL_VARIANT
    }
  `;
  const models = parseSchemaText(pulled, 'mssql');
  assert.deepStrictEqual(
    models[0].fields.map((field) => field.sqlType),
    ['SYSNAME', 'NVARCHAR(50)', 'NVARCHAR(MAX)', 'DECIMAL(18, 2)', 'DATETIMEOFFSET', 'TIMESTAMP', 'VARBINARY(MAX)', 'SQL_VARIANT'],
  );
});

// ─── parseSchemaText, the path db:migrate uses ───────────────────────────────

test('parseSchemaText validates against the provider it is given', () => {
  const schema = `model Widget {\n  id       VARCHAR(64) @id\n  position INTEGER\n}\n`;
  assert.deepStrictEqual(parseSchemaText(schema, 'sqlite')[0].fields.map((f) => f.name), ['id', 'position']);
  assert.throws(() => parseSchemaText(schema, 'mssql'), FieldTypeError);
});

test('parseSchemaText still accepts a relation and defaults to SQL Server', () => {
  const schema = `
    model User {\n  id VARCHAR(64) @id\n}\n
    model Post {\n  id       VARCHAR(64) @id\n  authorId VARCHAR(64)\n  author   User @relation(fields: [authorId], references: [id])\n}\n`;
  const models = parseSchemaText(schema);
  assert.deepStrictEqual(models[1].fields.map((field) => field.name), ['id', 'authorId']);
});

// ─── Commands that only speak SQL Server ─────────────────────────────────────

test('every command that issues SQL itself is listed as SQL Server only', () => {
  // `db:push` and `db:seed` are deliberately absent. db:push goes through the
  // dialect layer and writes each provider's own DDL; db:seed only runs the
  // project's own script and emits no SQL. Both must keep working elsewhere.
  const expected = [
    'db:pull', 'db:cleanup',
    'db:migrate', 'db:migrate:diff', 'db:migrate:generate',
    'db:migrate:apply', 'db:migrate:rollback', 'db:migrate:status',
  ];
  const listed = Object.keys(SQL_SERVER_ONLY_COMMANDS);
  for (const command of expected) {
    assert.ok(listed.includes(command), `${command} should be listed as SQL Server only`);
    // The label is read back in the error message, so an unlisted command falls
    // back to a vague sentence.
    assert.match(SQL_SERVER_ONLY_COMMANDS[command], /[a-z]/, `${command} needs a description`);
  }
  assert.deepStrictEqual(listed.sort(), expected.sort());

  const scripts = require(path.join(__dirname, '..', 'package.json')).scripts;
  for (const command of listed) {
    assert.ok(Object.keys(scripts).includes(command), `${command} is listed but is not an npm script`);
  }
  assert.ok('db:seed' in scripts, 'db:seed should still exist');
  assert.equal(SQL_SERVER_ONLY_COMMANDS['db:seed'], undefined, 'db:seed must not be blocked');
  assert.equal(SQL_SERVER_ONLY_COMMANDS['db:push'], undefined, 'db:push is provider aware now');
});

test('the detected provider decides what the schema is checked against', async () => {
  const body = schemaWithField('position INTEGER');
  await assert.doesNotReject(new SchemaParser(writeSchema(body), 'sqlite').parse());
  await assert.rejects(new SchemaParser(writeSchema(body), 'mssql').parse(), FieldTypeError);
});
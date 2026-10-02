/**
 * an5Orm Generator Regression Tests
 *
 * Runs the real parser and generators (from `dist/`) against a temporary
 * directory and checks the output — unlike `generator.test.js`, which only reads
 * the sibling project's pre-generated files and is therefore skipped whenever
 * `an5Client` is absent.
 *
 * Each test answers a bug that actually happened:
 *   1. A `python.metadataFile` named anything but `an5_metadata.py` made the
 *      generated client import the wrong module and break at runtime.
 *   2. `@@schema("")` was ignored by the parser so the model kept `dbo`; combined
 *      with `[${schema}].[${table}]` hardcoded in six places, every dialect got
 *      `[dbo]` and SQLite failed with `no such table: dbo.<table>`.
 *   3. `INTEGER`/`BOOLEAN`/`BLOB` were missing from the type table and so were
 *      parsed as a relation to a model named `INTEGER` instead of a column. The
 *      valid types are per provider now: `SQLITE_SCHEMA` is parsed with the
 *      `sqlite` provider, and the same schema under `mssql` has to fail.
 *
 * Run: node test/generator-regressions.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const distSrc = path.join(__dirname, '..', 'dist', 'generator', 'src');
const { SchemaParser } = require(path.join(distSrc, 'parser.js'));
const { PythonGenerator } = require(path.join(distSrc, 'python-generator.js'));
const { MetadataGenerator } = require(path.join(distSrc, 'metadata-generator.js'));
const { bracketedTableName, dottedTableName } = require(path.join(distSrc, 'types.js'));

let passed = 0;
let failed = 0;
const queue = [];

function test(name, fn) {
  queue.push([name, fn]);
}

async function run() {
  for (const [name, fn] of queue) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    }
  }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-gen-reg-'));

function writeSchema(name, body) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schema.an5'), body, 'utf8');
  return dir;
}

/** Inserts `@@schema(...)` before every `@@map` — the replace must be global,
 *  a plain string `String.replace` would only patch the first model. */
function withSchema(body, schema) {
  return body.replace(/^ {2}@@map/gm, `  @@schema("${schema}")\n  @@map`);
}

function withEmptySchema(body) {
  return withSchema(body, '');
}

/** The helper defaults to the `sqlite` provider because `SQLITE_SCHEMA` is a
 *  SQLite schema — the allowed types depend on the provider, there is no shared
 *  list any more. */
function parse(name, body, provider = 'sqlite') {
  return new SchemaParser(writeSchema(name, body), provider).parse();
}

const SQLITE_SCHEMA = `
model CatalogType {
  id        NVARCHAR(64)  @id @default(uuid())
  key       NVARCHAR(64)  @unique
  nameVi    NVARCHAR(255)
  @@map("CatalogType")
}

model Catalog {
  id            NVARCHAR(64)  @id @default(uuid())
  catalogTypeId NVARCHAR(64)
  key           NVARCHAR(255)
  position      INTEGER
  enabled       BOOLEAN
  payload       BLOB?
  type          CatalogType   @relation(fields: [catalogTypeId], references: [id])
  @@map("Catalog")
}
`;

console.log('\n─── Regressions ───');

// ─── 1. Metadata module name follows the configuration ────────────────────────

test("the python client imports the configured metadata file name", async () => {
  const models = await parse('custom-name', SQLITE_SCHEMA);
  const outDir = path.join(tmpRoot, 'custom-name-out');
  new PythonGenerator(path.join(outDir, 'an5Metadata.py')).generate(models);

  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assert.ok(
    client.includes('from an5Metadata import MODEL_TO_TABLE'),
    `the client must import an5Metadata, got:\n${client.split('\n').slice(0, 20).join('\n')}`
  );
  assert.ok(!/from\s+\.?(an5_metadata)\b/.test(client), 'no reference to an5_metadata may remain');

  // The real file has to exist, otherwise the import breaks anyway.
  assert.ok(fs.existsSync(path.join(outDir, 'an5Metadata.py')), 'must write the file under the configured name');

  const init = fs.readFileSync(path.join(outDir, '__init__.py'), 'utf8');
  assert.ok(init.includes('from .an5Metadata import'), '__init__ must follow the configured name too');
});

test("the default metadata name is still an5_metadata", async () => {
  const models = await parse('default-name', SQLITE_SCHEMA);
  const outDir = path.join(tmpRoot, 'default-name-out');
  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);
  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assert.ok(client.includes('from an5_metadata import'), 'the old behaviour stands when the name is the default');
});

// ─── 2. An empty schema gets no prefix ────────────────────────────────────────

test("@@schema(\"\") generates a table name with no schema prefix", async () => {
  const models = await parse('empty-schema', withEmptySchema(SQLITE_SCHEMA));
  assertEq(models[0].schemaName, '', 'the schema must be empty, not dbo');

  const outDir = path.join(tmpRoot, 'empty-schema-out');
  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);
  const meta = fs.readFileSync(path.join(outDir, 'an5_metadata.py'), 'utf8');
  assertIncludes(meta, '"[CatalogType]"');
  assert.ok(!meta.includes('[dbo]'), `no [dbo] may remain:\n${meta.split('\n').slice(0, 10).join('\n')}`);
  assert.ok(!meta.includes('[].'), 'must not generate [].[table]');
});

test("without @@schema the default stays dbo, so existing schemas are unaffected", async () => {
  const models = await parse('default-schema', SQLITE_SCHEMA);
  assertEq(models[0].schemaName, 'dbo');
  assertEq(models[0].tableName, 'CatalogType');
  assertEq(bracketedTableName(models[0]), '[dbo].[CatalogType]');
  assertEq(dottedTableName(models[0]), 'dbo.CatalogType');
});

test("@@schema(\"main\") still keeps the prefix", async () => {
  const models = await parse('named-schema', withSchema(SQLITE_SCHEMA, 'main'));
  assertEq(models[0].schemaName, 'main');
  assertEq(bracketedTableName(models[0]), '[main].[CatalogType]');
  assertEq(dottedTableName(models[0]), 'main.CatalogType');
});

test("bracketedTableName/dottedTableName drop the prefix when the schema is empty", async () => {
  const model = { name: 'T', tableName: 'ts', schemaName: '', fields: [], relations: [] };
  assertEq(bracketedTableName(model), '[ts]');
  assertEq(dottedTableName(model), 'ts');
});

test("the TypeScript metadata has no [dbo] left when the schema is empty", async () => {
  const models = await parse('ts-empty-schema', withEmptySchema(SQLITE_SCHEMA));
  const outFile = path.join(tmpRoot, 'ts-out', 'an5Metadata.ts');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  new MetadataGenerator(outFile, '').generate(models);
  const meta = fs.readFileSync(outFile, 'utf8');
  assert.ok(!meta.includes('[dbo]'), 'the TS metadata must not keep [dbo]');
  assertIncludes(meta, '"[CatalogType]"');
});

// ─── 3. SQLite types are not parsed as relations ───────────────────────────────

test("INTEGER/BOOLEAN/BLOB are plain columns, not relations", async () => {
  const models = await parse('sqlite-types', SQLITE_SCHEMA);
  const catalog = models.find((m) => m.name === 'Catalog');

  assertEq(catalog.relations.length, 1, 'only `type` is a relation');
  assertEq(catalog.relations[0].name, 'type');

  const byName = Object.fromEntries(catalog.fields.map((f) => [f.name, f]));
  for (const name of ['position', 'enabled', 'payload']) {
    assert.ok(byName[name], `${name} must be a field, not a relation`);
  }
  assertEq(byName.position.type, 'number');
  assertEq(byName.enabled.type, 'boolean');
  assertEq(byName.payload.type, 'Buffer');
});

test("an upper-case model name is still a relation and is unaffected", async () => {
  const models = await parse('still-relation', SQLITE_SCHEMA);
  const catalog = models.find((m) => m.name === 'Catalog');
  assertEq(catalog.relations[0].type, 'CatalogType');
  assertEq(catalog.relations[0].foreignKey, 'catalogTypeId');
  assertEq(catalog.relations[0].localKey, 'id');
});

test("a type from another provider is reported instead of silently generating code", async () => {
  let error;
  try {
    await parse('wrong-provider', SQLITE_SCHEMA, 'mssql');
  } catch (err) {
    error = err;
  }
  assertEq(error.name, 'FieldTypeError');
  assertEq(error.provider, 'mssql');
  // `position`, `enabled` and `payload` use types that only SQLite has.
  assertEq(error.issues.length, 3, `every bad field must be reported: ${JSON.stringify(error.issues)}`);
  assert.deepStrictEqual(
    error.issues.map((issue) => issue.path),
    ['Catalog.position', 'Catalog.enabled', 'Catalog.payload']
  );
  assertIncludes(error.issues[0].message, 'unknown type "INTEGER" for SQL Server');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

run()
  .then(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assert'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(haystack, needle) {
  if (!haystack.includes(needle)) {
    throw new Error(`expected output to include ${JSON.stringify(needle)}`);
  }
}

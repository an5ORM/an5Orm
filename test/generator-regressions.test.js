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
const { CodeGenerator } = require(path.join(distSrc, 'code-generator.js'));
const { JavaGenerator } = require(path.join(distSrc, 'java-generator.js'));
const { KotlinGenerator } = require(path.join(distSrc, 'kotlin-generator.js'));
const { SwiftGenerator } = require(path.join(distSrc, 'swift-generator.js'));
const { GolangGenerator } = require(path.join(distSrc, 'golang-generator.js'));
const { DotnetGenerator } = require(path.join(distSrc, 'dotnet-generator.js'));
const { RustGenerator } = require(path.join(distSrc, 'rust-generator.js'));
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

/**
 * A schema whose types every provider here accepts, for the table-name assertions —
 * SQLITE_SCHEMA uses INTEGER/BOOLEAN/BLOB, which SQL Server does not have.
 */
const PORTABLE_SCHEMA = `
model CatalogType {
  id   VARCHAR(64)  @id
  name VARCHAR(255)
  @@map("CatalogType")
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
  // A SQLite project gets the bare name: the adapters quote it per dialect, and the
  // brackets are SQL Server syntax.
  assertIncludes(meta, '"CatalogType"');
  assert.ok(!meta.includes('[dbo]'), `no [dbo] may remain:\n${meta.split('\n').slice(0, 10).join('\n')}`);
  assert.ok(!meta.includes('[].'), 'must not generate [].[table]');
});

test("@@schema(\"\") drops the prefix on SQL Server too", async () => {
  const models = await parse('empty-schema-mssql', withEmptySchema(PORTABLE_SCHEMA), 'mssql');
  assertEq(models[0].schemaName, '');
  assertEq(bracketedTableName(models[0]), '[CatalogType]');
});

test("the default schema is SQL Server's alone", async () => {
  // An existing SQL Server schema must generate byte-identical output.
  const mssql = await parse('default-schema', PORTABLE_SCHEMA, 'mssql');
  assertEq(mssql[0].schemaName, 'dbo');
  assertEq(mssql[0].tableName, 'CatalogType');
  assertEq(bracketedTableName(mssql[0]), '[dbo].[CatalogType]');
  assertEq(dottedTableName(mssql[0]), 'dbo.CatalogType');

  // SQLite has no schemas, so it never invents one. This was the "no such table:
  // dbo.<table>" that made every SQLite query fail until the adapters learned to
  // strip the prefix.
  const sqlite = await parse('default-schema-sqlite', SQLITE_SCHEMA, 'sqlite');
  assertEq(sqlite[0].schemaName, '');
  assertEq(bracketedTableName(sqlite[0]), 'CatalogType');
  assertEq(dottedTableName(sqlite[0]), 'CatalogType');
});

test("@@schema(\"main\") still keeps the prefix", async () => {
  const mssql = await parse('named-schema', withSchema(PORTABLE_SCHEMA, 'main'), 'mssql');
  assertEq(mssql[0].schemaName, 'main');
  assertEq(bracketedTableName(mssql[0]), '[main].[CatalogType]');
  assertEq(dottedTableName(mssql[0]), 'main.CatalogType');

  // Elsewhere the schema is a plain prefix on the name, which the adapters quote.
  const sqlite = await parse('named-schema-sqlite', withSchema(PORTABLE_SCHEMA, 'main'), 'sqlite');
  assertEq(bracketedTableName(sqlite[0]), 'main.CatalogType');
  assertEq(dottedTableName(sqlite[0]), 'main.CatalogType');
});

test("bracketedTableName/dottedTableName drop the prefix when the schema is empty", async () => {
  const model = { name: 'T', tableName: 'ts', schemaName: '', fields: [], relations: [] };
  assertEq(bracketedTableName(model), '[ts]');
  assertEq(dottedTableName(model), 'ts');
});

test("TypeScript metadata preserves a custom primary key separately from foreign keys", async () => {
  const dir = writeSchema('custom-primary-key', `model Item {
  ownerId TEXT
  key TEXT @id @default(uuid())
  @@schema("")
}`);
  const models = await new SchemaParser(dir, 'sqlite').parse();
  const outFile = path.join(dir, 'metadata.ts');
  new MetadataGenerator(outFile, '').generate(models);
  const content = fs.readFileSync(outFile, 'utf8');
  assert.ok(/key: \{[^}]*isId: true/.test(content), 'custom primary key is identified');
  assert.ok(!/ownerId: \{[^}]*isId: true/.test(content), 'foreign key is not identified as primary');
});

test("the TypeScript metadata has no [dbo] left when the schema is empty", async () => {
  const models = await parse('ts-empty-schema', withEmptySchema(SQLITE_SCHEMA));
  const outFile = path.join(tmpRoot, 'ts-out', 'an5Metadata.ts');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  new MetadataGenerator(outFile, '').generate(models);
  const meta = fs.readFileSync(outFile, 'utf8');
  assert.ok(!meta.includes('[dbo]'), 'the TS metadata must not keep [dbo]');
  assertIncludes(meta, '"CatalogType"');
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

test("the generated TypeScript model keeps the resolver's type, not `any`", async () => {
  // `normalizeType` is fed `Field.type`, which the parser has already turned into a
  // TypeScript type. Its SQL keyword table lists none of `number[] | string`,
  // `Buffer` or `number | bigint`, so all three used to reach the client as `any`
  // and a vector or byte column lost its type without any warning.
  const outDir = path.join(tmpRoot, 'ts-out');
  const models = await parse(
    'ts-types',
    `
model Asset {
  id        NVARCHAR(64) @id @default(uuid())
  embedding VECTOR(3)
  payload   BLOB
  views     BIGINT
  @@map("assets")
}
`,
  );
  new CodeGenerator(path.join(outDir, 'typescript')).generate(models);
  const generated = fs.readFileSync(path.join(outDir, 'typescript', 'Asset.ts'), 'utf8');
  assertIncludes(generated, 'embedding: number[] | string;');
  assertIncludes(generated, 'payload: Buffer;');
  assertIncludes(generated, 'views: number | bigint;');
  assert.ok(!/^\s*(embedding|payload|views): any/m.test(generated), 'no column may fall back to any');
});

test("a view block generates read-only TypeScript types and metadata", async () => {
  const outDir = path.join(tmpRoot, 'ts-view');
  const models = await parse('view-ts', `
model Widget {
  id   NVARCHAR(64) @id
  name NVARCHAR(80)
  @@map("widgets")
}

view WidgetLabel {
  id   NVARCHAR(64)
  name NVARCHAR(80)
  @@map("widget_labels")
  @@sql("SELECT id, name FROM widgets")
}
`);

  const view = models.find((model) => model.name === 'WidgetLabel');
  assertEq(view.isView, true);
  assertEq(view.viewSql, 'SELECT id, name FROM widgets');
  assertEq(view.relations.length, 0);

  new CodeGenerator(path.join(outDir, 'typescript')).generate(models);
  const generated = fs.readFileSync(path.join(outDir, 'typescript', 'WidgetLabel.ts'), 'utf8');
  assertIncludes(generated, 'WidgetLabelViewClient = ViewClient<');
  assert.ok(!generated.includes('CreateInput'), 'a view must not expose a create input');
  assert.ok(!generated.includes('UpdateInput'), 'a view must not expose an update input');
  assert.ok(!generated.includes('TableClient'), 'a view must not be typed as a writable table');

  const index = fs.readFileSync(path.join(outDir, 'typescript', 'index.ts'), 'utf8');
  assertIncludes(index, 'WidgetLabel!: WidgetLabelTypes.WidgetLabelViewClient;');

  const metaFile = path.join(outDir, 'view-metadata.ts');
  new MetadataGenerator(metaFile, '').generate(models);
  const meta = fs.readFileSync(metaFile, 'utf8');
  assertIncludes(meta, 'WidgetLabel: "widget_labels"');
});

test("a view without @@sql is rejected by the generator parser", async () => {
  let error;
  try {
    await parse('view-missing-sql', 'view Broken {\n  id NVARCHAR(64)\n}');
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'the parser must reject a view without @@sql');
  assertIncludes(error.message, '@@sql');
});

test("the generated Python client reads a view through its ViewClient", async () => {
  const outDir = path.join(tmpRoot, 'py-view');
  const models = await parse('py-view', `
model Widget {
  id   NVARCHAR(64) @id
  name NVARCHAR(80)
  @@map("widgets")
}

view WidgetLabel {
  id   NVARCHAR(64)
  name NVARCHAR(80)
  @@map("widget_labels")
  @@sql("SELECT id, name FROM widgets")
}
`);

  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);
  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assertIncludes(client, 'ViewClient');
  assertIncludes(client, 'self.adapter.view("WidgetLabel")');
  assert.ok(
    !client.includes('AdapterTableClient(self.adapter, "WidgetLabel")'),
    'a view must not be wired to the writable table client',
  );
  const viewInit = fs.readFileSync(path.join(outDir, '__init__.py'), 'utf8');
  assert.ok(
    !viewInit.includes('WidgetLabelCreateInput'),
    'a view must not import missing CreateInput from an5_orm_types',
  );
  assertIncludes(viewInit, 'WidgetLabelAggregateHavingInput, WidgetLabelGroupByArgs');

  const types = fs.readFileSync(path.join(outDir, 'an5_orm_types.py'), 'utf8');
  assert.ok(!types.includes('class WidgetLabelCreateInput'), 'a view must not expose a create input');
  assert.ok(!types.includes('class WidgetLabelUpdateInput'), 'a view must not expose an update input');
  assertIncludes(types, 'class WidgetLabelWhereInput');
});

test("the generated .NET client reads a view through its ViewClient", async () => {
  const outDir = path.join(tmpRoot, 'dotnet-view');
  const models = await parse('dotnet-view', `
model Widget {
  id   NVARCHAR(64) @id
  name NVARCHAR(80)
  @@map("widgets")
}

view WidgetLabel {
  id   NVARCHAR(64)
  name NVARCHAR(80)
  @@map("widget_labels")
  @@sql("SELECT id, name FROM widgets")
}
`, 'mssql');

  new DotnetGenerator(outDir).generate(models);

  const context = fs.readFileSync(path.join(outDir, 'An5DbContext.cs'), 'utf8');
  assertIncludes(context, 'public ViewClient<WidgetLabel> WidgetLabels => new ViewClient<WidgetLabel>');
  assertIncludes(context, 'public class ViewClient<T> where T : new()');
  // The read methods are delegated, not reimplemented.
  assertIncludes(context, '=> _table.FindMany(whereClause, parameters);');
  assertIncludes(context, '=> _table.Count(whereClause, parameters);');
  assertIncludes(context, '=> _table.VectorSearch(vector, take, whereClause, parameters, vectorField, distanceMetric);');

  const types = fs.readFileSync(path.join(outDir, 'An5OrmTypes.cs'), 'utf8');
  assert.ok(!types.includes('class WidgetLabelCreateInput'), 'a view must not expose a create input');
  assert.ok(!types.includes('class WidgetLabelUpdateInput'), 'a view must not expose an update input');
  assert.ok(!types.includes('class WidgetLabelDeleteManyArgs'), 'a view must not expose a delete input');
  assertIncludes(types, 'class WidgetLabelWhereInput');

  // ...but the view still has a table entity, because the rows are mapped to it.
  assertIncludes(context, 'new TableClient<Widget>');
  assert.ok(!context.includes('new TableClient<WidgetLabel>'), 'a view must not be wired to the writable table client');
});

test("the Go, Rust, Java, Kotlin and Swift clients read a view through a read-only client", async () => {
  const models = await parse('all-view-clients', `
model Widget {
  id   NVARCHAR(64) @id
  name NVARCHAR(80)
  @@map("widgets")
}

view WidgetLabel {
  id   NVARCHAR(64)
  name NVARCHAR(80)
  @@map("widget_labels")
  @@sql("SELECT id, name FROM widgets")
}
`, 'mssql');

  // Go: a distinct ViewClient with no write methods.
  const goDir = path.join(tmpRoot, 'go-view');
  new GolangGenerator(goDir).generate(models);
  const goClient = fs.readFileSync(path.join(goDir, 'client.go'), 'utf8');
  assertIncludes(goClient, 'WidgetLabels *ViewClient[WidgetLabel]');
  assertIncludes(goClient, 'NewViewClient[WidgetLabel](db, "dbo.widget_labels"');
  assertIncludes(goClient, 'type ViewClient[T any] struct');
  assert.ok(!goClient.includes('func (c *ViewClient[T]) Create'), 'a view client must not offer a write');
  const goModel = fs.readFileSync(path.join(goDir, 'WidgetLabel.go'), 'utf8');
  assert.ok(!goModel.includes('type WidgetLabelCreateInput'));
  assert.ok(!goModel.includes('type WidgetLabelDeleteManyArgs'));
  assertIncludes(goModel, 'type WidgetLabelWhereInput');
  assertIncludes(goModel, 'type WidgetLabelAggregateHavingInput');
  assertIncludes(goModel, 'type WidgetLabelGroupByArgs');

  // Rust: reads go through the runtime ViewClient; write methods and inputs stay out.
  const rustDir = path.join(tmpRoot, 'rust-view');
  new RustGenerator(rustDir).generate(models);
  const rustClient = fs.readFileSync(path.join(rustDir, 'src', 'client.rs'), 'utf8');
  assertIncludes(rustClient, 'self.db.adapter().view("WidgetLabel")');
  assertEq((rustClient.match(/pub async fn create\(/g) || []).length, 1, 'only the table gets create()');
  assertEq((rustClient.match(/pub async fn update\(/g) || []).length, 1, 'only the table gets update()');
  assertEq((rustClient.match(/pub async fn delete\(/g) || []).length, 1, 'only the table gets delete()');
  const rustModels = fs.readFileSync(path.join(rustDir, 'src', 'models.rs'), 'utf8');
  assert.ok(!rustModels.includes('pub struct WidgetLabelCreateInput'));
  assert.ok(!rustModels.includes('pub struct WidgetLabelUpdateInput'));
  assert.ok(!rustModels.includes('pub struct WidgetLabelUpdateArgs'));
  assertIncludes(rustModels, 'pub struct WidgetLabelAggregateHavingInput');
  assertIncludes(rustModels, 'pub struct WidgetLabelGroupByArgs');

  // Java: a separate typed ViewClient.
  const javaDir = path.join(tmpRoot, 'java-view');
  new JavaGenerator(javaDir).generate(models);
  const javaContext = fs.readFileSync(path.join(javaDir, 'An5DbContext.java'), 'utf8');
  assertIncludes(javaContext, 'private final ViewClient<WidgetLabel> widgetLabelClient;');
  assertIncludes(javaContext, 'this.widgetLabelClient = new ViewClient<WidgetLabel>(');
  assertIncludes(javaContext, 'adapter.view("WidgetLabel"), WidgetLabel::fromRow');
  assert.ok(!javaContext.includes('ModelClient<WidgetLabel>'), 'a view must not use the writable client');
  const javaView = fs.readFileSync(path.join(javaDir, 'ViewClient.java'), 'utf8');
  assert.ok(!javaView.includes('public T create('), 'a view client must not offer create');

  // Kotlin: the generated ViewClient wraps the runtime one.
  const kotlinDir = path.join(tmpRoot, 'kotlin-view');
  new KotlinGenerator(kotlinDir).generate(models);
  const kotlinDb = fs.readFileSync(path.join(kotlinDir, 'An5Db.kt'), 'utf8');
  assertIncludes(kotlinDb, 'val widgetLabel: ViewClient<WidgetLabel> =');
  assertIncludes(kotlinDb, 'ViewClient(an5.view("WidgetLabel"), WidgetLabel::fromRow)');
  assert.ok(!kotlinDb.includes('ModelClient(an5.table("WidgetLabel")'));

  // Swift: SwiftPM sees the runtime's ViewClient, so the typed wrapper has another name.
  const swiftDir = path.join(tmpRoot, 'swift-view');
  new SwiftGenerator(swiftDir).generate(models);
  const swiftDb = fs.readFileSync(path.join(swiftDir, 'Sources', 'An5Client', 'An5Db.swift'), 'utf8');
  assertIncludes(swiftDb, 'public let widgetLabel: ViewModelClient<WidgetLabel>');
  assertIncludes(swiftDb, 'ViewModelClient(\n            view: adapter.view("WidgetLabel")');
  assert.ok(!swiftDb.includes('ModelClient(\n            table: adapter.table("WidgetLabel")'));
});

test("a view cannot be the target of a relation", async () => {
  let error;
  try {
    await parse('view-relation', `
model User {
  id    NVARCHAR(64) @id
  label WidgetLabel
}

view WidgetLabel {
  id NVARCHAR(64)
  @@sql("SELECT id FROM widgets")
}
`);
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'a relation to a view must be rejected');
  assertIncludes(error.issues?.[0]?.message ?? error.message, 'is a view and cannot be the target of a relation');
});

test("a view's SQL may span several lines in a triple-quoted string", async () => {
  const models = await parse('view-multiline', `
view WidgetLabel {
  id   NVARCHAR(64)
  name NVARCHAR(80)
  @@map("widget_labels")
  @@sql("""
    SELECT id, name
    FROM widgets
    WHERE name <> 'a)b'
  """)
}
`);

  const view = models.find((model) => model.name === 'WidgetLabel');
  assertEq(view.viewSql, "SELECT id, name\nFROM widgets\nWHERE name <> 'a)b'");
});

test("every generated client reads a VECTOR(n) column through its runtime codec", async () => {
  // A `VECTOR(n)` column stores float32 bytes on SQLite, so reading it means calling
  // the runtime's codec. Each of these generators once went its own way instead, and
  // each failure was invisible until a schema actually had a vector column:
  //   Java    re-parsed `[0.1, 0.2]` text, which a BLOB never matches
  //   Kotlin  had no vector case and read the column as a String
  //   Swift   called `An5Values.vector`, a symbol that exists in no runtime
  const outDir = path.join(tmpRoot, 'vector-read');
  const schema = `
model Asset {
  id        NVARCHAR(64) @id @default(uuid())
  embedding VECTOR(3)
  @@map("assets")
}
`;
  const models = await parse('vector-read', schema);

  const java = path.join(outDir, 'java');
  new JavaGenerator(java).generate(models);
  const javaValues = fs.readFileSync(path.join(java, 'An5Values.java'), 'utf8');
  assertIncludes(javaValues, 'SqliteVectors.decodeVector(value, 0)');

  const kotlin = path.join(outDir, 'kotlin');
  new KotlinGenerator(kotlin).generate(models);
  assertIncludes(fs.readFileSync(path.join(kotlin, 'Asset.kt'), 'utf8'), 'row.vectorOrNull("embedding")');

  const swift = path.join(outDir, 'swift');
  new SwiftGenerator(swift).generate(models);
  const swiftAsset = fs.readFileSync(path.join(swift, 'Sources', 'An5Client', 'Asset.swift'), 'utf8');
  assertIncludes(swiftAsset, 'row.vector("embedding")');
  // A nullable column whose property is non-optional generates `= nil` defaults for a
  // non-optional type, which does not compile.
  assertIncludes(swiftAsset, 'embedding: [Double]?');
  assertIncludes(swiftAsset, 'embedding: [Double]? = nil');
  assert.ok(!/embedding: \[Double\] = nil/.test(swiftAsset), 'an optional vector must stay optional');
  assert.ok(!/An5Values/.test(swiftAsset), 'no symbol from outside the runtime may be referenced');
});

test("the generated Go client stores a vector column as float32 bytes", async () => {
  // `database/sql` binds only a fixed set of types, so a `*[]float32` field reached
  // the driver as `unsupported type []float32`, and on the way back the column's bytes
  // were scanned straight into the slice. Both directions need the codec, and the
  // fallback scorer needs it too because the field is nullable and sits behind a pointer.
  const outDir = path.join(tmpRoot, 'go-vector');
  const models = await parse(
    'go-vector',
    `
model Asset {
  id        NVARCHAR(64) @id @default(uuid())
  embedding VECTOR(3)?
  @@map("assets")
}
`,
  );
  new GolangGenerator(outDir).generate(models);
  const client = fs.readFileSync(path.join(outDir, 'client.go'), 'utf8');

  // Written through the codec in both statements that bind a field value.
  assertEq((client.match(/encodeVectorArg\(fieldVal\.Interface\(\)\)/g) || []).length, 2, 'create and update');
  // Read back out of the bytes the column stores.
  assertIncludes(client, 'isVectorGoType(fieldVal.Type())');
  assertIncludes(client, 'setVectorField(fieldVal, decoded)');
  // Scored in memory when the database has no vector operator.
  assertIncludes(client, 'rowVec := vectorComponents(fieldVal)');
  // A pointer is how a nullable column is spelled, so the codec must unwrap it.
  assertIncludes(client, 'func vectorSliceType(t reflect.Type) reflect.Type');
  assertIncludes(client, 'for field.Kind() == reflect.Ptr {');

  const asset = fs.readFileSync(path.join(outDir, 'Asset.go'), 'utf8');
  assertIncludes(asset, 'Embedding *[]float32');
});

test("Python generator emits typed filter unions, BoolFilter.not_, relations, and updated docstrings", async () => {
  const outDir = path.join(tmpRoot, 'python-typed-filters');
  const models = await parse('python-typed-filters', `
model Author {
  id        NVARCHAR(64) @id @default(uuid())
  email     NVARCHAR(255) @unique
  isActive  BIT @default(true)
  createdAt DATETIME2 @default(now())
  posts     Post[]
  @@map("authors")
}

model Post {
  id        NVARCHAR(64) @id @default(uuid())
  authorId  NVARCHAR(64)
  title     NVARCHAR(255)
  author    Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'mssql');

  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);

  const types = fs.readFileSync(path.join(outDir, 'an5_orm_types.py'), 'utf8');
  assertIncludes(types, 'from typing import Dict, List, Optional, Any, Union');
  assertIncludes(types, 'class BoolFilter:');
  assertIncludes(types, '    mode: Optional[str] = None');
  assertIncludes(types, '    not_: Optional[bool] = None');
  assertIncludes(types, '    NOT: Optional[Union[\'AuthorWhereInput\', List[\'AuthorWhereInput\']]] = None');
  assertIncludes(types, '    email: Optional[Union[str, StringFilter]] = None');
  assertIncludes(types, '    is_active: Optional[Union[bool, BoolFilter]] = None');
  assertIncludes(types, '    created_at: Optional[Union[datetime, str, DateTimeFilter]] = None');
  assertIncludes(types, '    posts: Optional[Dict[str, Any]] = None');
  assertIncludes(types, 'class AuthorAggregateHavingInput:');
  assertIncludes(types, 'class AuthorGroupByArgs:');
  assertIncludes(types, '    select: Optional[Union[List[str], Dict[str, Any]]] = None');
  assertIncludes(types, '    include: Optional[Dict[str, Any]] = None');
  assertIncludes(types, 'UserWhereInput(name=StringFilter(contains="John"))');

  const initPy = fs.readFileSync(path.join(outDir, '__init__.py'), 'utf8');
  assertIncludes(initPy, 'AuthorAggregateHavingInput, AuthorGroupByArgs');

  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assertIncludes(client, 'snake_case aliases');
  assertIncludes(client, 'an5_orm_types');
});

test("Rust generator emits ListRelationFilter, RelationFilter, relation_map, and rename=in on in_list", async () => {
  const outDir = path.join(tmpRoot, 'rust-relations');
  const models = await parse('rust-relations', `
model Author {
  id    NVARCHAR(64) @id @default(uuid())
  email NVARCHAR(255) @unique
  posts Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  new RustGenerator(outDir).generate(models);

  const filters = fs.readFileSync(path.join(outDir, 'src', 'filters.rs'), 'utf8');
  assertIncludes(filters, '#[serde(default, rename = "in", skip_serializing_if = "Vec::is_empty")]');
  assertIncludes(filters, 'pub mode: Option<String>,');
  assertIncludes(filters, 'pub struct ListRelationFilter<T>');
  assertIncludes(filters, 'pub struct RelationFilter<T>');

  const modelSrc = fs.readFileSync(path.join(outDir, 'src', 'models.rs'), 'utf8');
  assertIncludes(modelSrc, 'pub posts: Option<ListRelationFilter<PostWhereInput>>');
  assertIncludes(modelSrc, 'pub author: Option<RelationFilter<AuthorWhereInput>>');
  assertIncludes(modelSrc, 'pub struct AuthorCountAggregateFilter');
  assertIncludes(modelSrc, 'pub struct AuthorAggregateHavingInput');
  assertIncludes(modelSrc, 'pub struct AuthorGroupByArgs');

  const meta = fs.readFileSync(path.join(outDir, 'src', 'metadata.rs'), 'utf8');
  assertIncludes(meta, 'pub fn relation_map()');
  assertIncludes(meta, '("posts", "post", "many", "author_id", "id")');
  assertIncludes(meta, '("author", "author", "one", "author_id", "id")');

  const client = fs.readFileSync(path.join(outDir, 'src', 'client.rs'), 'utf8');
  assertIncludes(client, 'relation_map: relations');
  assertIncludes(client, 'pub async fn group_by(&self, args: &AuthorGroupByArgs)');
});

test("Swift generator emits ListRelationFilter, RelationFilter, relationType metadata, and NSNull equality", async () => {
  const outDir = path.join(tmpRoot, 'swift-relations');
  const models = await parse('swift-relations', `
model Author {
  id    NVARCHAR(64) @id @default(uuid())
  email NVARCHAR(255) @unique
  posts Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  new SwiftGenerator(outDir).generate(models);

  const types = fs.readFileSync(path.join(outDir, 'Sources', 'An5Client', 'An5OrmTypes.swift'), 'utf8');
  assertIncludes(types, 'public protocol WhereBuilder');
  assertIncludes(types, 'public struct ListRelationFilter<Target: WhereBuilder>');
  assertIncludes(types, 'public struct RelationFilter<Target: WhereBuilder>');
  assertIncludes(types, 'public struct AuthorWhere: WhereBuilder');
  assertIncludes(types, 'public var posts: ListRelationFilter<PostWhere>?');
  assertIncludes(types, 'public var author: RelationFilter<AuthorWhere>?');
  assertIncludes(types, 'filter.operators["equals"] = value.map { $0 as Any } ?? NSNull()');

  const meta = fs.readFileSync(path.join(outDir, 'Sources', 'An5Client', 'An5Metadata.swift'), 'utf8');
  assertIncludes(meta, '"posts": ["modelName": "Post", "relationType": "many", "foreignKey": "authorId", "localKey": "id"]');
  assertIncludes(meta, '"author": ["modelName": "Author", "relationType": "one", "foreignKey": "authorId", "localKey": "id"]');
});

test("Java and Kotlin generators emit ListRelationFilter, RelationFilter, and relationType metadata", async () => {
  const models = await parse('jvm-relations', `
model Author {
  id    NVARCHAR(64) @id @default(uuid())
  email NVARCHAR(255) @unique
  posts Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  const javaDir = path.join(tmpRoot, 'java-relations');
  new JavaGenerator(javaDir).generate(models);
  const javaTypes = fs.readFileSync(path.join(javaDir, 'An5OrmTypes.java'), 'utf8');
  assertIncludes(javaTypes, 'public interface WhereBuilder');
  assertIncludes(javaTypes, 'public static final class ListRelationFilter<T extends WhereBuilder>');
  assertIncludes(javaTypes, 'public static final class RelationFilter<T extends WhereBuilder>');
  assertIncludes(javaTypes, 'public static final class AuthorWhere implements WhereBuilder');
  assertIncludes(javaTypes, 'public ListRelationFilter<PostWhere> Posts;');
  assertIncludes(javaTypes, 'public RelationFilter<AuthorWhere> Author;');
  const javaMeta = fs.readFileSync(path.join(javaDir, 'An5Metadata.java'), 'utf8');
  assertIncludes(javaMeta, 'relation("Post", "many", "authorId", "id")');
  assertIncludes(javaMeta, 'relation("Author", "one", "authorId", "id")');

  const kotlinDir = path.join(tmpRoot, 'kotlin-relations');
  new KotlinGenerator(kotlinDir).generate(models);
  const kotlinTypes = fs.readFileSync(path.join(kotlinDir, 'An5OrmTypes.kt'), 'utf8');
  assertIncludes(kotlinTypes, 'interface WhereBuilder');
  assertIncludes(kotlinTypes, 'class ListRelationFilter<T : WhereBuilder>');
  assertIncludes(kotlinTypes, 'class RelationFilter<T : WhereBuilder>');
  assertIncludes(kotlinTypes, 'val posts: ListRelationFilter<PostWhere>? = null');
  assertIncludes(kotlinTypes, 'val author: RelationFilter<AuthorWhere>? = null');
  const kotlinMeta = fs.readFileSync(path.join(kotlinDir, 'An5Metadata.kt'), 'utf8');
  assertIncludes(kotlinMeta, '"posts" to relation("Post", "many", "authorId", "id")');
  assertIncludes(kotlinMeta, '"author" to relation("Author", "one", "authorId", "id")');
});

test("Go generator emits ListRelationFilter, RelationFilter, BoolFilter.Not, and RelationMap metadata", async () => {
  const models = await parse('go-relations', `
model Author {
  id       NVARCHAR(64) @id @default(uuid())
  email    NVARCHAR(255) @unique
  isActive BOOLEAN @default(true)
  posts    Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  const goDir = path.join(tmpRoot, 'go-relations');
  new GolangGenerator(goDir).generate(models);

  const clientGo = fs.readFileSync(path.join(goDir, 'client.go'), 'utf8');
  assertIncludes(clientGo, 'type ListRelationFilter[T any] struct');
  assertIncludes(clientGo, 'type RelationFilter[T any] struct');
  assertIncludes(clientGo, 'type BoolFilter struct {\n\tEquals *bool\n\tNot    *bool\n}');
  assertIncludes(clientGo, 'Mode       string // "default" or "insensitive"');
  assertIncludes(clientGo, 'buildWhereFromStructWithContext');
  assertIncludes(clientGo, 'buildHavingFromStruct');
  assertIncludes(clientGo, 'resolveModelRelation(modelName, name)');

  const authorGo = fs.readFileSync(path.join(goDir, 'Author.go'), 'utf8');
  assertIncludes(authorGo, 'Posts *ListRelationFilter[PostWhereInput]');
  assertIncludes(authorGo, 'IsActive *BoolFilter');
  assertIncludes(authorGo, 'type AuthorCountAggregateFilter struct');
  assertIncludes(authorGo, 'type AuthorAggregateHavingInput struct');
  assertIncludes(authorGo, 'type AuthorGroupByArgs struct');

  const postGo = fs.readFileSync(path.join(goDir, 'Post.go'), 'utf8');
  assertIncludes(postGo, 'Author *RelationFilter[AuthorWhereInput]');

  const metaGo = fs.readFileSync(path.join(goDir, 'metadata.go'), 'utf8');
  assertIncludes(metaGo, 'var RelationMap = map[string]map[string]RelationDef');
  assertIncludes(metaGo, 'var ModelFields = map[string]map[string]bool');
  assertIncludes(metaGo, '"posts": {ModelName: "Post", RelationType: "many", ForeignKey: "author_id", LocalKey: "id"}');
  assertIncludes(metaGo, '"author": {ModelName: "Author", RelationType: "one", ForeignKey: "author_id", LocalKey: "id"}');
});

test(".NET generator emits ListRelationFilter, RelationFilter, BoolFilter.Not, An5ClientMetadata, and An5WhereBuilder", async () => {
  const models = await parse('dotnet-relations', `
model Author {
  id       NVARCHAR(64) @id @default(uuid())
  email    NVARCHAR(255) @unique
  isActive BOOLEAN @default(true)
  posts    Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  const dotnetDir = path.join(tmpRoot, 'dotnet-relations');
  new DotnetGenerator(dotnetDir).generate(models);

  const typesCs = fs.readFileSync(path.join(dotnetDir, 'An5OrmTypes.cs'), 'utf8');
  assertIncludes(typesCs, 'public class ListRelationFilter<T> : IListRelationFilter');
  assertIncludes(typesCs, 'public class RelationFilter<T> : IRelationFilter');
  assertIncludes(typesCs, 'public class BoolFilter\n    {\n        public new bool? Equals { get; set; }\n        public bool? Not { get; set; }\n    }');
  assertIncludes(typesCs, 'public ListRelationFilter<PostWhereInput> Posts { get; set; }');
  assertIncludes(typesCs, 'public RelationFilter<AuthorWhereInput> Author { get; set; }');

  const ctxCs = fs.readFileSync(path.join(dotnetDir, 'An5DbContext.cs'), 'utf8');
  assertIncludes(ctxCs, 'public static class An5ClientMetadata');
  assertIncludes(ctxCs, 'public static readonly Dictionary<string, Dictionary<string, An5RelationDef>> RelationMap');
  assertIncludes(ctxCs, '{ "posts", new An5RelationDef { ModelName = "Post", RelationType = "many", ForeignKey = "authorId", LocalKey = "id" } }');
  assertIncludes(ctxCs, '{ "author", new An5RelationDef { ModelName = "Author", RelationType = "one", ForeignKey = "authorId", LocalKey = "id" } }');
  assertIncludes(ctxCs, 'internal static class An5WhereBuilder');
  assertIncludes(ctxCs, 'public List<T> FindMany(object args)');
});

test("TypeScript generator emits QueryMode, StringFilter.mode, ListRelationFilter, and RelationFilter", async () => {
  const models = await parse('ts-relations', `
model Author {
  id    NVARCHAR(64) @id @default(uuid())
  email NVARCHAR(255) @unique
  name  NVARCHAR(255)?
  posts Post[]
  @@map("authors")
}

model Post {
  id       NVARCHAR(64) @id @default(uuid())
  authorId NVARCHAR(64)
  title    NVARCHAR(255)
  author   Author @relation(fields: [authorId], references: [id])
  @@map("posts")
}
`, 'sqlite');

  const tsDir = path.join(tmpRoot, 'ts-relations');
  new CodeGenerator(tsDir).generate(models);

  const baseTs = fs.readFileSync(path.join(tsDir, 'base.ts'), 'utf8');
  assertIncludes(baseTs, "export type QueryMode = 'default' | 'insensitive';");
  assertIncludes(baseTs, 'mode?: QueryMode;');
  assertIncludes(baseTs, 'export type ListRelationFilter<T> = { some?: T; none?: T; every?: T; };');
  assertIncludes(baseTs, 'export type RelationFilter<T> = { is?: T | null; isNot?: T | null; };');

  const authorTs = fs.readFileSync(path.join(tsDir, 'Author.ts'), 'utf8');
  assertIncludes(authorTs, 'posts?: An5.ListRelationFilter<PostWhereInput>;');

  const postTs = fs.readFileSync(path.join(tsDir, 'Post.ts'), 'utf8');
  assertIncludes(postTs, 'author?: An5.RelationFilter<AuthorWhereInput>;');

  const indexTs = fs.readFileSync(path.join(tsDir, 'index.ts'), 'utf8');
  assertIncludes(indexTs, 'export type QueryMode = BaseAn5.QueryMode;');
  assertIncludes(indexTs, 'export type ListRelationFilter<T> = BaseAn5.ListRelationFilter<T>;');
  assertIncludes(indexTs, 'export type RelationFilter<T> = BaseAn5.RelationFilter<T>;');
  assertIncludes(authorTs, 'export type AuthorAggregateHavingInput = { AND?: AuthorAggregateHavingInput | AuthorAggregateHavingInput[]; OR?: AuthorAggregateHavingInput[]; NOT?: AuthorAggregateHavingInput | AuthorAggregateHavingInput[];');
  assertIncludes(postTs, 'authorId?: string | An5.StringFilter;');
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

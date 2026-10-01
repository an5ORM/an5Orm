/**
 * an5Orm Generator Regression Tests
 *
 * Chạy parser và generator thật (từ `dist/`) vào thư mục tạm rồi kiểm tra
 * output — khác `generator.test.js` vốn chỉ đọc file sinh sẵn của dự án anh
 * em, nên phần lớn bị skip khi không có `an5Client`.
 *
 * Mỗi test trả lời một lỗi đã gặp thật:
 *   1. `python.metadataFile` đặt tên khác `an5_metadata.py` thì client sinh ra
 *      import sai module và hỏng lúc chạy.
 *   2. `@@schema("")` bị parser bỏ qua nên model vẫn nhận `dbo`; cộng với
 *      `[${schema}].[${table}]` viết cứng ở 6 chỗ, mọi dialect đều nhận `[dbo]`
 *      và trên SQLite ra `no such table: dbo.<table>`.
 *   3. Kiểu `INTEGER`/`BOOLEAN`/`BLOB` không có trong bảng ánh xạ nên bị parse
 *      thành quan hệ tới model tên `INTEGER` thay vì thành cột thường.
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

/** Chèn `@@schema(...)` vào TRƯỚC mỗi `@@map` — phải global, `String.replace`
 *  chuỗi chỉ thay lần đầu nên sẽ chỉ áp cho model đầu tiên. */
function withSchema(body, schema) {
  return body.replace(/^ {2}@@map/gm, `  @@schema("${schema}")\n  @@map`);
}

function withEmptySchema(body) {
  return withSchema(body, '');
}

function parse(name, body) {
  return new SchemaParser(writeSchema(name, body)).parse();
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

// ─── 1. Tên module metadata theo cấu hình ──────────────────────────────────────

test("python client import đúng tên file metadata được cấu hình", async () => {
  const models = await parse('custom-name', SQLITE_SCHEMA);
  const outDir = path.join(tmpRoot, 'custom-name-out');
  new PythonGenerator(path.join(outDir, 'an5Metadata.py')).generate(models);

  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assert.ok(
    client.includes('from an5Metadata import MODEL_TO_TABLE'),
    `client phải import an5Metadata, thực tế:\n${client.split('\n').slice(0, 20).join('\n')}`
  );
  assert.ok(!/from\s+\.?(an5_metadata)\b/.test(client), 'không được còn tham chiếu an5_metadata');

  // File thật phải tồn tại, nếu không import vẫn hỏng.
  assert.ok(fs.existsSync(path.join(outDir, 'an5Metadata.py')), 'phải sinh file theo tên cấu hình');

  const init = fs.readFileSync(path.join(outDir, '__init__.py'), 'utf8');
  assert.ok(init.includes('from .an5Metadata import'), '__init__ cũng phải theo tên cấu hình');
});

test("tên metadata mặc định vẫn là an5_metadata", async () => {
  const models = await parse('default-name', SQLITE_SCHEMA);
  const outDir = path.join(tmpRoot, 'default-name-out');
  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);
  const client = fs.readFileSync(path.join(outDir, 'an5_client.py'), 'utf8');
  assert.ok(client.includes('from an5_metadata import'), 'giữ nguyên hành vi cũ khi tên là mặc định');
});

// ─── 2. Schema rỗng thì không prefix ───────────────────────────────────────────

test("@@schema(\"\") sinh tên bảng không có schema prefix", async () => {
  const models = await parse('empty-schema', withEmptySchema(SQLITE_SCHEMA));
  assertEq(models[0].schemaName, '', 'schema phải rỗng chứ không phải dbo');

  const outDir = path.join(tmpRoot, 'empty-schema-out');
  new PythonGenerator(path.join(outDir, 'an5_metadata.py')).generate(models);
  const meta = fs.readFileSync(path.join(outDir, 'an5_metadata.py'), 'utf8');
  assertIncludes(meta, '"[CatalogType]"');
  assert.ok(!meta.includes('[dbo]'), `không được còn [dbo]:\n${meta.split('\n').slice(0, 10).join('\n')}`);
  assert.ok(!meta.includes('[].'), 'không được sinh [].[table]');
});

test("bỏ @@schema thì vẫn mặc định dbo (không phá người dùng hiện có)", async () => {
  const models = await parse('default-schema', SQLITE_SCHEMA);
  assertEq(models[0].schemaName, 'dbo');
  assertEq(models[0].tableName, 'CatalogType');
  assertEq(bracketedTableName(models[0]), '[dbo].[CatalogType]');
  assertEq(dottedTableName(models[0]), 'dbo.CatalogType');
});

test("@@schema(\"main\") vẫn giữ prefix", async () => {
  const models = await parse('named-schema', withSchema(SQLITE_SCHEMA, 'main'));
  assertEq(models[0].schemaName, 'main');
  assertEq(bracketedTableName(models[0]), '[main].[CatalogType]');
  assertEq(dottedTableName(models[0]), 'main.CatalogType');
});

test("bracketedTableName/dottedTableName bỏ prefix khi schema rỗng", async () => {
  const model = { name: 'T', tableName: 'ts', schemaName: '', fields: [], relations: [] };
  assertEq(bracketedTableName(model), '[ts]');
  assertEq(dottedTableName(model), 'ts');
});

test("metadata TypeScript cũng không còn [dbo] khi schema rỗng", async () => {
  const models = await parse('ts-empty-schema', withEmptySchema(SQLITE_SCHEMA));
  const outFile = path.join(tmpRoot, 'ts-out', 'an5Metadata.ts');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  new MetadataGenerator(outFile, '').generate(models);
  const meta = fs.readFileSync(outFile, 'utf8');
  assert.ok(!meta.includes('[dbo]'), 'metadata TS không được còn [dbo]');
  assertIncludes(meta, '"[CatalogType]"');
});

// ─── 3. Kiểu SQLite không bị parse nhầm thành relation ─────────────────────────

test("INTEGER/BOOLEAN/BLOB là cột thường, không phải relation", async () => {
  const models = await parse('sqlite-types', SQLITE_SCHEMA);
  const catalog = models.find((m) => m.name === 'Catalog');

  assertEq(catalog.relations.length, 1, 'chỉ `type` mới là relation');
  assertEq(catalog.relations[0].name, 'type');

  const byName = Object.fromEntries(catalog.fields.map((f) => [f.name, f]));
  for (const name of ['position', 'enabled', 'payload']) {
    assert.ok(byName[name], `${name} phải là field, không phải relation`);
  }
  assertEq(byName.position.type, 'number');
  assertEq(byName.enabled.type, 'boolean');
  assertEq(byName.payload.type, 'Buffer');
});

test("tên model viết hoa vẫn là relation, không bị ảnh hưởng", async () => {
  const models = await parse('still-relation', SQLITE_SCHEMA);
  const catalog = models.find((m) => m.name === 'Catalog');
  assertEq(catalog.relations[0].type, 'CatalogType');
  assertEq(catalog.relations[0].foreignKey, 'catalogTypeId');
  assertEq(catalog.relations[0].localKey, 'id');
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

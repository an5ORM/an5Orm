/**
 * an5Orm Generator Unit Tests
 * Tests for schema parser and code generation.
 * Run: node test/generator.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'Assert'}: expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(str, substr, msg) {
  if (!str || !str.includes(substr)) {
    throw new Error(`${msg || 'Assert'}: "${str}" does not contain "${substr}"`);
  }
}

function assertExists(filePath, msg) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${msg || 'Assert'}: file not found: ${filePath}`);
  }
}

console.log('\n=== Generator Unit Tests ===\n');

// ─── Schema file tests ───────────────────────────────────────────────────────

console.log('Schema Files:');

test('test1.an5 exists and is valid', () => {
  const schemaPath = path.join(__dirname, '..', '..', 'an5Schema', 'test1.an5');
  assertExists(schemaPath);
  const content = fs.readFileSync(schemaPath, 'utf8');
  assertIncludes(content, 'model User');
  assertIncludes(content, 'id');
  assertIncludes(content, 'email');
  assertIncludes(content, 'NVARCHAR');
  assertIncludes(content, 'DATETIME2');
});

test('test2.an5 exists and has Order model', () => {
  const schemaPath = path.join(__dirname, '..', '..', 'an5Schema', 'test2.an5');
  assertExists(schemaPath);
  const content = fs.readFileSync(schemaPath, 'utf8');
  assertIncludes(content, 'model Order');
  assertIncludes(content, 'INT');
});

test('schema files parse model headers correctly', () => {
  const schemaPath = path.join(__dirname, '..', '..', 'an5Schema', 'test1.an5');
  const content = fs.readFileSync(schemaPath, 'utf8');
  const modelMatch = content.match(/model\s+(\w+)\s*\{/);
  assertEq(modelMatch[1], 'User');
});

test('schema files use SQL Server types directly', () => {
  const schemaPath = path.join(__dirname, '..', '..', 'an5Schema', 'test1.an5');
  const content = fs.readFileSync(schemaPath, 'utf8');
  assertIncludes(content, 'NVARCHAR(');
  assertIncludes(content, 'DATETIME2');
  // Should NOT use generic TypeScript types
  assert(!content.includes('String '), 'Should not use generic String type');
  assert(!content.includes('DateTime '), 'Should not use generic DateTime type');
});

// ─── Generator source tests ──────────────────────────────────────────────────

console.log('\nGenerator Source:');

test('parser.ts exists', () => {
  const parserPath = path.join(__dirname, '..', 'generator', 'src', 'parser.ts');
  assertExists(parserPath);
});

test('code-generator.ts exists', () => {
  const genPath = path.join(__dirname, '..', 'generator', 'src', 'code-generator.ts');
  assertExists(genPath);
});

test('metadata-generator.ts exists', () => {
  const metaPath = path.join(__dirname, '..', 'generator', 'src', 'metadata-generator.ts');
  assertExists(metaPath);
});

test('python-generator.ts exists', () => {
  const pyPath = path.join(__dirname, '..', 'generator', 'src', 'python-generator.ts');
  assertExists(pyPath);
});

test('dotnet-generator.ts exists', () => {
  const dotnetPath = path.join(__dirname, '..', 'generator', 'src', 'dotnet-generator.ts');
  assertExists(dotnetPath);
});

test('golang-generator.ts exists', () => {
  const goPath = path.join(__dirname, '..', 'generator', 'src', 'golang-generator.ts');
  assertExists(goPath);
});

test('types.ts exists with Model and Field interfaces', () => {
  const typesPath = path.join(__dirname, '..', 'generator', 'src', 'types.ts');
  assertExists(typesPath);
  const content = fs.readFileSync(typesPath, 'utf8');
  assertIncludes(content, 'Model');
  assertIncludes(content, 'Field');
});

test('generator index.ts has main function', () => {
  const indexPath = path.join(__dirname, '..', 'generator', 'src', 'index.ts');
  assertExists(indexPath);
  const content = fs.readFileSync(indexPath, 'utf8');
  assertIncludes(content, 'SchemaParser');
  assertIncludes(content, 'CodeGenerator');
  assertIncludes(content, 'MetadataGenerator');
  assertIncludes(content, 'GolangGenerator');
});

// ─── Generated output tests ──────────────────────────────────────────────────

console.log('\nGenerated Output:');

test('an5Client/typescript/index.ts exists', () => {
  const indexPath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'index.ts');
  assertExists(indexPath);
});

test('an5Client/typescript/base.ts exists with An5 namespace', () => {
  const basePath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'base.ts');
  assertExists(basePath);
  const content = fs.readFileSync(basePath, 'utf8');
  assertIncludes(content, 'namespace An5');
  assertIncludes(content, 'An5ClientKnownRequestError');
  assertIncludes(content, 'equals?: string');
  assertIncludes(content, 'equals?: number');
  assertIncludes(content, 'multiply?: number');
  assertIncludes(content, 'divide?: number');
  assertIncludes(content, 'AggregateArgs = any');
  assertIncludes(content, 'GroupByArgs = any');
  assertIncludes(content, 'aggregate(args: AggregateArgs)');
  assertIncludes(content, 'groupBy(args: GroupByArgs)');
});

test('an5Client/typescript model where inputs expose logical filters', () => {
  const userPath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'User.ts');
  assertExists(userPath);
  const content = fs.readFileSync(userPath, 'utf8');
  assertIncludes(content, 'AND?: UserWhereInput | UserWhereInput[]');
  assertIncludes(content, 'OR?: UserWhereInput[]');
  assertIncludes(content, 'NOT?: UserWhereInput | UserWhereInput[]');
});

test('code generator emits relation selects as part of the public contract', () => {
  const genPath = path.join(__dirname, '..', 'generator', 'src', 'code-generator.ts');
  assertExists(genPath);
  const content = fs.readFileSync(genPath, 'utf8');
  assertIncludes(content, "const selectRels = model.relations.map");
  assertIncludes(content, "?: boolean | ${r.type}FindManyArgs");
  assertIncludes(content, "_count?: boolean | { select?:");
});

test('an5Client/typescript groupBy args are model-aware', () => {
  const orderPath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'Order.ts');
  assertExists(orderPath);
  const content = fs.readFileSync(orderPath, 'utf8');
  assertIncludes(content, "export type OrderScalarFieldEnum = 'id' | 'userId' | 'total' | 'createdAt'");
  assertIncludes(content, 'export type OrderAggregateHavingInput = { _count?: { _all?: An5.NumberFilter | number');
  assertIncludes(content, 'export type OrderGroupByArgs = { by: OrderScalarFieldEnum | OrderScalarFieldEnum[]');
  assertIncludes(content, 'having?: OrderAggregateHavingInput');
  assertIncludes(content, '_sum?: { total?: true }');
  assertIncludes(content, 'OrderGroupByArgs');
});

test('an5Client/typescript aggregate args are model-aware', () => {
  const orderPath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'Order.ts');
  assertExists(orderPath);
  const content = fs.readFileSync(orderPath, 'utf8');
  assertIncludes(content, 'export type OrderAggregateArgs = { where?: OrderWhereInput');
  assertIncludes(content, '_sum?: { total?: true }');
  assertIncludes(content, '_avg?: { total?: true }');
  assertIncludes(content, 'OrderAggregateArgs');
});

test('an5Client/typescript/an5Metadata.ts exists', () => {
  const metaPath = path.join(__dirname, '..', '..', 'an5Client', 'typescript', 'an5Metadata.ts');
  assertExists(metaPath);
  const content = fs.readFileSync(metaPath, 'utf8');
  assertIncludes(content, 'modelToTable');
  assertIncludes(content, 'modelDescriptions');
  assertIncludes(content, 'relationMap');
  assertIncludes(content, 'modelFields');
  assertIncludes(content, 'description:');
});

test('an5Client/python files exist and have An5Client & models', () => {
  const pyDir = path.join(__dirname, '..', '..', 'an5Client', 'python');
  assertExists(path.join(pyDir, 'an5_metadata.py'));
  assertExists(path.join(pyDir, 'an5_models.py'));
  assertExists(path.join(pyDir, 'an5_client.py'));
  assertExists(path.join(pyDir, '__init__.py'));

  const metaContent = fs.readFileSync(path.join(pyDir, 'an5_metadata.py'), 'utf8');
  assertIncludes(metaContent, 'MODEL_TO_TABLE');
  assertIncludes(metaContent, 'MODEL_DESCRIPTIONS');
  assertIncludes(metaContent, 'MODEL_FIELDS');

  const modelsContent = fs.readFileSync(path.join(pyDir, 'an5_models.py'), 'utf8');
  assertIncludes(modelsContent, '@dataclass');
  assertIncludes(modelsContent, 'class User:');

  const clientContent = fs.readFileSync(path.join(pyDir, 'an5_client.py'), 'utf8');
  assertIncludes(clientContent, 'class An5Client:');
  assertIncludes(clientContent, 'self.users: AdapterTableClient');
});

test('an5Client/dotnet files exist with complete CRUD methods', () => {
  const dotnetDir = path.join(__dirname, '..', '..', 'an5Client', 'dotnet');
  assertExists(path.join(dotnetDir, 'User.cs'));
  assertExists(path.join(dotnetDir, 'Order.cs'));
  assertExists(path.join(dotnetDir, 'An5DbContext.cs'));

  const dbCtxContent = fs.readFileSync(path.join(dotnetDir, 'An5DbContext.cs'), 'utf8');
  assertIncludes(dbCtxContent, 'public int Count(');
  assertIncludes(dbCtxContent, 'public int CreateMany(');
  assertIncludes(dbCtxContent, 'public int UpdateMany(');
  assertIncludes(dbCtxContent, 'public int DeleteMany(');
  assertIncludes(dbCtxContent, 'public T Upsert(');
});

test('an5Client/golang files exist with models and generic client', () => {
  const goDir = path.join(__dirname, '..', '..', 'an5Client', 'golang');
  assertExists(path.join(goDir, 'models.go'));
  assertExists(path.join(goDir, 'client.go'));
  assertExists(path.join(goDir, 'config.go'));

  const modelsContent = fs.readFileSync(path.join(goDir, 'models.go'), 'utf8');
  assertIncludes(modelsContent, 'type User struct {');
  assertIncludes(modelsContent, 'type Order struct {');

  const clientContent = fs.readFileSync(path.join(goDir, 'client.go'), 'utf8');
  assertIncludes(clientContent, 'type An5DbContext struct');
  assertIncludes(clientContent, 'type TableClient[T any] struct');
  assertIncludes(clientContent, 'func (c *TableClient[T]) FindMany(');
  assertIncludes(clientContent, 'func (c *TableClient[T]) CreateMany(');
  assertIncludes(clientContent, 'func (c *TableClient[T]) VectorSearch(');
  assertIncludes(clientContent, 'direction := strings.ToUpper(fv.Elem().String())');
  assert.ok(!clientContent.includes('fv.Pointer()'), 'Go client must not convert reflect pointer to SortOrder');
});

test('golang generator emits safe SortOrder reflection', () => {
  const generatorPath = path.join(__dirname, '..', 'generator', 'src', 'golang-generator.ts');
  const content = fs.readFileSync(generatorPath, 'utf8');
  assertIncludes(content, 'direction := strings.ToUpper(fv.Elem().String())');
  assert.ok(!content.includes('fv.Pointer()'), 'Go generator must not emit invalid reflect pointer conversion');
});

// ─── ORM core file tests ─────────────────────────────────────────────────────

console.log('\nORM Core:');

test('an5Orm.ts exists with An5ORM class', () => {
  const ormPath = path.join(__dirname, '..', 'an5Orm.ts');
  assertExists(ormPath);
  const content = fs.readFileSync(ormPath, 'utf8');
  assertIncludes(content, 'class An5ORM');
  assertIncludes(content, 'class TableClient');
  assertIncludes(content, 'parseWhere');
  assertIncludes(content, 'buildOrderBy');
});

test('push.ts exists with push function', () => {
  const pushPath = path.join(__dirname, '..', 'push.ts');
  assertExists(pushPath);
  const content = fs.readFileSync(pushPath, 'utf8');
  assertIncludes(content, 'async function push');
  assertIncludes(content, 'CREATE TABLE');
});

test('pull.ts exists with pull function', () => {
  const pullPath = path.join(__dirname, '..', 'pull.ts');
  assertExists(pullPath);
  const content = fs.readFileSync(pullPath, 'utf8');
  assertIncludes(content, 'async function pull');
  assertIncludes(content, 'sys.tables');
});

test('seed.ts exists', () => {
  const seedPath = path.join(__dirname, '..', 'seed.ts');
  assertExists(seedPath);
});

test('cleanup.ts exists', () => {
  const cleanupPath = path.join(__dirname, '..', 'cleanup.ts');
  assertExists(cleanupPath);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

/**
 * an5Orm Unit Tests
 * Tests the REAL SQL helpers compiled to dist/sql-utils.js:
 *   quoteIdentifier, sanitizeParamName, normalizeSortDirection,
 *   toNonNegativeInt, buildOrderBy, parseWhere
 * Run: node test/unit.test.js
 */
const assert = require('assert');

const {
  quoteIdentifier,
  quoteTableIdentifier,
  sanitizeParamName,
  normalizeSortDirection,
  toNonNegativeInt,
  buildOrderBy,
  parseWhere,
} = require('../dist/sql-utils.js');

const {
  buildIndexDiff,
  buildAddColumnPreflightSql,
  buildAlterColumnWarnings,
  buildAlterColumnPreflightSql,
  buildUniqueConstraintPreflightSql,
  buildDownMigrationSql,
  buildMigrationFile,
  buildCreateTableSql,
  buildCreateViewSql,
  formatDbColumnSqlType,
  generateColumnDiff,
  generateDiff,
  mapDefault,
  parseMigrationCommandOptions,
  parseMigrationSections,
  parseRollbackSelection,
  parseSchemaText,
  quoteTableName,
  splitSqlBatches,
  tableIdentityName,
  verifyAppliedMigrations,
} = require('../dist/migration-core.js');

const {
  blockNameForObject,
  blockRange,
  buildViewBlock,
  qualifiedBlockKey,
  sqlServerTypeForColumn,
} = require('../dist/generator/src/pull-schema.js');

const { orderViewsByDependency } = require('../dist/generator/src/view-order.js');

// ─── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const pendingTests = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingTests.push(result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch((err) => {
        failed++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${err.message}`);
      }));
      return;
    }
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
    throw new Error(`${msg || 'Assertion failed'}: expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(str, substr, msg) {
  if (!str.includes(substr)) {
    throw new Error(`${msg || 'Assertion failed'}: "${str}" does not contain "${substr}"`);
  }
}

// ─── quoteIdentifier tests ───────────────────────────────────────────────────

console.log('\n=== an5Orm SQL Utils Tests ===\n');
console.log('quoteIdentifier:');

test('wraps a plain identifier in brackets', () => {
  assertEq(quoteIdentifier('name'), '[name]');
});

test('escapes embedded closing brackets', () => {
  assertEq(quoteIdentifier('name] OR 1=1 --'), '[name]] OR 1=1 --]');
});

test('handles empty string', () => {
  assertEq(quoteIdentifier(''), '[]');
});

console.log('\nquoteTableIdentifier:');

test('quotes bare table name', () => {
  assertEq(quoteTableIdentifier('users'), '[users]');
});

test('quotes schema-qualified table name', () => {
  assertEq(quoteTableIdentifier('dbo.users'), '[dbo].[users]');
});

test('preserves and normalizes already quoted multipart table name', () => {
  assertEq(quoteTableIdentifier('[dbo].[users]'), '[dbo].[users]');
});

test('escapes table name injection payload', () => {
  assertEq(quoteTableIdentifier('dbo.users] WITH (NOLOCK); DROP TABLE x--'), '[dbo].[users]] WITH (NOLOCK); DROP TABLE x--]');
});

// ─── sanitizeParamName tests ─────────────────────────────────────────────────

console.log('\nsanitizeParamName:');

test('keeps safe names unchanged', () => {
  assertEq(sanitizeParamName('age_gte'), 'age_gte');
});

test('replaces unsafe characters', () => {
  assertEq(sanitizeParamName('a b;DROP'), 'a_b_DROP');
});

test('prefixes names that do not start with a letter', () => {
  assertEq(sanitizeParamName('1abc'), 'p_1abc');
});

// ─── normalizeSortDirection tests ────────────────────────────────────────────

console.log('\nnormalizeSortDirection:');

test('accepts asc', () => {
  assertEq(normalizeSortDirection('asc'), 'ASC');
});

test('accepts desc', () => {
  assertEq(normalizeSortDirection('desc'), 'DESC');
});

test('rejects injection payload and defaults to ASC', () => {
  assertEq(normalizeSortDirection('desc; DROP TABLE users--'), 'ASC');
});

test('defaults non-string to ASC', () => {
  assertEq(normalizeSortDirection(123), 'ASC');
});

// ─── toNonNegativeInt tests ──────────────────────────────────────────────────

console.log('\ntoNonNegativeInt:');

test('parses positive integer', () => {
  assertEq(toNonNegativeInt('10'), 10);
});

test('falls back on negative', () => {
  assertEq(toNonNegativeInt('-5', 1), 1);
});

test('falls back on garbage', () => {
  assertEq(toNonNegativeInt('DROP TABLE users--', 10), 10);
});

test('falls back on undefined', () => {
  assertEq(toNonNegativeInt(undefined, 5), 5);
});

// ─── parseWhere tests ────────────────────────────────────────────────────────

console.log('\nparseWhere:');

test('simple equality is parameterized', () => {
  const params = {};
  const sql = parseWhere('user', { name: 'John' }, params);
  assertEq(sql, '[name] = @name');
  assertEq(params.name, 'John');
});

test('null value produces IS NULL', () => {
  const params = {};
  const sql = parseWhere('user', { email: null }, params);
  assertEq(sql, '[email] IS NULL');
});

test('equals operator is parameterized', () => {
  const params = {};
  const sql = parseWhere('user', { email: { equals: 'son@example.com' } }, params);
  assertEq(sql, '[email] = @email_equals');
  assertEq(params.email_equals, 'son@example.com');
});

test('equals null produces IS NULL', () => {
  const params = {};
  const sql = parseWhere('user', { email: { equals: null } }, params);
  assertEq(sql, '[email] IS NULL');
});

test('IN operator', () => {
  const params = {};
  const sql = parseWhere('user', { id: { in: ['a', 'b', 'c'] } }, params);
  assertIncludes(sql, '[id] IN (');
  assertEq(params.id_in_0, 'a');
  assertEq(params.id_in_1, 'b');
  assertEq(params.id_in_2, 'c');
});

test('empty IN produces 1 = 0', () => {
  const params = {};
  const sql = parseWhere('user', { id: { in: [] } }, params);
  assertEq(sql, '1 = 0');
});

test('NOT IN operator', () => {
  const params = {};
  const sql = parseWhere('user', { id: { notIn: ['x'] } }, params);
  assertIncludes(sql, '[id] NOT IN (');
});

test('empty NOT IN produces 1 = 1', () => {
  const params = {};
  const sql = parseWhere('user', { id: { notIn: [] } }, params);
  assertEq(sql, '1 = 1');
});

test('contains produces LIKE', () => {
  const params = {};
  const sql = parseWhere('user', { name: { contains: 'oh' } }, params);
  assertEq(sql, '[name] LIKE @name_contains');
  assertEq(params.name_contains, '%oh%');
});

test('startsWith produces LIKE', () => {
  const params = {};
  const sql = parseWhere('user', { name: { startsWith: 'Jo' } }, params);
  assertEq(sql, '[name] LIKE @name_startsWith');
  assertEq(params.name_startsWith, 'Jo%');
});

test('endsWith produces LIKE', () => {
  const params = {};
  const sql = parseWhere('user', { name: { endsWith: 'hn' } }, params);
  assertEq(sql, '[name] LIKE @name_endsWith');
  assertEq(params.name_endsWith, '%hn');
});

test('not operator', () => {
  const params = {};
  const sql = parseWhere('user', { status: { not: 'deleted' } }, params);
  assertEq(sql, '[status] <> @status_not');
  assertEq(params.status_not, 'deleted');
});

test('not null produces IS NOT NULL', () => {
  const params = {};
  const sql = parseWhere('user', { deletedAt: { not: null } }, params);
  assertEq(sql, '[deletedAt] IS NOT NULL');
});

test('nested not filter negates the nested predicate', () => {
  const params = {};
  const sql = parseWhere('user', { name: { not: { contains: 'bot' } } }, params);
  assertEq(sql, 'NOT ([name] LIKE @name_not_name_contains)');
  assertEq(params.name_not_name_contains, '%bot%');
});

test('gte operator', () => {
  const params = {};
  const sql = parseWhere('user', { age: { gte: 18 } }, params);
  assertEq(sql, '[age] >= @age_gte');
  assertEq(params.age_gte, 18);
});

test('lte operator', () => {
  const params = {};
  const sql = parseWhere('user', { age: { lte: 65 } }, params);
  assertEq(sql, '[age] <= @age_lte');
  assertEq(params.age_lte, 65);
});

test('gt operator', () => {
  const params = {};
  const sql = parseWhere('user', { age: { gt: 18 } }, params);
  assertEq(sql, '[age] > @age_gt');
});

test('lt operator', () => {
  const params = {};
  const sql = parseWhere('user', { age: { lt: 65 } }, params);
  assertEq(sql, '[age] < @age_lt');
});

test('AND conditions', () => {
  const params = {};
  const sql = parseWhere('user', { AND: [{ name: 'John' }, { age: 30 }] }, params);
  assertIncludes(sql, ' AND ');
  assertIncludes(sql, '[name] = @and_0_name');
  assertIncludes(sql, '[age] = @and_1_age');
});

test('AND accepts a single object', () => {
  const params = {};
  const sql = parseWhere('user', { AND: { name: 'John', age: 30 } }, params);
  assertIncludes(sql, '[name] = @and_0_name');
  assertIncludes(sql, '[age] = @and_0_age');
});

test('OR conditions', () => {
  const params = {};
  const sql = parseWhere('user', { OR: [{ name: 'John' }, { name: 'Jane' }] }, params);
  assertIncludes(sql, ' OR ');
  assertIncludes(sql, '[name] = @or_0_name');
  assertIncludes(sql, '[name] = @or_1_name');
});

test('NOT negates a where object', () => {
  const params = {};
  const sql = parseWhere('user', { NOT: { name: { startsWith: 'tmp' } } }, params);
  assertEq(sql, 'NOT ([name] LIKE @not_0_name_startsWith)');
  assertEq(params.not_0_name_startsWith, 'tmp%');
});

test('NOT accepts a where array', () => {
  const params = {};
  const sql = parseWhere('user', { NOT: [{ name: 'John' }, { age: { lt: 18 } }] }, params);
  assertEq(sql, 'NOT ([name] = @not_0_name OR [age] < @not_1_age_lt)');
});

test('multiple conditions combined', () => {
  const params = {};
  const sql = parseWhere('user', { name: 'John', age: { gte: 18 } }, params);
  assertIncludes(sql, ' AND ');
  assertIncludes(sql, '[name] = @name');
  assertIncludes(sql, '[age] >= @age_gte');
});

test('empty where returns empty string', () => {
  const sql = parseWhere('user', {}, {});
  assertEq(sql, '');
});

test('null where returns empty string', () => {
  const sql = parseWhere('user', null, {});
  assertEq(sql, '');
});

// ─── parseWhere relation tests (context-provided metadata) ──────────────────

console.log('\nparseWhere relations:');

const relationCtx = {
  relationMap: {
    order: {
      customer: { modelName: 'user', relationType: 'one', foreignKey: 'userId', localKey: 'id' },
      items: { modelName: 'orderItem', relationType: 'many', foreignKey: 'orderId', localKey: 'id' },
    },
    user: {},
    orderItem: {},
  },
  modelToTable: {
    order: '[dbo].[orders]',
    user: '[dbo].[users]',
    orderItem: '[dbo].[order_items]',
  },
};

test('one-to-one relation becomes IN subquery', () => {
  const params = {};
  const sql = parseWhere('order', { customer: { name: 'Son' } }, params, '', relationCtx);
  assertIncludes(sql, '[userId] IN (SELECT [id] FROM [dbo].[users] WITH (NOLOCK) WHERE [name] = @customer_name)');
});

test('many relation some operator', () => {
  const params = {};
  const sql = parseWhere('order', { items: { some: { qty: { gte: 2 } } } }, params, '', relationCtx);
  assertIncludes(sql, '[id] IN (SELECT [orderId] FROM [dbo].[order_items] WITH (NOLOCK) WHERE [qty] >= @items_qty_gte)');
});

test('many relation none operator', () => {
  const params = {};
  const sql = parseWhere('order', { items: { none: { qty: { gte: 2 } } } }, params, '', relationCtx);
  assertIncludes(sql, '[id] NOT IN (SELECT [orderId] FROM [dbo].[order_items] WITH (NOLOCK) WHERE [qty] >= @items_qty_gte)');
});

test('many relation every operator excludes non-matching children', () => {
  const params = {};
  const sql = parseWhere('order', { items: { every: { qty: { gte: 2 } } } }, params, '', relationCtx);
  assertIncludes(sql, '[id] NOT IN (SELECT [orderId] FROM [dbo].[order_items] WITH (NOLOCK) WHERE NOT ([qty] >= @items_qty_gte))');
  assertEq(params.items_qty_gte, 2);
});

test('many relation some empty object requires any child', () => {
  const params = {};
  const sql = parseWhere('order', { items: { some: {} } }, params, '', relationCtx);
  assertEq(sql, '[id] IN (SELECT [orderId] FROM [dbo].[order_items] WITH (NOLOCK))');
});

test('many relation none empty object requires no children', () => {
  const params = {};
  const sql = parseWhere('order', { items: { none: {} } }, params, '', relationCtx);
  assertEq(sql, '[id] NOT IN (SELECT [orderId] FROM [dbo].[order_items] WITH (NOLOCK))');
});

test('many relation every empty object is vacuously true', () => {
  const params = {};
  const sql = parseWhere('order', { items: { every: {} } }, params, '', relationCtx);
  assertEq(sql, '1 = 1');
});

// ─── buildOrderBy tests ──────────────────────────────────────────────────────

console.log('\nbuildOrderBy:');

test('single field ascending', () => {
  const sql = buildOrderBy({ name: 'asc' });
  assertEq(sql, ' ORDER BY [name] ASC');
});

test('single field descending', () => {
  const sql = buildOrderBy({ createdAt: 'desc' });
  assertEq(sql, ' ORDER BY [createdAt] DESC');
});

test('multiple fields', () => {
  const sql = buildOrderBy([{ name: 'asc' }, { age: 'desc' }]);
  assertIncludes(sql, '[name] ASC');
  assertIncludes(sql, '[age] DESC');
  assertIncludes(sql, ', ');
});

test('null returns empty', () => {
  const sql = buildOrderBy(null);
  assertEq(sql, '');
});

test('empty object returns empty', () => {
  const sql = buildOrderBy({});
  assertEq(sql, '');
});

// ─── SQL injection resistance ────────────────────────────────────────────────

console.log('\nSQL injection resistance:');

test('column name injection in where is neutralized', () => {
  const params = {};
  const sql = parseWhere('user', { 'name] = 1; DROP TABLE users--': 'x' }, params);
  // The whole payload is escaped inside a bracketed identifier, never executable SQL.
  assertEq(sql, '[name]] = 1; DROP TABLE users--] = @name____1__DROP_TABLE_users__');
  const keys = Object.keys(params);
  assertEq(keys.length, 1);
  assertEq(params[keys[0]], 'x');
});

test('orderBy injection is neutralized', () => {
  const sql = buildOrderBy({ 'name; DROP TABLE users--': 'desc' });
  assertEq(sql, ' ORDER BY [name; DROP TABLE users--] DESC');
});

test('orderBy direction injection is neutralized', () => {
  const sql = buildOrderBy({ name: 'desc; DROP TABLE users--' });
  assertEq(sql, ' ORDER BY [name] ASC');
});

test('values remain parameterized, never inlined', () => {
  const params = {};
  const sql = parseWhere('user', { name: "Robert'); DROP TABLE users;--" }, params);
  assertEq(sql, '[name] = @name');
  assertEq(params.name, "Robert'); DROP TABLE users;--");
});

// ─── migration-core tests ───────────────────────────────────────────────────

console.log('\nmigration-core:');

test('parseSchemaText keeps SQL fields and skips relation fields', () => {
  const models = parseSchemaText(`
    model Order {
      id NVARCHAR(64) @id
    }

    model User {
      id        NVARCHAR(64) @id
      email     NVARCHAR(255) @unique
      age       INT?
      orders    Order[]
      @@map("app_users")
      @@unique([email, age])
      @@index([age])
    }
  `);

  assertEq(models.length, 2);
  assertEq(models[1].tableName, 'app_users');
  assert.deepStrictEqual(models[1].fields.map((field) => field.name), ['id', 'email', 'age']);
  assert.deepStrictEqual(models[1].compoundUniques, [{ fields: ['email', 'age'] }]);
  assert.deepStrictEqual(models[1].indexes, [{ fields: ['age'] }]);
  assert.strictEqual(models[1].fields[2].isOptional, true);
});

test('parseSchemaText honours @@schema, which db:push and the generators read', () => {
  const [qualified] = parseSchemaText(`
    model Report {
      @@schema("analytics")
      @@map("daily_report")
      id NVARCHAR(64) @id
    }
  `);
  assertEq(qualified.tableName, 'analytics.daily_report');
  assertIncludes(buildCreateTableSql(qualified), 'CREATE TABLE [analytics].[daily_report]');

  // `dbo` stays implicit, so an unqualified model produces the SQL it always has.
  const [implicit] = parseSchemaText(`
    model Report {
      @@schema("dbo")
      id NVARCHAR(64) @id
    }
  `);
  assertEq(implicit.tableName, 'reports');
  assertIncludes(buildCreateTableSql(implicit), 'CREATE TABLE [reports]');

  // No directive at all: unchanged.
  const [plain] = parseSchemaText('model Report {\n  id NVARCHAR(64) @id\n}');
  assertEq(plain.tableName, 'reports');

  // Either order works, because the schema is composed once the model is read.
  const [mappedFirst] = parseSchemaText('model Report {\n  @@map("daily")\n  @@schema("analytics")\n  id NVARCHAR(64) @id\n}');
  assertEq(mappedFirst.tableName, 'analytics.daily');

  // A dot in the mapped name is part of the name, not a schema: `@@map` only ever
  // sets the table, and the schema comes from `@@schema` alone.
  const [dotted] = parseSchemaText('model Report {\n  @@map("reports.daily")\n  id NVARCHAR(64) @id\n}');
  assertEq(dotted.tableName, 'reports.daily');
});

test('parseSchemaText keeps mapped index and unique artifact names', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      email    NVARCHAR(255) @unique(map: "UQ_app_users_email")
      tenantId NVARCHAR(64)
      age      INT?
      @@unique([tenantId, email], map: "UQ_app_users_tenant_email")
      @@index([age], map: "IX_app_users_age_active", include: [email, tenantId], filter: "deletedAt IS NULL", options: "FILLFACTOR = 90, ONLINE = ON")
    }
  `);

  assertEq(model.fields.find((field) => field.name === 'email').uniqueName, 'UQ_app_users_email');
  assert.deepStrictEqual(model.compoundUniques, [{ fields: ['tenantId', 'email'], name: 'UQ_app_users_tenant_email' }]);
  assert.deepStrictEqual(model.indexes, [{ fields: ['age'], name: 'IX_app_users_age_active', includeFields: ['email', 'tenantId'], filter: 'deletedAt IS NULL', options: 'FILLFACTOR = 90, ONLINE = ON' }]);
});

test('parseSchemaText reads view blocks and their SQL', () => {
  const [view] = parseSchemaText(`
    view ActiveUser {
      id    NVARCHAR(64)
      email NVARCHAR(255)
      @@map("active_users")
      @@schema("reporting")
      @@sql("SELECT id, email FROM users WHERE active = 1")
    }
  `);

  assertEq(view.isView, true);
  assertEq(view.tableName, 'reporting.active_users');
  assert.deepStrictEqual(view.fields.map((field) => field.name), ['id', 'email']);
  assertEq(view.viewSql, 'SELECT id, email FROM users WHERE active = 1');
  assertIncludes(buildCreateViewSql(view), 'CREATE OR ALTER VIEW [reporting].[active_users] AS');
  assertIncludes(buildCreateViewSql(view), 'SELECT id, email FROM users WHERE active = 1');
});

test('a view without @@sql is reported', () => {
  assert.throws(
    () => parseSchemaText('view Broken {\n  id NVARCHAR(64)\n}'),
    (error) => error.name === 'FieldTypeError' && /a view needs @@sql/.test(error.issues[0].message),
  );
});

test('db:pull builds a view block from catalog columns and its definition', () => {
  const block = buildViewBlock({
    modelName: 'ActiveUser',
    viewName: 'active_users',
    schemaName: 'reporting',
    columns: [
      { columnName: 'id', dataType: 'nvarchar', maxLength: 128, precision: 0, scale: 0, isNullable: false },
      { columnName: 'label', dataType: 'decimal', maxLength: 9, precision: 18, scale: 2, isNullable: true },
    ],
    definition: 'CREATE VIEW [reporting].[active_users] AS\nSELECT id, label FROM users',
  });

  assertIncludes(block, 'view ActiveUser {');
  assertIncludes(block, 'id NVARCHAR(64)');
  assertIncludes(block, 'label DECIMAL(18, 2)?');
  assertIncludes(block, '@@map("active_users")');
  assertIncludes(block, '@@schema("reporting")');
  assertIncludes(block, '@@sql("""');
  assertIncludes(block, 'SELECT id, label FROM users');
  assert.ok(!block.includes('CREATE VIEW'), 'the CREATE header must not reach @@sql');

  // The block it writes must be accepted by the schema readers it feeds.
  const [view] = parseSchemaText(block);
  assertEq(view.name, 'ActiveUser');
  assertEq(view.isView, true);
  assertEq(view.tableName, 'reporting.active_users');
  assertEq(view.viewSql, 'SELECT id, label FROM users');

  assertEq(buildViewBlock({
    modelName: 'Broken', viewName: 'broken', schemaName: 'dbo', columns: [], definition: null,
  }), null);
});

test('db:pull finds a block whose SQL contains a closing brace', () => {
  const text = [
    'model User {',
    '  id INT @id',
    '}',
    '',
    'view Labels {',
    '  id INT',
    '  @@sql("""',
    "    SELECT '}' AS id",
    '  """)',
    '}',
    '',
  ].join('\n');

  const range = blockRange(text, 'view', 'Labels');
  assertEq(text.slice(range.start, range.end), [
    'view Labels {',
    '  id INT',
    '  @@sql("""',
    "    SELECT '}' AS id",
    '  """)',
    '}',
  ].join('\n'));
  assertEq(blockRange(text, 'view', 'Missing'), null);
  assertEq(qualifiedBlockKey('labels', 'dbo'), 'labels');
  assertEq(qualifiedBlockKey('labels', 'reporting'), 'reporting.labels');
});

test('db:pull names a new block from the object without mangling singular words', () => {
  assertEq(blockNameForObject('users'), 'User');
  assertEq(blockNameForObject('active_users'), 'ActiveUser');
  assertEq(blockNameForObject('order_items'), 'OrderItem');
  assertEq(blockNameForObject('user_status'), 'UserStatus');
  // Already singular, but ends in `s`: stripping it would produce `Statu`.
  assertEq(blockNameForObject('status'), 'Status');
  assertEq(blockNameForObject('addresses'), 'Address');
  assertEq(blockNameForObject('classes'), 'Class');
  assertEq(blockNameForObject('address'), 'Address');
  assertEq(blockNameForObject('analysis'), 'Analysis');
});

test('sqlServerTypeForColumn formats standard and native vector columns', () => {
  assertEq(sqlServerTypeForColumn({ columnName: 'name', dataType: 'nvarchar', maxLength: 200, precision: 0, scale: 0, isNullable: false }), 'NVARCHAR(100)');
  assertEq(sqlServerTypeForColumn({ columnName: 'body', dataType: 'varchar', maxLength: -1, precision: 0, scale: 0, isNullable: true }), 'VARCHAR(MAX)');
  assertEq(sqlServerTypeForColumn({ columnName: 'price', dataType: 'decimal', maxLength: 9, precision: 10, scale: 2, isNullable: false }), 'DECIMAL(10, 2)');
  assertEq(sqlServerTypeForColumn({ columnName: 'embedding', dataType: 'vector', maxLength: 6000, precision: 0, scale: 0, isNullable: true }), 'VECTOR');
  assertEq(sqlServerTypeForColumn({ columnName: 'embedding', dataType: 'vector', maxLength: 6000, precision: 0, scale: 0, isNullable: true, vectorDimensions: 1536 }), 'VECTOR(1536)');
  assertEq(sqlServerTypeForColumn({ columnName: 'embedding', dataType: 'vector', maxLength: 6000, precision: 0, scale: 0, isNullable: true, vectorDimensions: 1536, vectorBaseType: 'float32' }), 'VECTOR(1536)');
  assertEq(sqlServerTypeForColumn({ columnName: 'embedding', dataType: 'vector', maxLength: 6000, precision: 0, scale: 0, isNullable: true, vectorDimensions: 3072, vectorBaseType: 'float16' }), 'VECTOR(3072, float16)');
});

test('a model field cannot point at a view as a relation', () => {
  assert.throws(
    () => parseSchemaText(`
      model User {
        id    NVARCHAR(64) @id
        label ViewLabel
      }
      view ViewLabel {
        id NVARCHAR(64)
        @@sql("SELECT id FROM users")
      }
    `),
    (error) => error.name === 'FieldTypeError' && /is a view and cannot be the target of a relation/.test(error.issues[0].message),
  );
});

test('@@sql accepts a triple-quoted body spanning several lines', () => {
  const [view] = parseSchemaText(`
    view ActiveUser {
      id    NVARCHAR(64)
      @@map("active_users")
      @@sql("""
        SELECT id
        FROM users
        WHERE active = 1 AND name <> 'a)b'   -- a parenthesis inside a string
      """)
    }
  `);

  assertEq(view.viewSql, "SELECT id\nFROM users\nWHERE active = 1 AND name <> 'a)b'   -- a parenthesis inside a string");
  assertIncludes(buildCreateViewSql(view), 'FROM users\nWHERE active = 1');
});

test('the closing parenthesis may follow the triple quote on the next line', () => {
  const [view] = parseSchemaText(`
    view ActiveUser {
      id    NVARCHAR(64)
      @@map("active_users")
      @@sql("""
        SELECT id
        FROM users
        WHERE active = 1
      """
      )
    }
  `);

  assertEq(view.isView, true);
  assertEq(view.viewSql, 'SELECT id\nFROM users\nWHERE active = 1');
});

test('the @@definition alias reads a triple-quoted body too', () => {
  const [view] = parseSchemaText(`
    view ActiveUser {
      id NVARCHAR(64)
      @@map("active_users")
      @@definition("""
        SELECT id FROM users
      """)
    }
  `);

  assertEq(view.viewSql, 'SELECT id FROM users');
});

test('a pasted CREATE VIEW header is not repeated in the generated DDL', () => {
  const [view] = parseSchemaText(`
    view ActiveUser {
      id NVARCHAR(64)
      @@map("active_users")
      @@sql("CREATE VIEW [reporting].[someone_else] AS SELECT id FROM users")
    }
  `);

  const sql = buildCreateViewSql(view);
  assertEq((sql.match(/CREATE\s+(?:OR\s+ALTER\s+)?VIEW/gi) || []).length, 1);
  assertIncludes(sql, 'CREATE OR ALTER VIEW [active_users] AS\nSELECT id FROM users');
  assert.ok(!sql.includes('someone_else'), 'the pasted name must not survive');
});

test('generateDiff creates, replaces and reverts views', async () => {
  const models = parseSchemaText(`
    view ActiveUser {
      id NVARCHAR(64)
      @@map("active_users")
      @@sql("SELECT id FROM users WHERE active = 1")
    }
  `);

  const created = await generateDiff(models, [], async () => []);
  assert.deepStrictEqual(created.map((op) => op.type), ['CREATE_VIEW']);
  assertIncludes(created[0].sql, 'CREATE OR ALTER VIEW [active_users] AS');
  assertIncludes(buildDownMigrationSql(created), 'DROP VIEW [active_users]');

  // The catalog may return the full CREATE statement and reformatted whitespace.
  const unchanged = await generateDiff(
    models,
    [],
    async () => [],
    undefined,
    ['active_users'],
    async () => 'CREATE VIEW [active_users] AS\n  SELECT id FROM users WHERE active = 1',
  );
  assert.deepStrictEqual(unchanged, []);

  const changed = await generateDiff(
    models,
    [],
    async () => [],
    undefined,
    ['active_users'],
    async () => 'CREATE VIEW [active_users] AS SELECT id FROM users WHERE active = 0',
  );
  assert.deepStrictEqual(changed.map((op) => op.type), ['CREATE_VIEW']);
  assertIncludes(changed[0].details, 'changed');
  // Rolling back restores the definition the database had before.
  assertIncludes(buildDownMigrationSql(changed), 'WHERE active = 0');
});

test('dependent views are ordered after the view they read', async () => {
  // Declared backwards on purpose: a summary that reads a detail view.
  const models = parseSchemaText(`
    view UserSummary {
      id NVARCHAR(64)
      @@map("user_summary")
      @@sql("SELECT id FROM active_users")
    }
    view ActiveUser {
      id NVARCHAR(64)
      @@map("active_users")
      @@sql("SELECT id FROM users WHERE active = 1")
    }
  `);

  const ordered = orderViewsByDependency(models.map((model) => ({
    model,
    names: [model.tableName, model.name],
    sql: model.viewSql ?? '',
  })));
  assert.deepStrictEqual(ordered.ordered.map((entry) => entry.model.name), ['ActiveUser', 'UserSummary']);
  assertEq(ordered.cyclic, false);

  const ops = await generateDiff(models, [], async () => []);
  assert.deepStrictEqual(ops.map((op) => op.table), ['active_users', 'user_summary']);

  // A cycle cannot be satisfied by any creation order; keep the schema order.
  const cyclic = orderViewsByDependency([
    { names: ['A'], sql: 'SELECT * FROM b' },
    { names: ['B'], sql: 'SELECT * FROM a' },
  ]);
  assertEq(cyclic.cyclic, true);
  assert.deepStrictEqual(cyclic.ordered.map((entry) => entry.names[0]), ['A', 'B']);
});

test('a migration fences CREATE VIEW into its own batch', () => {  const text = buildMigrationFile('2026-11-03T00-00-00', [
    { type: 'CREATE_TABLE', table: 'users', sql: 'CREATE TABLE [users] ([id] INT)' },
    { type: 'CREATE_VIEW', table: 'active_users', sql: 'CREATE OR ALTER VIEW [active_users] AS\nSELECT id FROM users' },
  ]);

  assertIncludes(text, '\nGO\n-- CREATE_VIEW: active_users');
  assertIncludes(text, 'CREATE OR ALTER VIEW [active_users] AS\nSELECT id FROM users\nGO');
});

test('buildCreateTableSql maps defaults and constraints', () => {
  const [model] = parseSchemaText(`
    model Session {
      id        UNIQUEIDENTIFIER @id @default(uuid())
      createdAt DATETIME2 @default(now())
      active    BIT @default(true)
      label     NVARCHAR(255) @default("owner's")
    }
  `);

  const sql = buildCreateTableSql(model);
  assertIncludes(sql, '[id] UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()');
  // A default does not make the column nullable.
  assertIncludes(sql, '[createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP');
  assertIncludes(sql, '[active] BIT NOT NULL DEFAULT 1');
  assertIncludes(sql, "[label] NVARCHAR(255) NOT NULL DEFAULT 'owner''s'");
});

test('buildCreateTableSql includes compound unique constraints', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      tenantId NVARCHAR(64)
      email    NVARCHAR(255)
      @@unique([tenantId, email])
    }
  `);

  const sql = buildCreateTableSql(model);
  assertIncludes(sql, 'CONSTRAINT [UQ_users_compound_0] UNIQUE ([tenantId], [email])');
});

test('buildCreateTableSql uses mapped unique constraint names', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      email    NVARCHAR(255) @unique(map: "UQ_app_users_email")
      tenantId NVARCHAR(64)
      @@unique([tenantId, email], map: "UQ_app_users_tenant_email")
    }
  `);

  const sql = buildCreateTableSql(model);
  assertIncludes(sql, '[email] NVARCHAR(255) NOT NULL CONSTRAINT [UQ_app_users_email] UNIQUE');
  assertIncludes(sql, 'CONSTRAINT [UQ_app_users_tenant_email] UNIQUE ([tenantId], [email])');
});

test('generateColumnDiff emits additive and non-destructive drift SQL', () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      email NVARCHAR(255)
      age   INT?
    }
  `);
  const ops = [];

  generateColumnDiff(model, [
    { columnName: 'id', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: true, isIdentity: false },
    { columnName: 'legacy', dataType: 'int', isNullable: true, isPrimaryKey: false, isIdentity: false },
  ], ops);

  assert.deepStrictEqual(ops.map((op) => op.type), ['ADD_COLUMN', 'ADD_COLUMN', 'DROP_COLUMN']);
  assertEq(ops[0].sql, 'ALTER TABLE [users] ADD [email] NVARCHAR(255) NOT NULL');
  assertIncludes(ops[0].preflightSql[0], 'is NOT NULL without a default on a non-empty table');
  assertEq(ops[1].sql, 'ALTER TABLE [users] ADD [age] INT');
  assertEq(ops[2].sql, '-- ALTER TABLE [users] DROP COLUMN [legacy]');
});

test('generateColumnDiff uses mapped unique name for additive unique columns', () => {
  const [model] = parseSchemaText(`
    model User {
      email NVARCHAR(255) @unique(map: "UQ_app_users_email")
    }
  `);
  const ops = [];

  generateColumnDiff(model, [], ops);

  assertEq(ops[0].sql, 'ALTER TABLE [users] ADD [email] NVARCHAR(255) NOT NULL CONSTRAINT [UQ_app_users_email] UNIQUE');
});

test('formatDbColumnSqlType reconstructs common SQL Server type parameters', () => {
  assertEq(formatDbColumnSqlType({ columnName: 'name', dataType: 'nvarchar', maxLength: 510, isNullable: true, isPrimaryKey: false, isIdentity: false }), 'NVARCHAR(255)');
  assertEq(formatDbColumnSqlType({ columnName: 'payload', dataType: 'varbinary', maxLength: -1, isNullable: true, isPrimaryKey: false, isIdentity: false }), 'VARBINARY(MAX)');
  assertEq(formatDbColumnSqlType({ columnName: 'price', dataType: 'decimal', precision: 12, scale: 2, isNullable: false, isPrimaryKey: false, isIdentity: false }), 'DECIMAL(12,2)');
  assertEq(formatDbColumnSqlType({ columnName: 'createdAt', dataType: 'datetime2', scale: 7, isNullable: false, isPrimaryKey: false, isIdentity: false }), 'DATETIME2(7)');
});

test('generateColumnDiff records previous column metadata for rollback', () => {
  const [model] = parseSchemaText(`
    model User {
      name NVARCHAR(500)?
    }
  `);
  const ops = [];

  generateColumnDiff(model, [
    { columnName: 'name', dataType: 'nvarchar', maxLength: 510, isNullable: false, isPrimaryKey: false, isIdentity: false },
  ], ops);

  assertEq(ops.length, 1);
  assertEq(ops[0].type, 'ALTER_COLUMN');
  assertEq(ops[0].previousSqlType, 'NVARCHAR(255)');
  assert.strictEqual(ops[0].previousNullable, false);
  assertIncludes(ops[0].details, 'type NVARCHAR(255) -> NVARCHAR(500)');
});

test('buildAlterColumnWarnings flags risky shrink and nullability changes', () => {
  assert.deepStrictEqual(buildAlterColumnWarnings('NVARCHAR(MAX)', 'NVARCHAR(255)', true, false), [
    'Column size changes from NVARCHAR(MAX) to NVARCHAR(255); existing values may be truncated or block migration.',
    'Column changes from NULL to NOT NULL; existing NULL values must be cleaned before applying.',
  ]);
  assert.deepStrictEqual(buildAlterColumnWarnings('DECIMAL(12,4)', 'DECIMAL(10,2)', false, false), [
    'Column precision shrinks from DECIMAL(12,4) to DECIMAL(10,2); existing numeric values may not fit.',
    'Column scale shrinks from DECIMAL(12,4) to DECIMAL(10,2); existing numeric values may lose fractional precision.',
  ]);
});

test('buildAlterColumnPreflightSql creates live data checks', () => {
  const checks = buildAlterColumnPreflightSql('dbo.users', 'name', 'NVARCHAR(MAX)', 'NVARCHAR(255)', true, false);
  assert.strictEqual(checks.length, 2);
  assertIncludes(checks[0], 'WHERE [name] IS NULL');
  assertIncludes(checks[1], 'LEN([name]) > 255');

  const decimalChecks = buildAlterColumnPreflightSql('dbo.invoices', 'amount', 'DECIMAL(12,4)', 'DECIMAL(10,2)', false, false);
  assert.strictEqual(decimalChecks.length, 1);
  assertIncludes(decimalChecks[0], 'TRY_CONVERT(DECIMAL(10,2), [amount]) IS NULL');
});

test('buildAddColumnPreflightSql guards non-empty tables for required and unique columns', () => {
  const requiredChecks = buildAddColumnPreflightSql('dbo.users', {
    name: 'email',
    sqlType: 'NVARCHAR(255)',
    isOptional: false,
    isId: false,
    isUnique: false,
  });
  assert.strictEqual(requiredChecks.length, 1);
  assertIncludes(requiredChecks[0], 'IF EXISTS (SELECT 1 FROM [dbo].[users])');
  assertIncludes(requiredChecks[0], 'is NOT NULL without a default on a non-empty table');

  const uniqueChecks = buildAddColumnPreflightSql('dbo.users', {
    name: 'code',
    sqlType: 'NVARCHAR(64)',
    isOptional: true,
    isId: false,
    isUnique: true,
  });
  assert.strictEqual(uniqueChecks.length, 1);
  assertIncludes(uniqueChecks[0], 'COUNT_BIG(*) FROM [dbo].[users]');
  assertIncludes(uniqueChecks[0], 'new UNIQUE column');
});

test('buildUniqueConstraintPreflightSql detects duplicate key groups', () => {
  const checks = buildUniqueConstraintPreflightSql('dbo.users', ['tenantId', 'email']);
  assert.strictEqual(checks.length, 1);
  assertIncludes(checks[0], 'GROUP BY [tenantId], [email]');
  assertIncludes(checks[0], 'HAVING COUNT_BIG(*) > 1');
});

test('buildMigrationFile writes risk warnings before SQL', () => {
  const text = buildMigrationFile('2026-08-11T00-00-00', [
    {
      type: 'ALTER_COLUMN',
      table: 'users',
      column: 'name',
      sql: 'ALTER TABLE [users] ALTER COLUMN [name] NVARCHAR(100) NOT NULL',
      previousSqlType: 'NVARCHAR(255)',
      previousNullable: true,
      riskWarnings: [
        'Column size shrinks from NVARCHAR(255) to NVARCHAR(100); existing values may be truncated or block migration.',
      ],
    },
  ]);

  assertIncludes(text, '-- WARNING: Column size shrinks from NVARCHAR(255) to NVARCHAR(100); existing values may be truncated or block migration.');
  assert.ok(text.indexOf('-- WARNING:') < text.indexOf('ALTER TABLE [users] ALTER COLUMN'));
});

test('buildMigrationFile writes preflight section before up section', () => {
  const text = buildMigrationFile('2026-08-11T00-00-00', [
    {
      type: 'ALTER_COLUMN',
      table: 'users',
      column: 'name',
      sql: 'ALTER TABLE [users] ALTER COLUMN [name] NVARCHAR(100) NOT NULL',
      preflightSql: ['IF EXISTS (SELECT 1 FROM [users] WHERE [name] IS NULL) THROW 51000, \'fail\', 1'],
    },
  ]);

  assertIncludes(text, '-- migrate:preflight');
  assert.ok(text.indexOf('-- migrate:preflight') < text.indexOf('-- migrate:up'));
  assertIncludes(text, 'IF EXISTS (SELECT 1 FROM [users] WHERE [name] IS NULL)');
});

test('buildIndexDiff emits missing index and compound unique operations', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      tenantId NVARCHAR(64)
      email    NVARCHAR(255) @unique
      age      INT?
      @@unique([tenantId, email])
      @@index([age])
    }
  `);
  const ops = [];

  buildIndexDiff(model, { indexes: [], uniqueConstraints: [] }, ops);

  assert.deepStrictEqual(ops.map((op) => op.type), ['ADD_UNIQUE', 'ADD_UNIQUE', 'ADD_INDEX']);
  assertEq(ops[0].sql, 'ALTER TABLE [users] ADD CONSTRAINT [UQ_users_email] UNIQUE ([email])');
  assertIncludes(ops[0].preflightSql[0], 'GROUP BY [email]');
  assertEq(ops[1].sql, 'ALTER TABLE [users] ADD CONSTRAINT [UQ_users_compound_0] UNIQUE ([tenantId], [email])');
  assertIncludes(ops[1].preflightSql[0], 'GROUP BY [tenantId], [email]');
  assertEq(ops[2].sql, 'CREATE INDEX [IX_users_age] ON [users] ([age])');
});

test('buildIndexDiff skips existing named artifacts', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      tenantId NVARCHAR(64)
      email    NVARCHAR(255) @unique
      age      INT?
      @@unique([tenantId, email])
      @@index([age])
    }
  `);
  const ops = [];

  buildIndexDiff(model, {
    indexes: ['IX_users_age'],
    uniqueConstraints: ['UQ_users_email', 'UQ_users_compound_0'],
  }, ops);

  assertEq(ops.length, 0);
});

test('buildIndexDiff uses mapped artifact names', () => {
  const [model] = parseSchemaText(`
    model User {
      id       NVARCHAR(64) @id
      tenantId NVARCHAR(64)
      email    NVARCHAR(255) @unique(map: "UQ_app_users_email")
      age      INT?
      @@unique([tenantId, email], map: "UQ_app_users_tenant_email")
      @@index([age], map: "IX_app_users_age_active", include: [email, tenantId], filter: "deletedAt IS NULL", options: "FILLFACTOR = 90, ONLINE = ON")
    }
  `);
  const ops = [];

  buildIndexDiff(model, { indexes: [], uniqueConstraints: [] }, ops);

  assert.deepStrictEqual(ops.map((op) => op.type), ['ADD_UNIQUE', 'ADD_UNIQUE', 'ADD_INDEX']);
  assertEq(ops[0].sql, 'ALTER TABLE [users] ADD CONSTRAINT [UQ_app_users_email] UNIQUE ([email])');
  assertEq(ops[1].sql, 'ALTER TABLE [users] ADD CONSTRAINT [UQ_app_users_tenant_email] UNIQUE ([tenantId], [email])');
  assertEq(ops[2].sql, 'CREATE INDEX [IX_app_users_age_active] ON [users] ([age]) INCLUDE ([email], [tenantId]) WHERE deletedAt IS NULL WITH (FILLFACTOR = 90, ONLINE = ON)');
  assertEq(ops[2].details, 'age include email, tenantId filter deletedAt IS NULL options FILLFACTOR = 90, ONLINE = ON');

  const matched = [];
  buildIndexDiff(model, {
    indexes: ['IX_app_users_age_active'],
    uniqueConstraints: ['UQ_app_users_email', 'UQ_app_users_tenant_email'],
  }, matched);
  assertEq(matched.length, 0);
});

test('buildIndexDiff reports stale managed artifacts as commented drops', () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      email NVARCHAR(255)
      age   INT?
      @@index([age])
    }
  `);
  const ops = [];

  buildIndexDiff(model, {
    indexes: ['IX_users_age', 'IX_users_legacy', 'custom_reporting_idx'],
    uniqueConstraints: ['UQ_users_email', 'UQ_users_compound_0', 'custom_unique'],
  }, ops);

  assert.deepStrictEqual(ops.map((op) => op.type), ['DROP_INDEX', 'DROP_UNIQUE', 'DROP_UNIQUE']);
  assertEq(ops[0].sql, '-- DROP INDEX [IX_users_legacy] ON [users]');
  assertEq(ops[1].sql, '-- ALTER TABLE [users] DROP CONSTRAINT [UQ_users_email]');
  assertEq(ops[2].sql, '-- ALTER TABLE [users] DROP CONSTRAINT [UQ_users_compound_0]');
  assert.ok(!ops.some((op) => String(op.sql).includes('custom_')));
});

test('generateDiff does not duplicate inline unique constraints for new tables', async () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      email NVARCHAR(255) @unique
      age   INT?
      @@unique([email, age])
      @@index([age])
    }
  `);

  const ops = await generateDiff([model], [], async () => []);

  assert.deepStrictEqual(ops.map((op) => op.type), ['CREATE_TABLE', 'ADD_INDEX']);
  // Named, not bare UNIQUE: a database-generated name cannot be matched by the
  // next diff, which would then add a second unique for the same column.
  assertIncludes(ops[0].sql, '[email] NVARCHAR(255) NOT NULL CONSTRAINT [UQ_users_email] UNIQUE');
  assertEq(ops[1].sql, 'CREATE INDEX [IX_users_age] ON [users] ([age])');
});

test('generateDiff emits mapped advanced index metadata for existing tables', async () => {
  const [model] = parseSchemaText(`
    model User {
      id        NVARCHAR(64) @id
      email     NVARCHAR(255)
      tenantId  NVARCHAR(64)
      age       INT?
      deletedAt DATETIME2?
      @@index([age], map: "IX_app_users_age_active", include: [email, tenantId], filter: "deletedAt IS NULL", options: "FILLFACTOR = 90")
    }
  `);

  const ops = await generateDiff([model], ['users'], async () => [
    { columnName: 'id', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: true, isIdentity: false },
    { columnName: 'email', dataType: 'nvarchar', maxLength: 510, isNullable: false, isPrimaryKey: false, isIdentity: false },
    { columnName: 'tenantId', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: false, isIdentity: false },
    { columnName: 'age', dataType: 'int', isNullable: true, isPrimaryKey: false, isIdentity: false },
    { columnName: 'deletedAt', dataType: 'datetime2', isNullable: true, isPrimaryKey: false, isIdentity: false },
  ], async () => ({ indexes: [], uniqueConstraints: [] }));

  assert.deepStrictEqual(ops.map((op) => op.type), ['ADD_INDEX']);
  assertEq(ops[0].sql, 'CREATE INDEX [IX_app_users_age_active] ON [users] ([age]) INCLUDE ([email], [tenantId]) WHERE deletedAt IS NULL WITH (FILLFACTOR = 90)');
});

test('generateDiff names a new unique column instead of adding the constraint twice', async () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      email NVARCHAR(255) @unique
    }
  `);

  const ops = await generateDiff(
    [model],
    ['users'],
    async () => [
      { columnName: 'id', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: true, isIdentity: false },
    ],
    async () => ({ indexes: [], uniqueConstraints: [] }),
  );

  assert.deepStrictEqual(ops.map((op) => op.type), ['ADD_COLUMN']);
  assertEq(ops[0].sql, 'ALTER TABLE [users] ADD [email] NVARCHAR(255) NOT NULL CONSTRAINT [UQ_users_email] UNIQUE');
});

test('generateDiff is stable once the named unique has been applied', async () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      email NVARCHAR(255) @unique
    }
  `);
  const columns = [
    { columnName: 'id', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: true, isIdentity: false },
    { columnName: 'email', dataType: 'nvarchar', maxLength: 510, isNullable: false, isPrimaryKey: false, isIdentity: false },
  ];

  const ops = await generateDiff(
    [model],
    ['users'],
    async () => columns,
    async () => ({ indexes: [], uniqueConstraints: ['UQ_users_email'] }),
  );

  assert.deepStrictEqual(ops, []);
});

test('@default stops at its own closing parenthesis, before @description', () => {
  const [model] = parseSchemaText(`
    model Order {
      id        NVARCHAR(64)  @id @default(uuid()) @description("Primary key (generated)")
      total     INT           @default(0) @description("Amount")
      createdAt DATETIME2     @default(now()) @description("Created at")
    }
  `);

  assert.deepStrictEqual(model.fields.map((field) => field.defaultValue), ['uuid()', '0', 'now()']);
  const sql = buildCreateTableSql(model);
  assertIncludes(sql, '[id] NVARCHAR(64) PRIMARY KEY DEFAULT NEWID()');
  assertIncludes(sql, '[total] INT NOT NULL DEFAULT 0');
  assertIncludes(sql, '[createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP');
  assert.ok(!sql.includes('@description'), `description leaked into DDL:\n${sql}`);
});

test('@@index options survive parentheses inside a filter expression', () => {
  const [model] = parseSchemaText(`
    model User {
      id    NVARCHAR(64) @id
      score INT
      @@index([score], filter: "(score > 0)", options: "FILLFACTOR = 90")
    }
  `);

  assert.deepStrictEqual(model.indexes[0], {
    fields: ['score'],
    filter: '(score > 0)',
    options: 'FILLFACTOR = 90',
  });

  const ops = [];
  buildIndexDiff(model, { indexes: [], uniqueConstraints: [] }, ops);
  assertIncludes(ops[0].sql, 'WHERE (score > 0) WITH (FILLFACTOR = 90)');
});

test('verifyAppliedMigrations reports changed and missing files', () => {
  const applied = [
    { id: '2026_01.sql', checksum: 'aaa' },
    { id: '2026_02.sql', checksum: 'bbb' },
    { id: '2026_03.sql', checksum: 'ccc' },
  ];
  const files = {
    '2026_01.sql': 'one',
    '2026_02.sql': 'changed',
    '2026_03.sql': null,
  };
  const checksum = (content) => ({ one: 'aaa', changed: 'different' })[content] ?? 'unknown';

  assert.deepStrictEqual(
    verifyAppliedMigrations(applied, (id) => files[id] ?? null, checksum),
    { changed: ['2026_02.sql'], missing: ['2026_03.sql'] },
  );
});

test('generateDiff matches dbo-qualified schema tables with unqualified introspection names', async () => {
  const [model] = parseSchemaText(`
    model User {
      id NVARCHAR(64) @id
      @@map("dbo.users")
    }
  `);
  const introspected = [];

  const ops = await generateDiff([model], ['users'], async (tableName) => {
    introspected.push(tableName);
    return [
      { columnName: 'id', dataType: 'nvarchar', maxLength: 128, isNullable: false, isPrimaryKey: true, isIdentity: false },
    ];
  });

  assert.deepStrictEqual(ops, []);
  assert.deepStrictEqual(introspected, ['dbo.users']);
});

test('mapDefault keeps generated SQL literal-safe', () => {
  assertEq(mapDefault('"owner\'s"'), "DEFAULT 'owner''s'");
});

test('quoteTableName handles schema-qualified table names', () => {
  assertEq(quoteTableName('dbo.users'), '[dbo].[users]');
  assertEq(quoteTableName('[sales].[orders]'), '[sales].[orders]');
});

test('tableIdentityName normalizes default dbo schema only', () => {
  assertEq(tableIdentityName('users'), 'users');
  assertEq(tableIdentityName('dbo.users'), 'users');
  assertEq(tableIdentityName('[dbo].[users]'), 'users');
  assertEq(tableIdentityName('sales.orders'), 'sales.orders');
});

test('buildDownMigrationSql reverses additive migration operations', () => {
  const sql = buildDownMigrationSql([
    { type: 'CREATE_TABLE', table: 'users', sql: 'CREATE TABLE [users] ([id] INT)' },
    { type: 'ADD_COLUMN', table: 'users', column: 'email', sql: 'ALTER TABLE [users] ADD [email] NVARCHAR(255)' },
    { type: 'ADD_INDEX', table: 'users', sql: 'CREATE INDEX [IX_users_email] ON [users] ([email])' },
    { type: 'ADD_UNIQUE', table: 'users', sql: 'ALTER TABLE [users] ADD CONSTRAINT [UQ_users_compound_0] UNIQUE ([email])' },
  ]);

  assert.deepStrictEqual(sql.split('\nGO\n'), [
    'ALTER TABLE [users] DROP CONSTRAINT [UQ_users_compound_0]',
    'DROP INDEX [IX_users_email] ON [users]',
    'ALTER TABLE [users] DROP COLUMN [email]',
    'DROP TABLE [users]',
  ]);
});

test('buildDownMigrationSql marks unsafe operations as manual', () => {
  const sql = buildDownMigrationSql([
    { type: 'ALTER_COLUMN', table: 'users', column: 'name', sql: 'ALTER TABLE [users] ALTER COLUMN [name] NVARCHAR(500)' },
    { type: 'DROP_TABLE', table: 'legacy', sql: '-- DROP TABLE [legacy]' },
  ]);

  assertEq(sql, '-- Manual rollback required for ALTER_COLUMN: users.name');
});

test('buildDownMigrationSql reverses alter column when previous metadata exists', () => {
  const sql = buildDownMigrationSql([
    {
      type: 'ALTER_COLUMN',
      table: 'users',
      column: 'name',
      sql: 'ALTER TABLE [users] ALTER COLUMN [name] NVARCHAR(500) NULL',
      previousSqlType: 'NVARCHAR(255)',
      previousNullable: false,
    },
  ]);

  assertEq(sql, 'ALTER TABLE [users] ALTER COLUMN [name] NVARCHAR(255) NOT NULL');
});

test('buildMigrationFile writes generated down SQL when available', () => {
  const text = buildMigrationFile('2026-08-11T00-00-00', [
    { type: 'CREATE_TABLE', table: 'users', sql: 'CREATE TABLE [users] ([id] INT)' },
  ]);
  assertIncludes(text, '-- migrate:up');
  assertIncludes(text, 'CREATE TABLE [users] ([id] INT)');
  assertIncludes(text, '-- migrate:down');
  assertIncludes(text, 'DROP TABLE [users]');
});

test('parseMigrationSections treats legacy files as up-only migrations', () => {
  const sections = parseMigrationSections('CREATE TABLE [users] ([id] INT)');
  assertEq(sections.preflight, '');
  assertEq(sections.up, 'CREATE TABLE [users] ([id] INT)');
  assertEq(sections.down, '');
  assert.strictEqual(sections.hasDown, false);
});

test('parseMigrationSections splits up and down SQL', () => {
  const sections = parseMigrationSections(`
    -- migrate:preflight
    SELECT 1
    -- migrate:up
    CREATE TABLE [users] ([id] INT)
    -- migrate:down
    DROP TABLE [users]
  `);
  assertIncludes(sections.preflight, 'SELECT 1');
  assertIncludes(sections.up, 'CREATE TABLE [users]');
  assertIncludes(sections.down, 'DROP TABLE [users]');
  assert.strictEqual(sections.hasDown, true);
});

test('splitSqlBatches splits GO and drops comment-only batches', () => {
  assert.deepStrictEqual(splitSqlBatches(`
    -- comment only
    GO
    CREATE TABLE [users] ([id] INT)
    GO
    INSERT INTO [users] ([id]) VALUES (1)
  `), [
    'CREATE TABLE [users] ([id] INT)',
    'INSERT INTO [users] ([id]) VALUES (1)',
  ]);
});

test('parseRollbackSelection defaults to latest migration', () => {
  assert.deepStrictEqual(parseRollbackSelection([], [{ id: '001.sql' }, { id: '002.sql' }]), {
    count: 1,
    label: 'latest migration',
  });
});

test('parseRollbackSelection accepts positive step count', () => {
  assert.deepStrictEqual(parseRollbackSelection(['2'], [{ id: '001.sql' }, { id: '002.sql' }, { id: '003.sql' }]), {
    count: 2,
    label: '2 migrations',
  });
});

test('parseRollbackSelection accepts --to applied migration target', () => {
  assert.deepStrictEqual(parseRollbackSelection(['--to', '002.sql'], [
    { id: '001.sql' },
    { id: '002.sql' },
    { id: '003.sql' },
  ]), {
    count: 2,
    label: 'through 002.sql',
  });
});

test('parseRollbackSelection rejects invalid target and steps', () => {
  assert.throws(() => parseRollbackSelection(['0'], [{ id: '001.sql' }]), /positive integer/);
  assert.throws(() => parseRollbackSelection(['--to', 'missing.sql'], [{ id: '001.sql' }]), /not applied/);
});

test('parseMigrationCommandOptions extracts preview flag', () => {
  assert.throws(() => parseMigrationCommandOptions(['--dry-run']), /Unknown migration option/);
  assert.throws(() => parseMigrationCommandOptions(['--unknown-option']), /Unknown migration option/);
  assert.deepStrictEqual(parseMigrationCommandOptions(['--preview', '2']), {
    preview: true,
    rest: ['2'],
  });
  assert.deepStrictEqual(parseMigrationCommandOptions(['--to', '001.sql']), {
    preview: false,
    rest: ['--to', '001.sql'],
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

Promise.all(pendingTests).then(() => {
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
});

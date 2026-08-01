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
  sanitizeParamName,
  normalizeSortDirection,
  toNonNegativeInt,
  buildOrderBy,
  parseWhere,
} = require('../dist/sql-utils.js');

// ─── Test harness ────────────────────────────────────────────────────────────

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

test('OR conditions', () => {
  const params = {};
  const sql = parseWhere('user', { OR: [{ name: 'John' }, { name: 'Jane' }] }, params);
  assertIncludes(sql, ' OR ');
  assertIncludes(sql, '[name] = @or_0_name');
  assertIncludes(sql, '[name] = @or_1_name');
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

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);

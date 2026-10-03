const assert = require('node:assert/strict');
const { test: nodeTest } = require('node:test');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (error) {
  if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
}
const test = (name, fn) => nodeTest(name, { skip: !DatabaseSync && 'SQLite regression tests require Node.js 22.13+' }, fn);
const { parseWhere } = require('../dist/sql-utils.js');

for (const [name, where, expected] of [
  ['empty OR matches no rows', { OR: [] }, []],
  ['OR containing an empty condition matches all rows', { OR: [{}, { id: 1 }] }, [1, 2, 3]],
  ['NOT an empty condition matches no rows', { NOT: {} }, []],
  ['empty NOT array matches all rows', { NOT: [] }, [1, 2, 3]],
  ['NOT array excludes each condition', { NOT: [{ id: 1 }, { id: 2 }] }, [3]],
  ['optional undefined filter is omitted', { id: undefined }, [1, 2, 3]],
]) {
  test(name, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE users (id INTEGER); INSERT INTO users VALUES (1), (2), (3)');
      const params = {};
      const sql = parseWhere('User', where, params);
      assert.deepEqual(db.prepare(`SELECT id FROM users${sql ? ` WHERE ${sql}` : ''} ORDER BY id`).all(params).map(row => row.id), expected);
    } finally { db.close(); }
  });
}

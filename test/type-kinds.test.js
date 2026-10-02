/**
 * Field kinds: what a column *is*, for the generators that need a real type.
 *
 * The behaviour worth protecting is that the declared type decides. Every generator
 * receives the same TypeScript type, and it collapses `INT`, `FLOAT` and `DECIMAL`
 * into `number` — so before this existed the Go client generated every numeric
 * column as a `string`, and the Python, Rust and .NET clients typed a `DECIMAL` as
 * an integer.
 *
 * Run: node --test test/type-kinds.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const distSrc = path.join(__dirname, '..', 'dist', 'generator', 'src');
assert.ok(fs.existsSync(path.join(distSrc, 'type-kinds.js')), `Expected built type-kinds at ${distSrc}`);
const { fieldKind } = require(path.join(distSrc, 'type-kinds.js'));

// The TypeScript type the parser produces for each declared type, per provider. Only
// the numeric row matters here: it is the one the generators got wrong.
const tsTypeOf = {
  INT: 'number', BIGINT: 'number | bigint', FLOAT: 'number', REAL: 'number', DECIMAL: 'number',
  NUMERIC: 'number', MONEY: 'number', SMALLMONEY: 'number', TINYINT: 'number', SMALLINT: 'number',
  INTEGER: 'number', MEDIUMINT: 'number', SERIAL: 'number', BIGSERIAL: 'number',
  DOUBLE: 'number', 'DOUBLE PRECISION': 'number',
  BIT: 'boolean', BOOLEAN: 'boolean',
  NVARCHAR: 'string', VARCHAR: 'string', TEXT: 'string', CHAR: 'string', SYSNAME: 'string',
  UNIQUEIDENTIFIER: 'string', UUID: 'string',
  DATETIME2: 'Date', DATETIME: 'Date', DATE: 'Date', DATETIMEOFFSET: 'Date', TIME: 'Date', TIMESTAMPTZ: 'Date',
  VARBINARY: 'Buffer', BLOB: 'Buffer', BYTEA: 'Buffer', ROWVERSION: 'Buffer',
  TIMESTAMP: { mssql: 'Buffer', default: 'Date' },
  JSON: 'any', JSONB: 'any', SQL_VARIANT: 'any',
  VECTOR: 'number[] | string',
};

function tsFor(sqlType, provider = 'mssql') {
  const entry = tsTypeOf[sqlType];
  if (entry === undefined) throw new Error(`test table has no TS type for ${sqlType}`);
  return typeof entry === 'string' ? entry : (entry[provider] ?? entry.default);
}

test('integers and decimals are told apart by the declared type', () => {
  assert.equal(fieldKind({ type: 'number', sqlType: 'INT' }), 'int');
  assert.equal(fieldKind({ type: 'number', sqlType: 'TINYINT' }), 'int');
  assert.equal(fieldKind({ type: 'number', sqlType: 'INTEGER' }), 'int');
  assert.equal(fieldKind({ type: 'number', sqlType: 'SERIAL' }), 'int');
  assert.equal(fieldKind({ type: 'number | bigint', sqlType: 'BIGINT' }), 'bigint');
  assert.equal(fieldKind({ type: 'number | bigint', sqlType: 'BIGSERIAL' }), 'bigint');
  assert.equal(fieldKind({ type: 'number', sqlType: 'FLOAT' }), 'float');
  assert.equal(fieldKind({ type: 'number', sqlType: 'REAL' }), 'float');
  assert.equal(fieldKind({ type: 'number', sqlType: 'DOUBLE PRECISION' }), 'float');
  // The case that used to be an integer in three generators and a string in the fourth.
  assert.equal(fieldKind({ type: 'number', sqlType: 'DECIMAL(10,2)' }), 'float');
  assert.equal(fieldKind({ type: 'number', sqlType: 'NUMERIC' }), 'float');
  assert.equal(fieldKind({ type: 'number', sqlType: 'MONEY' }), 'float');
});

test('the other kinds come from the declared type too', () => {
  assert.equal(fieldKind({ type: 'boolean', sqlType: 'BIT' }), 'bool');
  assert.equal(fieldKind({ type: 'boolean', sqlType: 'BOOLEAN' }), 'bool');
  assert.equal(fieldKind({ type: 'Date', sqlType: 'DATETIME2' }), 'date');
  assert.equal(fieldKind({ type: 'Date', sqlType: 'DATE' }), 'date');
  assert.equal(fieldKind({ type: 'Date', sqlType: 'DATETIMEOFFSET' }), 'date');
  assert.equal(fieldKind({ type: 'Date', sqlType: 'TIMESTAMPTZ' }), 'date');
  assert.equal(fieldKind({ type: 'Buffer', sqlType: 'VARBINARY(255)' }), 'bytes');
  assert.equal(fieldKind({ type: 'Buffer', sqlType: 'BYTEA' }), 'bytes');
  assert.equal(fieldKind({ type: 'any', sqlType: 'JSONB' }), 'json');
  assert.equal(fieldKind({ type: 'any', sqlType: 'SQL_VARIANT' }), 'json');
  assert.equal(fieldKind({ type: 'number[] | string', sqlType: 'VECTOR' }), 'vector');
  assert.equal(fieldKind({ type: 'string', sqlType: 'NVARCHAR(255)' }), 'string');
  assert.equal(fieldKind({ type: 'string', sqlType: 'UUID' }), 'string');
  assert.equal(fieldKind({ type: 'string', sqlType: 'UNIQUEIDENTIFIER' }), 'string');
});

test('TIMESTAMP is a rowversion on SQL Server and a time elsewhere', () => {
  // The same word has to produce two different things, which is why the provider
  // reaches this decision at all.
  assert.equal(fieldKind({ type: tsFor('TIMESTAMP', 'mssql'), sqlType: 'TIMESTAMP' }, 'mssql'), 'bytes');
  for (const provider of ['postgres', 'mysql', 'sqlite', 'googlesheets']) {
    assert.equal(fieldKind({ type: tsFor('TIMESTAMP', provider), sqlType: 'TIMESTAMP' }, provider), 'date', provider);
  }
});

test('with no declared type the TypeScript type is all there is', () => {
  // Metadata generated before `sql` was recorded has only this, so the fallback has
  // to keep the behaviour the generators already had.
  assert.equal(fieldKind({ type: 'number' }), 'int');
  assert.equal(fieldKind({ type: 'number | bigint' }), 'bigint');
  assert.equal(fieldKind({ type: 'number[] | string' }), 'vector');
  assert.equal(fieldKind({ type: 'boolean' }), 'bool');
  assert.equal(fieldKind({ type: 'Date' }), 'date');
  assert.equal(fieldKind({ type: 'Date | null' }), 'date');
  assert.equal(fieldKind({ type: 'Buffer' }), 'bytes');
  assert.equal(fieldKind({ type: 'any' }), 'json');
  assert.equal(fieldKind({ type: 'string' }), 'string');
});

test('every SQL Server type resolves to a kind, and never to nothing', () => {
  const { PROVIDER_FIELD_TYPES } = require(path.join(distSrc, 'field-types.js'));
  const kinds = new Set(['int', 'bigint', 'float', 'bool', 'date', 'bytes', 'json', 'vector', 'string']);
  for (const [provider, table] of Object.entries(PROVIDER_FIELD_TYPES)) {
    for (const sqlType of Object.keys(table)) {
      const kind = fieldKind({ type: table[sqlType], sqlType }, provider);
      assert.ok(kinds.has(kind), `${provider} ${sqlType} → ${kind}`);
    }
  }
});

test('a DECIMAL column is exact where the language has an exact type', () => {
  // The kind says `float`; C# keeps `decimal` and Go keeps `float64`, both correct
  // for their language. Checked through the generator so the mapping cannot drift.
  const { execFileSync } = require('node:child_process');
  const gen = path.join(__dirname, '..', 'dist', 'generator', 'src', 'dotnet-generator.js');
  const fs2 = require('node:fs');
  const os2 = require('node:os');
  const out = fs2.mkdtempSync(path.join(os2.tmpdir(), 'an5-cs-kinds-'));
  execFileSync(process.execPath, ['-e', `
    const { DotnetGenerator } = require(${JSON.stringify(gen)});
    const models = [{
      name: 'Widget', tableName: 'widgets', schemaName: '', provider: 'mssql',
      fields: [
        { name: 'price', type: 'number', sqlType: 'DECIMAL(10,2)', isOptional: false, hasDefault: false, isId: false },
        { name: 'ratio', type: 'number', sqlType: 'FLOAT', isOptional: false, hasDefault: false, isId: false },
        { name: 'count', type: 'number', sqlType: 'INT', isOptional: false, hasDefault: false, isId: false },
        { name: 'total', type: 'number | bigint', sqlType: 'BIGINT', isOptional: false, hasDefault: false, isId: false },
      ],
      relations: [],
    }];
    new DotnetGenerator(${JSON.stringify(out)}).generate(models);
  `]);
  const source = fs2.readFileSync(path.join(out, 'Widget.cs'), 'utf8');
  assert.match(source, /public decimal Price/);
  assert.match(source, /public double Ratio/);
  assert.match(source, /public int Count/);
  assert.match(source, /public long Total/);
});

test('the kind agrees with the TypeScript type it was generated from', () => {
  // A sanity check on the table above: no declared type may contradict the TS type
  // the parser hands the generators, or the two would disagree downstream.
  const { PROVIDER_FIELD_TYPES } = require(path.join(distSrc, 'field-types.js'));
  const expectations = {
    int: ['number', 'number | bigint'], bigint: ['number', 'number | bigint'],
    float: ['number'], bool: ['boolean'], date: ['Date'], bytes: ['Buffer'],
    json: ['any', 'string'], vector: ['number[] | string'], string: ['string', 'any'],
  };
  for (const [provider, table] of Object.entries(PROVIDER_FIELD_TYPES)) {
    for (const [sqlType, tsType] of Object.entries(table)) {
      const kind = fieldKind({ type: tsType, sqlType }, provider);
      assert.ok(
        expectations[kind].includes(tsType),
        `${provider} ${sqlType}: kind ${kind} contradicts the generated type ${tsType}`,
      );
    }
  }
});
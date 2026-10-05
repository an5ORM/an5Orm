/**
 * Tests for the an5Orm.config.js loader.
 *
 * The behaviour worth protecting is that a mistyped key or a wrong type stops
 * generation. Before, every field fell through `config.outputs?.typescript ||
 * 'default'`, so `outputDirs` was not an error — it wrote to the default
 * directory while the config file said otherwise.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

// The generator builds to dist/, which the test suite produces first.
const loaderPath = path.join(__dirname, '..', 'dist', 'generator', 'src', 'config.js');
assert.ok(fs.existsSync(loaderPath), `Expected built config module at ${loaderPath}`);
const {
  loadConfig,
  validateConfig,
  resolveConnectionString,
  resolveOutputs,
  DEFAULT_CONFIG,
  ConfigError,
  formatIssues,
} = require(loaderPath);

function issuePaths(error) {
  return error.issues.map((issue) => issue.path);
}

test('a valid config is returned with defaults filled in', () => {
  const config = validateConfig({ schemaDir: 'schema' });
  assert.equal(config.schemaDir, 'schema');
  assert.equal(config.outputs.typescript.outputDir, DEFAULT_CONFIG.outputs.typescript.outputDir);
  assert.equal(config.pull.preserveRelations, true);
  assert.equal(config.generation.generateMetadata, true);
  assert.equal(config.connectionString, undefined);
});

test('the TypeScript section keeps only the two documented keys', () => {
  const config = validateConfig({
    outputs: { typescript: { outputDir: 'gen/ts', metadataFile: 'gen/ts/meta.ts' } },
  });
  assert.equal(config.outputs.typescript.outputDir, 'gen/ts');
  assert.equal(config.outputs.typescript.metadataFile, 'gen/ts/meta.ts');
});

test('a mistyped TypeScript key is rejected with a suggestion', () => {
  let error;
  try {
    validateConfig({ outputs: { typescript: { outputDirs: 'ts' } } });
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ConfigError, 'Expected a ConfigError');
  assert.deepEqual(issuePaths(error), ['outputs.typescript.outputDirs']);
  assert.match(error.issues[0].message, /did you mean "outputDir"/);
});

test('a wrong type is reported with the path and what arrived', () => {
  let error;
  try {
    validateConfig({ outputs: { typescript: { outputDir: 42 } } });
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ConfigError);
  assert.deepEqual(issuePaths(error), ['outputs.typescript.outputDir']);
  assert.match(error.issues[0].message, /expected a string, received number/);
});

test('every problem is reported at once, not only the first', () => {
  let error;
  try {
    validateConfig({
      outputz: {},
      pull: { exclude: 'nope', preserveRelations: 'yes' },
      generation: { generateComments: true },
    });
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ConfigError);
  assert.deepEqual(issuePaths(error).sort(), [
    'generation.generateComments',
    'outputz',
    'pull.exclude',
    'pull.preserveRelations',
  ]);
});

test('an unknown top-level key suggests the closest match', () => {
  let error;
  try {
    validateConfig({ outputz: {} });
  } catch (err) {
    error = err;
  }
  assert.match(error.issues[0].message, /did you mean "outputs"/);
});

test('a non-object where an object belongs is caught', () => {
  let error;
  try {
    validateConfig({ outputs: 'gen' });
  } catch (err) {
    error = err;
  }
  assert.deepEqual(issuePaths(error), ['outputs']);
  assert.match(error.issues[0].message, /expected an object, received string/);
});

test('pull.exclude must be an array of strings', () => {
  let error;
  try {
    validateConfig({ pull: { exclude: ['^__', 7] } });
  } catch (err) {
    error = err;
  }
  assert.deepEqual(issuePaths(error), ['pull.exclude']);
});

test('connectionString comes from DATABASE_URL when both are set', () => {
  const config = validateConfig({ connectionString: 'sqlite:from-config.db' });
  assert.equal(
    resolveConnectionString(config, { DATABASE_URL: 'postgres://from-env/db' }),
    'postgres://from-env/db',
  );
});

test('connectionString falls back to the config value', () => {
  const config = validateConfig({ connectionString: 'sqlite:from-config.db' });
  assert.equal(resolveConnectionString(config, {}), 'sqlite:from-config.db');
});

test('an empty DATABASE_URL does not shadow the config', () => {
  const config = validateConfig({ connectionString: 'sqlite:from-config.db' });
  assert.equal(resolveConnectionString(config, { DATABASE_URL: '  ' }), 'sqlite:from-config.db');
});

test('a missing connection names both places to set it', () => {
  let error;
  try {
    resolveConnectionString(validateConfig({}), {}, 'db:push');
  } catch (err) {
    error = err;
  }
  assert.ok(error instanceof ConfigError);
  assert.match(error.issues[0].message, /db:push/);
  assert.match(error.issues[0].message, /DATABASE_URL/);
  assert.match(error.issues[0].message, /connectionString/);
});

test('loadConfig finds a config file and resolves paths against it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-cfg-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'an5Orm.config.js'),
      "module.exports = { schemaDir: 'db', outputs: { typescript: { outputDir: 'out/ts' } } };",
    );
    const loaded = loadConfig(dir);
    assert.equal(loaded.rootDir, fs.realpathSync(dir));
    assert.equal(loaded.configPath, path.join(fs.realpathSync(dir), 'an5Orm.config.js'));
    assert.equal(loaded.outputs.schemaDir, path.join(fs.realpathSync(dir), 'db'));
    assert.equal(loaded.outputs.typescriptDir, path.join(fs.realpathSync(dir), 'out/ts'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig accepts a .cjs config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-cfg-'));
  try {
    fs.writeFileSync(path.join(dir, 'an5Orm.config.cjs'), "module.exports = { schemaDir: 'db' };");
    assert.equal(loadConfig(dir).config.schemaDir, 'db');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig falls back to defaults when there is no config file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-cfg-'));
  try {
    const loaded = loadConfig(dir);
    assert.equal(loaded.configPath, null);
    assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid config file throws from loadConfig, not from a later default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'an5-cfg-'));
  try {
    fs.writeFileSync(path.join(dir, 'an5Orm.config.js'), 'module.exports = { outputs: { typescript: { outputDir: {} } } };');
    assert.throws(() => loadConfig(dir), ConfigError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('issue output lines the paths up for reading', () => {
  const rendered = formatIssues([
    { path: 'outputs.typescript.outputDir', message: 'expected a string' },
    { path: 'schemaDir', message: 'unknown option' },
  ]);
  const lines = rendered.split('\n');
  assert.equal(lines.length, 2);
  // Both messages start in the same column, so the paths line up.
  const firstMessageColumn = lines[0].indexOf('expected');
  const secondMessageColumn = lines[1].indexOf('unknown');
  assert.equal(firstMessageColumn, secondMessageColumn);
  assert.ok(firstMessageColumn > 'outputs.typescript.outputDir'.length);
});

test('resolveOutputs resolves every path against the config directory', () => {
  const outputs = resolveOutputs(DEFAULT_CONFIG, '/project');
  assert.equal(outputs.schemaDir, path.resolve('/project', 'an5Schema'));
  assert.equal(outputs.typescriptDir, path.resolve('/project', 'an5Client/typescript'));
  assert.equal(outputs.rustDir, path.resolve('/project', 'an5Client/rust'));
  assert.equal(outputs.javaDir, path.resolve('/project', 'an5Client/java'));
  assert.equal(outputs.kotlinDir, path.resolve('/project', 'an5Client/kotlin'));
  assert.equal(outputs.swiftDir, path.resolve('/project', 'an5Client/swift'));
});

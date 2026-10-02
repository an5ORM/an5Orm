/**
 * The npm and PyPI versions must agree.
 *
 * They are two fields maintained by hand, in two files, and nothing compared
 * them. `an5-orm` was at 1.0.9 on PyPI while `@an5/orm` reached 1.0.12 on npm,
 * because every release bumped package.json and forgot pyproject.toml. The
 * publish job does not fail when it skips an existing version, so each run
 * quietly built and skipped the old one: PyPI had not received a new release
 * through this pipeline at all.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

const workspaceRoot = path.join(root, '..');

function readVersion(file) {
  const match = fs.readFileSync(path.join(root, file), 'utf8').match(/^version = "(.+)"$/m);
  assert.ok(match, `Expected a version field in ${file}`);
  return match[1];
}

/**
 * Each package that publishes to both registries.
 *
 * Both, not just this one: the loop used to run twice over *this* package's files,
 * with the second package's name only in the test title, so `an5-adapters` drifting
 * between its `package.json` and its `pyproject.toml` was never actually compared.
 */
const BOTH_REGISTRIES = [
  { pypi: 'an5-orm', dir: root },
  { pypi: 'an5-adapters', dir: path.join(workspaceRoot, 'an5Adapters') },
];

for (const { pypi, dir } of BOTH_REGISTRIES) {
  test(`${pypi}: the PyPI version matches the npm version`, () => {
    const npmVersion = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    const pyproject = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
    const pyVersion = pyproject.match(/^version = "(.+)"$/m);
    assert.ok(pyVersion, `Expected a version in ${pypi}'s pyproject.toml`);
    assert.equal(
      pyVersion[1],
      npmVersion,
      `${pypi}: pyproject.toml and package.json disagree — bump both, or the ` +
        'publish step will build the old version and skip it as already published',
    );
  });

  test(`${pypi}: the project name on PyPI is the one that is published there`, () => {
    const match = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8').match(/^name = "(.+)"$/m);
    assert.ok(match, `Expected a name in ${pypi}'s pyproject.toml`);
    assert.equal(match[1], pypi);
  });
}

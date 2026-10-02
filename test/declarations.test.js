/**
 * The published type declarations must not need `@types/node`.
 *
 * A parameter type ends up verbatim in the emitted `.d.ts`, so naming a Node global
 * in an exported signature — `NodeJS.ProcessEnv` was in three of them — makes every
 * consumer without `@types/node` fail to compile against this package, with an error
 * about a Node global in a file they never opened.
 *
 * `process` is allowed as a default *value* inside the implementation: that code runs
 * in Node. What must not appear is a Node *type* in a signature.
 *
 * Run: node --test test/declarations.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const distRoot = path.join(__dirname, '..', 'dist');
assert.ok(fs.existsSync(distRoot), `Expected a build at ${distRoot}`);

function declarationFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.d.ts')) found.push(full);
    }
  };
  walk(distRoot);
  return found;
}

/** Strips comments, so prose about Node does not count as a Node reference. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the build produced declarations', () => {
  assert.ok(declarationFiles().length > 5, 'expected several .d.ts files');
});

test('no declaration needs @types/node', () => {
  const offenders = [];
  for (const file of declarationFiles()) {
    const code = codeOnly(fs.readFileSync(file, 'utf8'));
    if (/\bNodeJS\b/.test(code)) offenders.push(`${path.relative(distRoot, file)}: NodeJS`);
    if (/\bprocess\s*\./.test(code)) offenders.push(`${path.relative(distRoot, file)}: process`);
    if (/\brequire\s*\(/.test(code)) offenders.push(`${path.relative(distRoot, file)}: require`);
    if (/__dirname|__filename/.test(code)) offenders.push(`${path.relative(distRoot, file)}: __dirname`);
  }
  assert.deepEqual(offenders, [], `Node globals leaked into the published types:\n${offenders.join('\n')}`);
});

test('the functions that took an environment still take one', () => {
  const config = fs.readFileSync(path.join(distRoot, 'generator', 'src', 'config.d.ts'), 'utf8');
  for (const name of ['resolveConnectionString', 'providerFromConfig', 'providerForProject']) {
    assert.match(
      config,
      new RegExp(`function ${name}\\([^)]*env\\?: EnvLike`),
      `${name} should take a plain environment type`,
    );
  }
});
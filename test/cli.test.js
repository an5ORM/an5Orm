const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CLI_PATH = path.join(ROOT, 'dist', 'cli.js');

test('package.json declares runnable CLI binaries', () => {
  assert.ok(pkg.bin, 'package.json must declare bin');
  assert.strictEqual(pkg.bin.an5, './dist/cli.js');
  assert.strictEqual(pkg.bin['an5-orm'], './dist/cli.js');
  assert.strictEqual(pkg.bin.orm, './dist/cli.js');
  assert.ok(fs.existsSync(CLI_PATH), 'dist/cli.js must exist');
});

test('cli --help outputs usage information and commands', () => {
  const output = execFileSync(process.execPath, [CLI_PATH, '--help'], {
    encoding: 'utf8',
  });
  assert.match(output, /Usage:/);
  assert.match(output, /an5 <command>/);
  assert.match(output, /generate/);
  assert.match(output, /db:push/);
  assert.match(output, /db:pull/);
  assert.match(output, /db:migrate/);
  assert.match(output, /db:seed/);
  assert.match(output, /db:cleanup/);
});

test('cli -h and empty args show help', () => {
  const outputH = execFileSync(process.execPath, [CLI_PATH, '-h'], {
    encoding: 'utf8',
  });
  assert.match(outputH, /Usage:/);

  const outputEmpty = execFileSync(process.execPath, [CLI_PATH], {
    encoding: 'utf8',
  });
  assert.match(outputEmpty, /Usage:/);
});

test('cli --version outputs package version', () => {
  const output = execFileSync(process.execPath, [CLI_PATH, '--version'], {
    encoding: 'utf8',
  });
  assert.strictEqual(output.trim(), `@an5/orm v${pkg.version}`);
});

test('cli fails on unknown command with advice', () => {
  let thrown = false;
  try {
    execFileSync(process.execPath, [CLI_PATH, 'nonexistent-command'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    thrown = true;
    assert.match(err.stderr || err.stdout, /Unknown command: "nonexistent-command"/);
    assert.match(err.stderr || err.stdout, /Run "an5 --help"/);
  }
  assert.ok(thrown, 'Should exit with non-zero code on unknown command');
});

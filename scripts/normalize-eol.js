/**
 * Rewrite generated files to LF endings.
 *
 * .gitattributes pins the repo to `eol=lf`, but tsc emits the platform's
 * newline, so every build on Windows left the whole dist/ tree looking
 * modified even when the bytes were identical. The tsconfigs already ask for
 * `"newLine": "lf"`, but TypeScript 7 (the native port) does not honour that
 * option yet, so the build still needs to be corrected afterwards.
 *
 * Usage:
 *   node scripts/normalize-eol.js [dir ...]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.d.ts', '.json']);
const SUFFIXES = ['.js.map', '.d.ts.map'];

const isText = name =>
  TEXT.has(path.extname(name)) || SUFFIXES.some(suffix => name.endsWith(suffix));

let converted = 0;

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!isText(entry.name)) continue;
    const before = fs.readFileSync(full, 'utf8');
    if (!before.includes('\r\n')) continue;
    const after = before.replace(/\r\n/g, '\n');
    fs.writeFileSync(full, after);
    converted += 1;
  }
}

for (const target of process.argv.slice(2).length ? process.argv.slice(2) : ['dist']) {
  walk(path.resolve(ROOT, target));
}

console.log(`🔤 normalized ${converted} generated file(s) to LF`);
/**
 * Fail the publish when the npm tarball would be incomplete.
 *
 * Why this exists: 1.0.9 shipped a generator whose dist/index.js did
 * `require("./golang-generator")` while that file never made it into the
 * tarball, so every consumer of `npm run db:generate` died with
 * "Cannot find module './golang-generator'". Nothing in the release path
 * looked at the artifact, so a half-built package went straight to npm.
 *
 * Usage:
 *   node scripts/verify-pack.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const toPosix = p => p.split(path.sep).join('/');

/** The file list npm would actually upload, straight from npm itself. */
function packedFiles() {
  // --ignore-scripts: the build already ran through prepack, we only want the
  // packlist. Running the build again here would just double the wait.
  const out = execSync('npm pack --dry-run --json --ignore-scripts', {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('Could not parse `npm pack --dry-run --json` output');
  }
  const parsed = JSON.parse(out.slice(start, end + 1));
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = entry.files || [];
  console.log(`📦 ${entry.name}@${entry.version}: ${files.length} files in tarball`);
  return new Set(files.map(f => toPosix(f.path)));
}

/** Every file package.json advertises: main, types and each exports branch. */
function entryPoints() {
  const points = [];
  const walk = (node, trail) => {
    if (typeof node === 'string') {
      const target = toPosix(node).replace(/^\.\//, '');
      // Wildcard branches such as "./dist/*" are patterns, not files.
      if (!target.includes('*')) points.push({ trail, target });
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      walk(value, trail ? `${trail}.${key}` : key);
    }
  };
  walk(pkg.exports, 'exports');
  if (pkg.main) points.push({ trail: 'main', target: toPosix(pkg.main) });
  if (pkg.types) points.push({ trail: 'types', target: toPosix(pkg.types) });
  return points;
}

// Matches every relative specifier a compiled file can pull in.
const SPECIFIER = /(?:require\(\s*|from\s+|import\(\s*|import\s+)['"](\.[^'"]+)['"]/g;

/**
 * The generator's whole job is emitting source code as strings, so its output
 * is full of "from './base'" inside template literals. Those describe the files
 * being written, not this package's own imports, so blank them out before
 * scanning or every generated-file import reads as a broken dependency.
 */
function maskNoise(source) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i++; out += '  '; continue; }
      if (ch === '/' && next === '*') { state = 'block'; i++; out += '  '; continue; }
      if (ch === '`') { state = 'template'; out += ' '; continue; }
      out += ch;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch; continue; }
      out += ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i++; out += '  '; continue; }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '\\') { i++; out += '  '; continue; }
    if (ch === '`') { state = 'code'; out += ' '; continue; }
    out += ch === '\n' ? '\n' : ' ';
  }
  return out;
}

function candidates(fromFile, specifier) {
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (path.posix.extname(joined)) return [joined];
  return [`${joined}.js`, `${joined}/index.js`];
}

function main() {
  const packed = packedFiles();
  const errors = [];
  const warnings = [];

  for (const { trail, target } of entryPoints()) {
    if (!packed.has(target)) {
      errors.push(`entry point ${trail} -> "${target}" is not in the tarball`);
    }
  }

  let scanned = 0;
  for (const file of packed) {
    if (!file.startsWith('dist/') || !file.endsWith('.js')) continue;
    const onDisk = path.join(ROOT, ...file.split('/'));
    if (!fs.existsSync(onDisk)) {
      warnings.push(`${file} is packed but missing from the working tree`);
      continue;
    }
    scanned += 1;
    const source = maskNoise(fs.readFileSync(onDisk, 'utf8'));
    for (const match of source.matchAll(SPECIFIER)) {
      // Computed specifiers (require(`./${name}`)) resolve at runtime.
      if (/[$*]/.test(match[1])) continue;
      const options = candidates(file, match[1]);
      if (!options.some(option => packed.has(option))) {
        errors.push(
          `${file} requires "${match[1]}" but the tarball has ` +
            `${options.map(o => `"${o}"`).join(' or ')}`,
        );
      }
    }
    if (!packed.has(file.replace(/\.js$/, '.d.ts'))) {
      warnings.push(`${file} ships without a .d.ts sibling`);
    }
  }

  console.log(`🔍 checked ${scanned} compiled files in dist/`);
  for (const warning of warnings) console.log(`⚠️  ${warning}`);

  if (errors.length) {
    console.error(`\n❌ tarball is incomplete (${errors.length} problem(s)):`);
    for (const error of errors) console.error(`   - ${error}`);
    console.error('\nNothing was published. Fix the above, then run `npm run build`.');
    process.exit(1);
  }

  console.log('✅ tarball is complete');
}

main();
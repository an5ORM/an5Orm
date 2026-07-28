#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  generate: path.join(__dirname, 'generator', 'src', 'index.js'),
  'db:generate': path.join(__dirname, 'generator', 'src', 'index.js'),
  'db:push': path.join(__dirname, 'push.js'),
  'db:pull': path.join(__dirname, 'pull.js'),
  'db:seed': path.join(__dirname, 'seed.js'),
  'db:cleanup': path.join(__dirname, 'cleanup.js'),
  'db:migrate': path.join(__dirname, 'migrate.js'),
};

function help() {
  console.log(`AN5 ORM CLI

Usage:
  an5 <command>
  an5-orm <command>

Commands:
  generate       Generate clients from an5Schema
  db:generate    Alias for generate
  db:push        Push schema to database
  db:pull        Pull schema from database
  db:seed        Seed database
  db:cleanup     Drop tables not in schema
  db:migrate     Migration commands: diff, generate, status

Examples:
  npx an5 generate
  npx an5 db:migrate diff
`);
}

if (!command || command === '-h' || command === '--help' || command === 'help') {
  help();
  process.exit(0);
}

const script = commands[command];
if (!script) {
  console.error(`Unknown command: ${command}`);
  help();
  process.exit(1);
}

const result = spawnSync(process.execPath, [script, ...args], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);

#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function printHelp() {
    console.log(`AN5 ORM CLI

Usage:
  an5 <command> [options]
  npx @an5/orm <command> [options]

Commands:
  generate, codegen          Generate client code from .an5 schemas
  db:push, push              Push schema directly to database
  db:pull, pull              Pull database schema into .an5 files
  db:migrate, migrate        Manage database migrations:
    diff                       Show differences between schema and database
    generate                   Generate a new migration script
    apply [--preview]          Apply pending migrations
    rollback [--preview]       Roll back applied migrations
    status                     View migration status
  db:seed, seed              Run project seed script (seed.ts / seed.js)
  db:cleanup, cleanup        Clean up database tables

Options:
  -v, --version              Show version number
  -h, --help                 Show help
`);
}
function printVersion() {
    try {
        const pkg = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, '..', 'package.json'), 'utf8'));
        console.log(`@an5/orm v${pkg.version}`);
    }
    catch {
        console.log('@an5/orm');
    }
}
function resolveCommandScript(baseName) {
    // If running from dist/cli.js, command files are right next to it
    const distCandidate = path_1.default.join(__dirname, `${baseName}.js`);
    if (fs_1.default.existsSync(distCandidate)) {
        return distCandidate;
    }
    if (baseName === 'generator') {
        const genDist = path_1.default.join(__dirname, 'generator', 'src', 'index.js');
        if (fs_1.default.existsSync(genDist))
            return genDist;
        const genTs = path_1.default.join(__dirname, '..', 'generator', 'src', 'index.ts');
        if (fs_1.default.existsSync(genTs))
            return genTs;
    }
    const rootTs = path_1.default.join(__dirname, '..', `${baseName}.ts`);
    if (fs_1.default.existsSync(rootTs)) {
        return rootTs;
    }
    const localTs = path_1.default.join(__dirname, `${baseName}.ts`);
    if (fs_1.default.existsSync(localTs)) {
        return localTs;
    }
    return distCandidate;
}
function runScript(scriptPath, args) {
    const isTs = scriptPath.endsWith('.ts');
    const runner = isTs ? (process.platform === 'win32' ? 'npx.cmd' : 'npx') : process.execPath;
    const runnerArgs = isTs ? ['tsx', scriptPath, ...args] : [scriptPath, ...args];
    const result = (0, child_process_1.spawnSync)(runner, runnerArgs, {
        stdio: 'inherit',
        env: process.env,
    });
    if (result.error) {
        console.error(`❌ Failed to execute command: ${result.error.message}`);
        process.exit(1);
    }
    process.exit(result.status ?? (result.signal ? 1 : 0));
}
function main(rawArgs = process.argv.slice(2)) {
    const [firstArg, ...rest] = rawArgs;
    if (!firstArg || firstArg === '--help' || firstArg === '-h' || firstArg === 'help') {
        printHelp();
        process.exit(0);
    }
    if (firstArg === '--version' || firstArg === '-v' || firstArg === 'version') {
        printVersion();
        process.exit(0);
    }
    // Handle db:migrate:... shorthand (e.g. db:migrate:apply -> migrate apply)
    if (firstArg.startsWith('db:migrate:')) {
        const sub = firstArg.slice('db:migrate:'.length);
        const script = resolveCommandScript('migrate');
        runScript(script, [sub, ...rest]);
        return;
    }
    switch (firstArg) {
        case 'generate':
        case 'codegen':
        case 'g': {
            const script = resolveCommandScript('generator');
            runScript(script, rest);
            break;
        }
        case 'db:push':
        case 'push': {
            const script = resolveCommandScript('push');
            runScript(script, rest);
            break;
        }
        case 'db:pull':
        case 'pull': {
            const script = resolveCommandScript('pull');
            runScript(script, rest);
            break;
        }
        case 'db:seed':
        case 'seed': {
            const script = resolveCommandScript('seed');
            runScript(script, rest);
            break;
        }
        case 'db:cleanup':
        case 'cleanup': {
            const script = resolveCommandScript('cleanup');
            runScript(script, rest);
            break;
        }
        case 'db:migrate':
        case 'migrate': {
            const script = resolveCommandScript('migrate');
            runScript(script, rest);
            break;
        }
        default: {
            console.error(`Unknown command: "${firstArg}"`);
            console.error('Run "an5 --help" for a list of available commands.');
            process.exit(1);
        }
    }
}
if (require.main === module) {
    main();
}

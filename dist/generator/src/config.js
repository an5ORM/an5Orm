"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigError = exports.DEFAULT_CONFIG = void 0;
exports.resolveOutputs = resolveOutputs;
exports.validateConfig = validateConfig;
exports.resolveConnectionString = resolveConnectionString;
exports.detectProvider = detectProvider;
exports.providerFromConfig = providerFromConfig;
exports.providerForProject = providerForProject;
exports.formatIssues = formatIssues;
exports.loadConfig = loadConfig;
/**
 * Loading and validation for an5Orm.config.js
 *
 * The config used to be read as `any` and every field fell back through
 * `config.outputs?.typescript?.outputDir || 'default'`. That made a typo
 * invisible: `outputDirs` was not an error, it just quietly wrote to the
 * default directory while the config file said otherwise.
 *
 * So the file is described once, here, and validated before anything uses it.
 * A wrong type or an unknown key stops generation with a message naming the
 * offending path, rather than being discovered later as output in the wrong
 * place.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const field_types_1 = require("./field-types");
const suggest_1 = require("./suggest");
exports.DEFAULT_CONFIG = {
    schemaDir: 'an5Schema',
    outputs: {
        typescript: {
            outputDir: 'an5Client/typescript',
            metadataFile: 'an5Client/typescript/an5Metadata.ts',
        },
        python: { metadataFile: 'an5Client/python/an5_metadata.py' },
        dotnet: { outputDir: 'an5Client/dotnet' },
        golang: { outputDir: 'an5Client/golang' },
        rust: { outputDir: 'an5Client/rust' },
        java: { outputDir: 'an5Client/java' },
        kotlin: { outputDir: 'an5Client/kotlin' },
        swift: { outputDir: 'an5Client/swift' },
    },
    pull: {
        exclude: ['^__', '^sys\\.', '^igrations'],
        preserveRelations: true,
    },
    generation: {
        generateMetadata: true,
    },
};
function resolveOutputs(config, rootDir) {
    const resolve = (relative) => path_1.default.resolve(rootDir, relative);
    return {
        schemaDir: resolve(config.schemaDir),
        typescriptDir: resolve(config.outputs.typescript.outputDir),
        typescriptMetadataFile: resolve(config.outputs.typescript.metadataFile),
        pythonMetadataFile: resolve(config.outputs.python.metadataFile),
        dotnetDir: resolve(config.outputs.dotnet.outputDir),
        golangDir: resolve(config.outputs.golang.outputDir),
        rustDir: resolve(config.outputs.rust.outputDir),
        javaDir: resolve(config.outputs.java.outputDir),
        kotlinDir: resolve(config.outputs.kotlin.outputDir),
        swiftDir: resolve(config.outputs.swift.outputDir),
    };
}
class ConfigError extends Error {
    constructor(issues) {
        super('Invalid an5Orm.config.js');
        this.issues = issues;
    }
}
exports.ConfigError = ConfigError;
function typeName(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'an array';
    return typeof value;
}
function checkObject(raw, spec, at, issues) {
    if (raw === undefined)
        return {};
    if (typeName(raw) !== 'object' || Array.isArray(raw)) {
        issues.push({ path: at, message: `expected an object, received ${typeName(raw)}` });
        return {};
    }
    const source = raw;
    const accepted = {};
    for (const key of Object.keys(source)) {
        if (!(key in spec)) {
            const hint = (0, suggest_1.suggest)(key, Object.keys(spec));
            issues.push({
                path: at ? `${at}.${key}` : key,
                message: hint
                    ? `unknown option; did you mean "${hint}"?`
                    : `unknown option; expected one of ${Object.keys(spec).map((k) => `"${k}"`).join(', ')}`,
            });
            continue;
        }
        const expected = spec[key];
        const value = source[key];
        const here = at ? `${at}.${key}` : key;
        if (expected === 'object') {
            // Only the shape is checked here. A nested section is validated by the
            // caller with its own key list, so this must not look at the keys — it
            // has no spec for them and would reject all of them as unknown.
            if (value !== undefined && (typeName(value) !== 'object' || Array.isArray(value))) {
                issues.push({ path: here, message: `expected an object, received ${typeName(value)}` });
                continue;
            }
            accepted[key] = value;
            continue;
        }
        if (value === undefined)
            continue;
        if (expected === 'string[]') {
            if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
                issues.push({ path: here, message: `expected an array of strings, received ${typeName(value)}` });
                continue;
            }
            accepted[key] = value;
            continue;
        }
        if (typeof value !== expected) {
            issues.push({
                path: here,
                message: `expected a${expected === 'string' ? ' string' : ` ${expected}`}, received ${typeName(value)}`,
            });
            continue;
        }
        accepted[key] = value;
    }
    return accepted;
}
const OUTPUT_SPEC = {
    typescript: 'object',
    python: 'object',
    dotnet: 'object',
    golang: 'object',
    rust: 'object',
    java: 'object',
    kotlin: 'object',
    swift: 'object',
};
const OUTPUT_SECTION_SPEC = {
    typescript: { outputDir: 'string', metadataFile: 'string' },
    python: { metadataFile: 'string' },
    dotnet: { outputDir: 'string' },
    golang: { outputDir: 'string' },
    rust: { outputDir: 'string' },
    java: { outputDir: 'string' },
    kotlin: { outputDir: 'string' },
    swift: { outputDir: 'string' },
};
const TOP_LEVEL_SPEC = {
    connectionString: 'string',
    schemaDir: 'string',
    outputs: 'object',
    pull: 'object',
    generation: 'object',
};
const PULL_SPEC = {
    exclude: 'string[]',
    preserveRelations: 'boolean',
};
const GENERATION_SPEC = {
    generateMetadata: 'boolean',
};
/**
 * Checks a loaded config object and returns it with defaults applied.
 * Throws ConfigError listing every problem found, not just the first.
 */
function validateConfig(raw) {
    const issues = [];
    const top = checkObject(raw, TOP_LEVEL_SPEC, '', issues);
    const rawOutputs = checkObject(top.outputs, OUTPUT_SPEC, 'outputs', issues);
    // Each output section has its own allowed keys, so a typo in one is caught
    // where it was written rather than as a missing value much later.
    const outputs = {};
    for (const section of Object.keys(OUTPUT_SECTION_SPEC)) {
        outputs[section] = checkObject(rawOutputs[section], OUTPUT_SECTION_SPEC[section], `outputs.${section}`, issues);
    }
    const pull = checkObject(top.pull, PULL_SPEC, 'pull', issues);
    const generation = checkObject(top.generation, GENERATION_SPEC, 'generation', issues);
    if (issues.length > 0)
        throw new ConfigError(issues);
    return {
        // Absent rather than defaulted: there is no sensible fallback connection.
        connectionString: top.connectionString,
        schemaDir: top.schemaDir ?? exports.DEFAULT_CONFIG.schemaDir,
        outputs: {
            typescript: {
                outputDir: outputs.typescript?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.typescript.outputDir,
                metadataFile: outputs.typescript?.metadataFile ??
                    exports.DEFAULT_CONFIG.outputs.typescript.metadataFile,
            },
            python: {
                metadataFile: outputs.python?.metadataFile ??
                    exports.DEFAULT_CONFIG.outputs.python.metadataFile,
            },
            dotnet: {
                outputDir: outputs.dotnet?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.dotnet.outputDir,
            },
            golang: {
                outputDir: outputs.golang?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.golang.outputDir,
            },
            rust: {
                outputDir: outputs.rust?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.rust.outputDir,
            },
            java: {
                outputDir: outputs.java?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.java.outputDir,
            },
            kotlin: {
                outputDir: outputs.kotlin?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.kotlin.outputDir,
            },
            swift: {
                outputDir: outputs.swift?.outputDir ??
                    exports.DEFAULT_CONFIG.outputs.swift.outputDir,
            },
        },
        pull: {
            exclude: pull.exclude ?? exports.DEFAULT_CONFIG.pull.exclude,
            preserveRelations: pull.preserveRelations ?? exports.DEFAULT_CONFIG.pull.preserveRelations,
        },
        generation: {
            generateMetadata: generation.generateMetadata ?? exports.DEFAULT_CONFIG.generation.generateMetadata,
        },
    };
}
/**
 * The connection string to use, or an error explaining where to put one.
 *
 * DATABASE_URL wins over the config file: it is the documented override and the
 * one CI sets. A project may therefore commit a development connection and
 * still have a different one in a pipeline without editing the file.
 */
function resolveConnectionString(config, env = process.env, command = 'this command') {
    const fromEnv = env.DATABASE_URL;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '')
        return fromEnv;
    const fromConfig = config.connectionString;
    if (typeof fromConfig === 'string' && fromConfig.trim() !== '')
        return fromConfig;
    throw new ConfigError([
        {
            path: 'connectionString',
            message: `required for ${command}; not set in an5Orm.config.js and DATABASE_URL is empty. ` +
                'Set DATABASE_URL, or add a connectionString to the config file.',
        },
    ]);
}
/**
 * The provider a connection string points at.
 *
 * Reads the scheme exactly as `An5Adapter` does
 * (`an5Adapters/typescript/src/an5Adapter.ts`) so the generator and the adapter
 * always talk about the same database: the same connection string must give the
 * same provider, otherwise validation checks the types of one database while the
 * SQL runs on another.
 *
 * Falls back to SQL Server when the scheme is unknown — it is the default
 * provider, and ADO-style strings (`Server=...;Database=...`) have no scheme to
 * read. `sqlite://`, a bare path ending in `.sqlite`, `.sqlite3` or `.db` — the same
 * list `An5Adapter` uses.
 */
function detectProvider(connectionString) {
    // Lower-cased: a URI scheme is case-insensitive, so `MySQL://` is the same
    // connection as `mysql://`. `an5Adapters/typescript/src/an5Adapter.ts` compares
    // the same way, and the two have to agree or this picks a provider whose DDL the
    // adapter never runs.
    const cs = (connectionString ?? '').trim().toLowerCase();
    if (cs === '')
        return field_types_1.DEFAULT_PROVIDER;
    if (cs.startsWith('googlesheets://'))
        return 'googlesheets';
    if (cs.startsWith('postgres://') || cs.startsWith('postgresql://'))
        return 'postgres';
    if (cs.startsWith('mysql://') || cs.startsWith('mariadb://'))
        return 'mysql';
    if (SQLITE_FILE_SUFFIXES.some((suffix) => cs.endsWith(suffix)))
        return 'sqlite';
    return field_types_1.DEFAULT_PROVIDER;
}
/** File extensions that mean SQLite when there is no scheme to read. */
const SQLITE_FILE_SUFFIXES = ['.sqlite', '.sqlite3', '.db'];
/**
 * The provider for this run: `DATABASE_URL` first, then the connection string in
 * the config file, then the default.
 *
 * Does not throw when there is no connection string — `generate` has to work
 * with an empty config, and the default provider still validates the schema as
 * before.
 */
function providerFromConfig(config, env = process.env) {
    const fromEnv = typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim() !== '' ? env.DATABASE_URL : undefined;
    return detectProvider(fromEnv ?? config.connectionString);
}
/**
 * The provider configured for a project directory.
 *
 * For the tools outside this package that read `.an5` files — the an5Agent
 * schema tools, the VS Code extension — so they validate against the same
 * database the generator does instead of silently assuming SQL Server.
 *
 * Never throws: no config, an unreadable one, or an invalid one all mean the
 * default provider, which is what the parser does on its own anyway.
 */
function providerForProject(cwd = process.cwd(), env = process.env) {
    try {
        return providerFromConfig(loadConfig(cwd).config, env);
    }
    catch {
        return field_types_1.DEFAULT_PROVIDER;
    }
}
/**
 * Renders issues for the terminal, one per line, paths aligned.
 *
 * Takes the shape rather than `ConfigIssue` so field type errors
 * (`FieldTypeIssue`, from `./field-types`) print through the same code — both
 * are "a path in the file and what is wrong with it".
 */
function formatIssues(issues) {
    const width = Math.max(...issues.map((issue) => issue.path.length));
    return issues
        .map((issue) => `  ${issue.path.padEnd(width)}  ${issue.message}`)
        .join('\n');
}
/**
 * Finds, loads and validates an5Orm.config.js.
 *
 * Searched in order: the working directory, the same directory as `.cjs`, and
 * the parent directory for each. When no file is found the defaults are used,
 * so a project can generate without a config.
 */
function loadConfig(cwd = process.cwd()) {
    // Resolved before the search because `require` treats a bare specifier as a
    // package name: with a relative `cwd` the file is found (`existsSync` is
    // relative to the process directory) but `require('./an5Orm.config.js')` is
    // really `require('an5Orm.config.js')`, which throws MODULE_NOT_FOUND and
    // loses the config without saying so.
    const startDir = path_1.default.resolve(cwd);
    const candidates = [
        path_1.default.join(startDir, 'an5Orm.config.js'),
        path_1.default.join(startDir, 'an5Orm.config.cjs'),
        path_1.default.join(startDir, '..', 'an5Orm.config.js'),
        path_1.default.join(startDir, '..', 'an5Orm.config.cjs'),
    ];
    const configPath = candidates.find((candidate) => fs_1.default.existsSync(candidate)) ?? null;
    if (configPath === null) {
        // A schema directory one level up is the common monorepo layout; without a
        // config the paths would otherwise point at a directory that does not exist.
        const rootDir = fs_1.default.existsSync(path_1.default.join(startDir, '..', 'an5Schema'))
            ? path_1.default.resolve(startDir, '..')
            : startDir;
        return {
            config: exports.DEFAULT_CONFIG,
            rootDir,
            outputs: resolveOutputs(exports.DEFAULT_CONFIG, rootDir),
            configPath: null,
        };
    }
    const rootDir = path_1.default.dirname(configPath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require(configPath);
    const config = validateConfig(raw);
    return { config, rootDir, outputs: resolveOutputs(config, rootDir), configPath };
}

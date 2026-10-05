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
import fs from 'fs';
import path from 'path';
import { DEFAULT_PROVIDER, Provider } from './field-types';
import { suggest } from './suggest';

/** TypeScript client output. */
export interface TypeScriptOutput {
  /** Directory for the generated .ts files. */
  outputDir: string;
  /** Path of the generated metadata module. */
  metadataFile: string;
}

export interface PythonOutput {
  /** Path of the generated metadata module. */
  metadataFile: string;
}

export interface DotnetOutput {
  outputDir: string;
}

export interface GolangOutput {
  outputDir: string;
}

export interface RustOutput {
  outputDir: string;
}

/** Java client output. */
export interface JavaOutput {
  outputDir: string;
}

/** Kotlin client output. */
export interface KotlinOutput {
  outputDir: string;
}

/** Swift client output. */
export interface SwiftOutput {
  outputDir: string;
}

export interface An5OrmConfig {
  /**
   * Database connection for the commands that need one — db:push, db:pull,
   * db:migrate:*, db:cleanup.
   *
   * Optional on purpose: DATABASE_URL overrides it, so a checked-in config can
   * hold a development database while CI supplies its own. Leave it unset
   * rather than committing a password, and keep secrets in the environment.
   *
   * `| undefined` is explicit because the project compiles with
   * exactOptionalPropertyTypes, which otherwise rejects an omitted value.
   */
  connectionString?: string | undefined;
  /** Schema directory, relative to the config file. */
  schemaDir: string;
  outputs: {
    typescript: TypeScriptOutput;
    python: PythonOutput;
    dotnet: DotnetOutput;
    golang: GolangOutput;
    rust: RustOutput;
    java: JavaOutput;
    kotlin: KotlinOutput;
    swift: SwiftOutput;
  };
  pull: {
    /** Regex patterns; tables matching any of them are skipped by db:pull. */
    exclude: string[];
    /** Keep relations that already exist in the schema. */
    preserveRelations: boolean;
  };
  generation: {
    /** Write the metadata module alongside the client. */
    generateMetadata: boolean;
  };
}

export const DEFAULT_CONFIG: An5OrmConfig = {
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

/** Output paths resolved against the config file's directory. */
export interface ResolvedOutputs {
  schemaDir: string;
  typescriptDir: string;
  typescriptMetadataFile: string;
  pythonMetadataFile: string;
  dotnetDir: string;
  golangDir: string;
  rustDir: string;
  javaDir: string;
  kotlinDir: string;
  swiftDir: string;
}

export function resolveOutputs(config: An5OrmConfig, rootDir: string): ResolvedOutputs {
  const resolve = (relative: string) => path.resolve(rootDir, relative);
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

/**
 * The environment variables a caller can pass in.
 *
 * Spelled structurally rather than as `NodeJS.ProcessEnv`: that type is a Node
 * global, and a parameter type ends up in the emitted `.d.ts`, so any consumer
 * without `@types/node` would fail to compile against this package. `process.env` is
 * assignable to it, and so is a plain `{}` in a test.
 */
export type EnvLike = Record<string, string | undefined>;

/** One problem found in the config file. */
export interface ConfigIssue {
  /** Dotted path, e.g. `outputs.typescript.outputDir`. */
  path: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super('Invalid an5Orm.config.js');
    this.issues = issues;
  }
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * Validates one level of an object: every key is known, every value has the
 * expected primitive shape. Returns the accepted value.
 */
type FieldSpec = 'string' | 'string[]' | 'boolean' | 'object';

function checkObject(
  raw: unknown,
  spec: Record<string, FieldSpec>,
  at: string,
  issues: ConfigIssue[],
): Record<string, unknown> {
  if (raw === undefined) return {};
  if (typeName(raw) !== 'object' || Array.isArray(raw)) {
    issues.push({ path: at, message: `expected an object, received ${typeName(raw)}` });
    return {};
  }

  const source = raw as Record<string, unknown>;
  const accepted: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    if (!(key in spec)) {
      const hint = suggest(key, Object.keys(spec));
      issues.push({
        path: at ? `${at}.${key}` : key,
        message: hint
          ? `unknown option; did you mean "${hint}"?`
          : `unknown option; expected one of ${Object.keys(spec).map((k) => `"${k}"`).join(', ')}`,
      });
      continue;
    }

    const expected = spec[key]!;
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

    if (value === undefined) continue;

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

const OUTPUT_SPEC: Record<string, FieldSpec> = {
  typescript: 'object',
  python: 'object',
  dotnet: 'object',
  golang: 'object',
  rust: 'object',
  java: 'object',
  kotlin: 'object',
  swift: 'object',
};

const OUTPUT_SECTION_SPEC: Record<string, Record<string, FieldSpec>> = {
  typescript: { outputDir: 'string', metadataFile: 'string' },
  python: { metadataFile: 'string' },
  dotnet: { outputDir: 'string' },
  golang: { outputDir: 'string' },
  rust: { outputDir: 'string' },
  java: { outputDir: 'string' },
  kotlin: { outputDir: 'string' },
  swift: { outputDir: 'string' },
};

const TOP_LEVEL_SPEC: Record<string, FieldSpec> = {
  connectionString: 'string',
  schemaDir: 'string',
  outputs: 'object',
  pull: 'object',
  generation: 'object',
};

const PULL_SPEC: Record<string, FieldSpec> = {
  exclude: 'string[]',
  preserveRelations: 'boolean',
};

const GENERATION_SPEC: Record<string, FieldSpec> = {
  generateMetadata: 'boolean',
};

/**
 * Checks a loaded config object and returns it with defaults applied.
 * Throws ConfigError listing every problem found, not just the first.
 */
export function validateConfig(raw: unknown): An5OrmConfig {
  const issues: ConfigIssue[] = [];

  const top = checkObject(raw, TOP_LEVEL_SPEC, '', issues);
  const rawOutputs = checkObject(top.outputs, OUTPUT_SPEC, 'outputs', issues);
  // Each output section has its own allowed keys, so a typo in one is caught
  // where it was written rather than as a missing value much later.
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const section of Object.keys(OUTPUT_SECTION_SPEC)) {
    outputs[section] = checkObject(
      rawOutputs[section],
      OUTPUT_SECTION_SPEC[section]!,
      `outputs.${section}`,
      issues,
    );
  }
  const pull = checkObject(top.pull, PULL_SPEC, 'pull', issues);
  const generation = checkObject(top.generation, GENERATION_SPEC, 'generation', issues);

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    // Absent rather than defaulted: there is no sensible fallback connection.
    connectionString: top.connectionString as string | undefined,
    schemaDir: (top.schemaDir as string) ?? DEFAULT_CONFIG.schemaDir,
    outputs: {
      typescript: {
        outputDir:
          (outputs.typescript as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.typescript.outputDir,
        metadataFile:
          ((outputs.typescript as Record<string, unknown> | undefined)?.metadataFile as string) ??
          DEFAULT_CONFIG.outputs.typescript.metadataFile,
      },
      python: {
        metadataFile:
          ((outputs.python as Record<string, unknown> | undefined)?.metadataFile as string) ??
          DEFAULT_CONFIG.outputs.python.metadataFile,
      },
      dotnet: {
        outputDir:
          (outputs.dotnet as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.dotnet.outputDir,
      },
      golang: {
        outputDir:
          (outputs.golang as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.golang.outputDir,
      },
      rust: {
        outputDir:
          (outputs.rust as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.rust.outputDir,
      },
      java: {
        outputDir:
          (outputs.java as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.java.outputDir,
      },
      kotlin: {
        outputDir:
          (outputs.kotlin as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.kotlin.outputDir,
      },
      swift: {
        outputDir:
          (outputs.swift as Record<string, unknown> | undefined)?.outputDir as string ??
          DEFAULT_CONFIG.outputs.swift.outputDir,
      },
    },
    pull: {
      exclude: (pull.exclude as string[] | undefined) ?? DEFAULT_CONFIG.pull.exclude,
      preserveRelations:
        (pull.preserveRelations as boolean | undefined) ?? DEFAULT_CONFIG.pull.preserveRelations,
    },
    generation: {
      generateMetadata:
        (generation.generateMetadata as boolean | undefined) ?? DEFAULT_CONFIG.generation.generateMetadata,
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
export function resolveConnectionString(
  config: An5OrmConfig,
  env: EnvLike = process.env,
  command = 'this command',
): string {
  const fromEnv = env.DATABASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;

  const fromConfig = config.connectionString;
  if (typeof fromConfig === 'string' && fromConfig.trim() !== '') return fromConfig;

  throw new ConfigError([
    {
      path: 'connectionString',
      message:
        `required for ${command}; not set in an5Orm.config.js and DATABASE_URL is empty. ` +
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
export function detectProvider(connectionString: string | undefined | null): Provider {
  // Lower-cased: a URI scheme is case-insensitive, so `MySQL://` is the same
  // connection as `mysql://`. `an5Adapters/typescript/src/an5Adapter.ts` compares
  // the same way, and the two have to agree or this picks a provider whose DDL the
  // adapter never runs.
  const cs = (connectionString ?? '').trim().toLowerCase();
  if (cs === '') return DEFAULT_PROVIDER;
  if (cs.startsWith('googlesheets://')) return 'googlesheets';
  if (cs.startsWith('postgres://') || cs.startsWith('postgresql://')) return 'postgres';
  if (cs.startsWith('mysql://') || cs.startsWith('mariadb://')) return 'mysql';
  if (SQLITE_FILE_SUFFIXES.some((suffix) => cs.endsWith(suffix))) return 'sqlite';
  return DEFAULT_PROVIDER;
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
export function providerFromConfig(
  config: An5OrmConfig,
  env: EnvLike = process.env,
): Provider {
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
export function providerForProject(
  cwd: string = process.cwd(),
  env: EnvLike = process.env,
): Provider {
  try {
    return providerFromConfig(loadConfig(cwd).config, env);
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/**
 * Renders issues for the terminal, one per line, paths aligned.
 *
 * Takes the shape rather than `ConfigIssue` so field type errors
 * (`FieldTypeIssue`, from `./field-types`) print through the same code — both
 * are "a path in the file and what is wrong with it".
 */
export function formatIssues(issues: ReadonlyArray<{ path: string; message: string }>): string {
  const width = Math.max(...issues.map((issue) => issue.path.length));
  return issues
    .map((issue) => `  ${issue.path.padEnd(width)}  ${issue.message}`)
    .join('\n');
}

export interface LoadedConfig {
  /** The validated config, with defaults applied. */
  config: An5OrmConfig;
  /** Directory the config file lives in; every relative path resolves against it. */
  rootDir: string;
  /** Absolute output paths. */
  outputs: ResolvedOutputs;
  /** Absolute path of the config file, or null when none was found. */
  configPath: string | null;
}

/**
 * Finds, loads and validates an5Orm.config.js.
 *
 * Searched in order: the working directory, the same directory as `.cjs`, and
 * the parent directory for each. When no file is found the defaults are used,
 * so a project can generate without a config.
 */
export function loadConfig(cwd: string = process.cwd()): LoadedConfig {
  // Resolved before the search because `require` treats a bare specifier as a
  // package name: with a relative `cwd` the file is found (`existsSync` is
  // relative to the process directory) but `require('./an5Orm.config.js')` is
  // really `require('an5Orm.config.js')`, which throws MODULE_NOT_FOUND and
  // loses the config without saying so.
  const startDir = path.resolve(cwd);
  const candidates = [
    path.join(startDir, 'an5Orm.config.js'),
    path.join(startDir, 'an5Orm.config.cjs'),
    path.join(startDir, '..', 'an5Orm.config.js'),
    path.join(startDir, '..', 'an5Orm.config.cjs'),
  ];

  const configPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;

  if (configPath === null) {
    // A schema directory one level up is the common monorepo layout; without a
    // config the paths would otherwise point at a directory that does not exist.
    const rootDir = fs.existsSync(path.join(startDir, '..', 'an5Schema'))
      ? path.resolve(startDir, '..')
      : startDir;
    return {
      config: DEFAULT_CONFIG,
      rootDir,
      outputs: resolveOutputs(DEFAULT_CONFIG, rootDir),
      configPath: null,
    };
  }

  const rootDir = path.dirname(configPath);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(configPath);
  const config = validateConfig(raw);
  return { config, rootDir, outputs: resolveOutputs(config, rootDir), configPath };
}

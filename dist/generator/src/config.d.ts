import { Provider } from './field-types';
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
export declare const DEFAULT_CONFIG: An5OrmConfig;
/** Output paths resolved against the config file's directory. */
export interface ResolvedOutputs {
    schemaDir: string;
    typescriptDir: string;
    typescriptMetadataFile: string;
    pythonMetadataFile: string;
    dotnetDir: string;
    golangDir: string;
    rustDir: string;
}
export declare function resolveOutputs(config: An5OrmConfig, rootDir: string): ResolvedOutputs;
/** One problem found in the config file. */
export interface ConfigIssue {
    /** Dotted path, e.g. `outputs.typescript.outputDir`. */
    path: string;
    message: string;
}
export declare class ConfigError extends Error {
    readonly issues: ConfigIssue[];
    constructor(issues: ConfigIssue[]);
}
/**
 * Checks a loaded config object and returns it with defaults applied.
 * Throws ConfigError listing every problem found, not just the first.
 */
export declare function validateConfig(raw: unknown): An5OrmConfig;
/**
 * The connection string to use, or an error explaining where to put one.
 *
 * DATABASE_URL wins over the config file: it is the documented override and the
 * one CI sets. A project may therefore commit a development connection and
 * still have a different one in a pipeline without editing the file.
 */
export declare function resolveConnectionString(config: An5OrmConfig, env?: NodeJS.ProcessEnv, command?: string): string;
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
export declare function detectProvider(connectionString: string | undefined | null): Provider;
/**
 * The provider for this run: `DATABASE_URL` first, then the connection string in
 * the config file, then the default.
 *
 * Does not throw when there is no connection string — `generate` has to work
 * with an empty config, and the default provider still validates the schema as
 * before.
 */
export declare function providerFromConfig(config: An5OrmConfig, env?: NodeJS.ProcessEnv): Provider;
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
export declare function providerForProject(cwd?: string, env?: NodeJS.ProcessEnv): Provider;
/**
 * Renders issues for the terminal, one per line, paths aligned.
 *
 * Takes the shape rather than `ConfigIssue` so field type errors
 * (`FieldTypeIssue`, from `./field-types`) print through the same code — both
 * are "a path in the file and what is wrong with it".
 */
export declare function formatIssues(issues: ReadonlyArray<{
    path: string;
    message: string;
}>): string;
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
export declare function loadConfig(cwd?: string): LoadedConfig;
//# sourceMappingURL=config.d.ts.map
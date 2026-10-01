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
/** Renders issues for the terminal, pointing at the config file. */
export declare function formatIssues(issues: ConfigIssue[]): string;
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

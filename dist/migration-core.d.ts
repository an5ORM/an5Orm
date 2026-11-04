import { Provider } from './generator/src/field-types';
export interface SchemaField {
    name: string;
    sqlType: string;
    isOptional: boolean;
    isId: boolean;
    isUnique: boolean;
    uniqueName?: string | undefined;
    defaultValue?: string | undefined;
}
export interface SchemaIndexDefinition {
    fields: string[];
    name?: string;
    includeFields?: string[];
    filter?: string;
    options?: string;
}
export interface SchemaModel {
    name: string;
    /**
     * The table to create, schema-qualified when the model named a schema other than
     * `dbo`. `dbo` stays implicit so an unqualified model produces the same SQL it
     * always has.
     */
    tableName: string;
    fields: SchemaField[];
    compoundUniques: Array<string[] | SchemaIndexDefinition>;
    indexes: Array<string[] | SchemaIndexDefinition>;
    /** A `view` block rather than a table. */
    isView?: boolean;
    /** The `@@sql("...")` body; required for a view. */
    viewSql?: string;
}
export interface DbColumn {
    columnName: string;
    dataType: string;
    maxLength?: number;
    precision?: number;
    scale?: number;
    isNullable: boolean;
    isPrimaryKey: boolean;
    isIdentity: boolean;
    defaultValue?: string;
}
export interface MigrationOp {
    type: 'CREATE_TABLE' | 'ADD_COLUMN' | 'DROP_COLUMN' | 'ALTER_COLUMN' | 'ADD_INDEX' | 'ADD_UNIQUE' | 'DROP_INDEX' | 'DROP_UNIQUE' | 'DROP_TABLE' | 'CREATE_VIEW' | 'DROP_VIEW';
    table: string;
    column?: string;
    details?: string;
    sql?: string;
    /** For `CREATE_VIEW`: the definition to restore on rollback. */
    previousSql?: string;
    previousSqlType?: string;
    previousNullable?: boolean;
    riskWarnings?: string[];
    preflightSql?: string[];
}
export interface TableArtifacts {
    indexes?: string[];
    uniqueConstraints?: string[];
}
export interface MigrationSections {
    preflight: string;
    up: string;
    down: string;
    hasDown: boolean;
}
export interface AppliedMigrationRef {
    id: string;
    checksum?: string;
}
export interface AppliedMigrationDrift {
    /** Applied migration files whose contents no longer match the recorded checksum. */
    changed: string[];
    /** Applied migration files that are no longer on disk. */
    missing: string[];
}
/**
 * Compares applied migrations with the files they were applied from.
 *
 * `apply` used to look only at the ids, so editing an applied file was invisible
 * and a fresh database would get different SQL from the one already recorded.
 * Rollback already refuses a changed checksum; this catches it before the next
 * migration is applied, where it can still be fixed without a partial history.
 */
export declare function verifyAppliedMigrations(applied: readonly AppliedMigrationRef[], readMigration: (id: string) => string | null, checksum: (content: string) => string): AppliedMigrationDrift;
export interface MigrationCommandOptions {
    preview: boolean;
    rest: string[];
}
export declare function parseSqlType(raw: string): string;
export declare function formatDbColumnSqlType(column: DbColumn): string;
export declare function mapDefault(val: string): string;
export declare function safeIdentifierName(raw: string): string;
export declare function quoteTableName(raw: string): string;
export declare function tableIdentityName(raw: string): string;
export declare function buildAlterColumnWarnings(previousSqlType: string, nextSqlType: string, previousNullable: boolean, nextNullable: boolean): string[];
export declare function buildAlterColumnPreflightSql(tableName: string, columnName: string, previousSqlType: string, nextSqlType: string, previousNullable: boolean, nextNullable: boolean): string[];
export declare function buildAddColumnPreflightSql(tableName: string, field: SchemaField): string[];
export declare function buildUniqueConstraintPreflightSql(tableName: string, fields: string[]): string[];
/**
 * Reads a `.an5` schema into models to compare against the database.
 *
 * `provider` decides what counts as a column and what counts as a relation; it
 * defaults to SQL Server. A type the provider does not have is reported rather
 * than skipped — skipping it means the migration silently never mentions that
 * column. A token matching a model in the schema is a relation, so that
 * comparison waits until the whole schema has been read.
 */
export declare function parseSchemaText(text: string, provider?: Provider): SchemaModel[];
export declare function buildCreateTableSql(model: SchemaModel): string;
/**
 * The migration DDL for a view.
 *
 * `CREATE OR ALTER` is SQL Server's form; `db:migrate` is SQL Server-only today.
 * The body is expected to be a single `SELECT` (`@@sql`), so no batch splitting
 * is needed here — the caller isolates the statement with `GO`.
 */
export declare function buildCreateViewSql(model: SchemaModel): string;
export declare function buildIndexDiff(model: SchemaModel, artifacts: TableArtifacts, ops: MigrationOp[]): void;
export declare function generateColumnDiff(model: SchemaModel, dbColumns: DbColumn[], ops: MigrationOp[]): void;
export declare function generateDiff(schemaModels: SchemaModel[], dbTables: string[], introspectTable: (tableName: string) => Promise<DbColumn[]>, introspectArtifacts?: (tableName: string) => Promise<TableArtifacts>, dbViews?: string[], introspectViewDefinition?: (viewName: string) => Promise<string | null>): Promise<MigrationOp[]>;
export declare function buildMigrationFile(timestamp: string, ops: MigrationOp[]): string;
export declare function buildDownMigrationSql(ops: MigrationOp[]): string;
export declare function parseMigrationSections(sql: string): MigrationSections;
export declare function splitSqlBatches(sql: string): string[];
export declare function parseRollbackSelection(args: string[], applied: AppliedMigrationRef[]): {
    count: number;
    label: string;
};
export declare function parseMigrationCommandOptions(args: string[]): MigrationCommandOptions;

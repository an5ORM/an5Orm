import { FieldTypeIssue, Provider } from './field-types';
/** A column, as push needs it: the type as written plus what the dialect renders. */
export interface PushField {
    name: string;
    sqlType: string;
    isOptional: boolean;
    isId: boolean;
    isUnique: boolean;
    /** `@unique(map: "…")`, so push and migrate create the same artifact name. */
    uniqueName?: string | undefined;
    /** The `@default(...)` expression, not SQL: only the dialect knows the spelling. */
    defaultExpr?: string | undefined;
}
export interface PushModel {
    name: string;
    tableName: string;
    /** The schema to create the table in; `''` when the provider has none. */
    schema: string;
    /** Set only when the schema file named one, so a wrong one can be reported. */
    declaredSchema?: string | undefined;
    fields: PushField[];
    /** `@@unique([a, b])`, as field lists. */
    compoundUniques: PushIndex[];
    /** `@@index([a, b])`, as field lists. */
    indexes: PushIndex[];
}
/**
 * A `view` block, as push needs it.
 *
 * `fields` describe the view's result columns for validation and generated
 * clients; the DDL itself is `sql`, the `@@sql("...")` body.
 */
export interface PushView {
    name: string;
    /** The database view name; `@@map` may rename it independently. */
    viewName: string;
    schema: string;
    declaredSchema?: string | undefined;
    fields: PushField[];
    sql: string;
}
/**
 * The schema a model lands in when the schema file does not say: none, for every
 * provider, so the name goes wherever the connection resolves.
 *
 * The parser used to default this to `dbo` and push followed it, which failed two
 * ways: SQLite said "unknown database [dbo]", and a SQL Server login whose default
 * schema was something else had push look for `[dbo].[widgets]`, miss the table it
 * had created, and then fail with "there is already an object named ...".
 */
export declare function defaultSchemaFor(_provider: Provider): string;
/**
 * One `@@unique` or `@@index`, with the options `db:migrate` already understands.
 *
 * `name` matters as much as the fields: `map:` is how a schema asks for a specific
 * artifact name, and if push invented its own the two commands would create two
 * different constraints for the same directive — and the next migration would keep
 * trying to add the one push never made.
 */
export interface PushIndex {
    fields: string[];
    name?: string | undefined;
    includeFields?: string[] | undefined;
    filter?: string | undefined;
    options?: string | undefined;
}
export interface PushSchema {
    models: PushModel[];
    /** `view` blocks, applied after the tables they read from. */
    views: PushView[];
    /** Field types the provider does not have; empty when the schema is valid. */
    issues: FieldTypeIssue[];
}
/**
 * The name a `@@unique` or `@@index` artifact gets.
 *
 * `map:` wins; otherwise the name is derived from the table and fields, which is what
 * both commands have always done for an unnamed directive.
 */
export declare function directiveName(directive: PushIndex, table: string, kind: 'compound' | 'index', position: number): string;
/**
 * Reads schema text for push, validating every field type against the provider.
 *
 * All bad types come back in `issues` rather than as an exception, so the caller
 * can print them as a group. A field whose type matches no table is only a
 * mistake once the whole schema has been read: it may be a relation to a model
 * declared further down.
 */
export declare function parsePushSchema(text: string, provider: Provider): PushSchema;
/**
 * The table name to create, `schema.table` unless the model cleared the schema.
 *
 * An empty schema has to stay empty: `[].[widgets]` is not valid SQL, which is the
 * whole reason `@@schema("")` exists.
 */
/**
 * An identifier for a generated artifact name: letters, digits and underscores only.
 *
 * The name goes into DDL as an identifier, so anything else is replaced rather than
 * quoted — `@@map("catalog entries")` must not produce a name the provider rejects.
 */
export declare function safeIdentifierName(raw: string): string;
export declare function qualifiedTableName(model: PushModel): string;
/** The view name to create, qualified only when the view declared a schema. */
export declare function qualifiedViewName(view: PushView): string;

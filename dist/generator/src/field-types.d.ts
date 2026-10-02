export type Provider = 'mssql' | 'postgres' | 'mysql' | 'sqlite' | 'googlesheets';
/** Order used when printing issues and when suggesting a provider. */
export declare const PROVIDERS: readonly Provider[];
/**
 * SQL Server is the default provider: it is the only one `db:push`, `db:pull`
 * and `db:migrate` actually support, and it is what existing `.an5` schemas
 * were written for. With no connection string, treat the schema as SQL Server —
 * the same fallback `an5Adapter` uses.
 */
export declare const DEFAULT_PROVIDER: Provider;
/** Display name, used in error messages. */
export declare const PROVIDER_LABELS: Record<Provider, string>;
/** The TypeScript type a field is generated as. */
export type TsType = 'string' | 'number' | 'number | bigint' | 'boolean' | 'Date' | 'Buffer' | 'any' | 'number[] | string';
/**
 * Valid column types per provider: what is written in `.an5` → the TypeScript
 * type generated for it.
 *
 * Keys are stored upper case and lookups are case-insensitive. This table is
 * the single source of truth — nowhere else is allowed to enumerate types.
 */
export declare const PROVIDER_FIELD_TYPES: Record<Provider, Readonly<Record<string, TsType>>>;
/** The type table of one provider. */
export declare function fieldTypesFor(provider: Provider): Readonly<Record<string, TsType>>;
/**
 * A column type for a TypeScript type, valid on `provider`.
 *
 * Unknown TypeScript types fall back to that provider's string type, which is the
 * only choice that can hold any value.
 */
export declare function defaultSqlTypeForTs(tsType: string, provider?: Provider): string;
/** One bad field type, with everything needed to print it. */
export interface FieldTypeIssue {
    /** `Model.field`, or just the field name when there is no model. */
    path: string;
    message: string;
}
/** Every bad field type reported at once, instead of stopping at the first. */
export declare class FieldTypeError extends Error {
    readonly provider: Provider;
    readonly issues: FieldTypeIssue[];
    constructor(provider: Provider, issues: FieldTypeIssue[]);
}
/**
 * Splits `NVARCHAR(255)` into name and parameters.
 *
 * The name keeps every word, because `DOUBLE PRECISION` and
 * `TIMESTAMP WITH TIME ZONE` are single entries in the PostgreSQL table. It is
 * upper-cased and whitespace-collapsed here so lookups do not depend on how the
 * schema was written.
 */
export declare function splitTypeParams(raw: string): {
    base: string;
    params: string;
};
export interface ResolvedFieldType {
    /** Normalised type name, e.g. `DOUBLE PRECISION`. */
    base: string;
    /** The parameters in parentheses, e.g. `255` for `NVARCHAR(255)`. */
    params: string;
    /** The first word of `base`, used to guess "which type was meant". */
    head: string;
    /** The matching TypeScript type. */
    ts: TsType;
}
/**
 * Looks a type up in the provider's table, or null when the provider has no such
 * type.
 *
 * Called before deciding whether a field is a relation, so an upper-case type
 * that happens to match a model name (`TEXT`, `NAME`) still becomes a column.
 */
export declare function resolveFieldType(raw: string, provider: Provider): ResolvedFieldType | null;
/**
 * Message for a type the provider does not have.
 *
 * `modelNames` holds the models in the schema: an upper-case token may be a
 * model name (a relation) rather than a mistyped type, so the message has to
 * name both possibilities instead of guessing.
 */
export declare function unknownFieldTypeMessage(raw: string, provider: Provider, modelNames?: readonly string[]): string;
/**
 * The head of a field line: the column name and type, with the `@attributes`
 * that may follow removed.
 *
 * The type is joined from every remaining token instead of just the second one,
 * because a multi-word type (`DOUBLE PRECISION`, `TIMESTAMP WITH TIME ZONE`)
 * truncated to its first word matches no table. Returns null when the line has
 * no name or no type.
 */
export declare function readFieldLineHead(line: string): {
    name: string;
    type: string;
    isArray: boolean;
    isOptional: boolean;
} | null;

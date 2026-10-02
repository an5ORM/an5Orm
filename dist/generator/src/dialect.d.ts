/**
 * SQL dialect per database provider, for the commands that write to a database.
 *
 * Field types are per provider (see `./field-types`), and so is the SQL that
 * carries them. Until now `db:push` emitted SQL Server T-SQL for every connection
 * string: `sys.tables` lookups, `[bracket]` quoting, `DEFAULT IDENTITY(1,1)`,
 * `NEWID()`. Pointed at PostgreSQL that failed on the first catalog query with a
 * driver error saying nothing about the real problem.
 *
 * Each dialect answers the same questions — how to quote, where the catalog lives,
 * what a column definition looks like — so `db:push` reads them once instead of
 * branching per provider. SQL Server's answers are the ones it already produced, so
 * an existing SQL Server project sees no change apart from the two bugs called out
 * on the builders below.
 */
import { Provider } from './field-types';
/**
 * A single-quoted SQL string literal.
 *
 * Every provider doubles an embedded quote, so one helper covers them all. These
 * values come from the schema files, so they are the project's own — but an
 * apostrophe in a column name would otherwise close the literal and produce SQL
 * that means something else entirely.
 */
export declare function sqlLiteral(value: string): string;
/** One column of a table, as the schema describes it — same shape `db:push` parses. */
export interface ColumnSpec {
    name: string;
    /** The type as written in the schema, already validated for the provider. */
    sqlType: string;
    /** `@id`. Named to match the rest of the schema model. */
    isId: boolean;
    isUnique: boolean;
    isOptional: boolean;
    /** The raw `@default(...)` expression, e.g. `now()` or `"draft"`. */
    defaultExpr?: string | undefined;
}
export interface PushDialect {
    readonly provider: Provider;
    /** Whether this database can be written to with DDL at all. */
    readonly supportsDdl: boolean;
    /** Quotes a single identifier. */
    quote(name: string): string;
    /** Quotes a possibly schema-qualified name; an empty schema means no prefix. */
    quoteTable(raw: string): string;
    /**
     * Whether a compound unique can be a named table constraint.
     *
     * SQLite has no such thing — a UNIQUE becomes an implicit index the engine names
     * itself — so it becomes a uniquely named index instead, which is the only way to
     * keep `db:push` idempotent.
     */
    readonly supportsNamedUniqueConstraint: boolean;
    /**
     * Whether `ALTER TABLE ... ADD <column>` may carry a UNIQUE.
     *
     * SQLite refuses outright ("Cannot add a UNIQUE column"), so there the unique is
     * added as a separate index — otherwise a new `@unique` column could not be
     * pushed onto an existing table at all.
     */
    readonly supportsUniqueInlineOnAddColumn: boolean;
    /** Query returning one row when the table exists. */
    tableExists(raw: string): string;
    /** Query returning one row when the column exists. */
    columnExists(raw: string, column: string): string;
    /** Query returning one row when the unique constraint exists. */
    uniqueConstraintExists(raw: string, name: string): string;
    /** Query returning one row when the index exists. */
    indexExists(raw: string, name: string): string;
    /** One column definition, as it appears inside `CREATE TABLE`. */
    columnDefinition(column: ColumnSpec): string;
    createTable(quotedTable: string, columnDefs: string[]): string;
    createIndex(quotedName: string, quotedTable: string, quotedFields: string[]): string;
    createUniqueIndex(quotedName: string, quotedTable: string, quotedFields: string[]): string;
    /** `ALTER TABLE ... ADD <column>`, nullability included. */
    addColumn(quotedTable: string, column: ColumnSpec): string;
    addUniqueConstraint(quotedName: string, quotedTable: string, quotedFields: string[]): string;
}
/** The dialect that writes DDL for a provider. */
export declare function dialectFor(provider: Provider): PushDialect;
/**
 * Renders a `@default(...)` expression as the SQL that follows the column type.
 *
 * Returns an empty string when the provider has no equivalent — SQLite has no
 * default functions, so `uuid()` is left to the adapter, which fills a string
 * primary key in before inserting.
 */
export declare function defaultClause(expression: string | undefined, provider: Provider): string;

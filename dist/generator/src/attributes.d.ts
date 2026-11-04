/**
 * Reading `@attribute(...)` arguments from a `.an5` field or model line.
 *
 * The schema used to be read with regexes such as `/@default\((.*)\)/`, which
 * ran to the *last* `)` on the line. A field with `@default(now())` followed by
 * `@description("...")` therefore had `now()) @description("..."` as its default
 * expression, and `db:push` emitted SQL no database accepts. The closing
 * parenthesis has to be the one that matches the opening one — parentheses nest
 * (`now()`, `uuid()`, `lower(...)`) and quoted strings may contain both.
 *
 * These helpers only read attributes; they do not validate the schema language.
 */
/** Whether `line` has the attribute, with or without arguments. */
export declare function hasAttribute(line: string, name: string): boolean;
/**
 * The raw argument text of the first `name(...)` on `line`.
 *
 * Returns `undefined` when the attribute is absent, or when it is written
 * without parentheses. The returned text keeps its quotes, so callers decide
 * whether they are reading a string, a number or an expression.
 */
export declare function attributeArgs(line: string, name: string): string | undefined;
/** Strips one pair of surrounding double quotes, if present. */
export declare function unquote(value: string | undefined): string | undefined;
/**
 * Splits schema text into logical lines, keeping a triple-quoted `@@sql` body on
 * one line.
 *
 * The parsers read a schema line by line. Without this, a multi-line view body
 * would end the directive at its first newline and the rest of the `SELECT`
 * would be read as fields of the view. Newlines inside the quotes are preserved;
 * only the split points change.
 */
export declare function splitSchemaLines(text: string): string[];
/**
 * Reads a named string option from an attribute argument list, e.g.
 * `map: "UQ_users_email"` in `@unique(map: "UQ_users_email")`.
 */
export declare function stringOption(args: string | undefined, key: string): string | undefined;
/** Reads a named field-list option, e.g. `include: [email, tenantId]`. */
export declare function fieldListOption(args: string | undefined, key: string): string[] | undefined;
/** One `@@unique` or `@@index` directive, with the options it accepts. */
export interface IndexDirective {
    fields: string[];
    name?: string;
    includeFields?: string[];
    filter?: string;
    options?: string;
}
/**
 * Parses the inside of `@@unique([a, b], map: "…", include: […], …)`.
 *
 * The directive is the one place a schema can carry raw SQL (`filter`,
 * `options`), so its argument list is balanced rather than cut at the first
 * `)`. A filter such as `(deletedAt IS NULL)` used to truncate the directive.
 */
export declare function parseIndexDirective(args: string | undefined): IndexDirective | null;

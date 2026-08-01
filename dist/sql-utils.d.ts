import type { RelationDef } from "./metadata";
/**
 * SQL Server identifier quoting.
 *
 * Wraps a bare identifier in square brackets and escapes any embedded
 * closing bracket (`]` → `]]`), which is the only character that can break
 * out of a bracketed identifier in T-SQL. This blocks SQL injection through
 * user-supplied column / alias names.
 */
export declare function quoteIdentifier(name: string): string;
/** Sanitizes a parameter name to a safe T-SQL identifier fragment. */
export declare function sanitizeParamName(name: string): string;
/** Validates a direction token, defaulting to ASC. */
export declare function normalizeSortDirection(dir: unknown): "ASC" | "DESC";
/** Coerces a value to a non-negative integer, or returns the fallback. */
export declare function toNonNegativeInt(value: unknown, fallback?: number): number;
export interface QueryContext {
    relationMap?: Record<string, Record<string, RelationDef>>;
    modelToTable?: Record<string, string>;
}
export declare function buildOrderBy(orderBy: any): string;
/**
 * Recursively builds a WHERE clause from a Prisma-style filter object.
 *
 * Values are always bound as parameters (`@name`); only identifiers are
 * interpolated directly, and they are run through {@link quoteIdentifier}.
 */
export declare function parseWhere(modelName: string, where: any, params: Record<string, any>, prefix?: string, ctx?: QueryContext): string;
//# sourceMappingURL=sql-utils.d.ts.map
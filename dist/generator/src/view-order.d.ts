/**
 * Orders views so one that reads another is created after it.
 *
 * Tables are created before any view, but views are not all independent of each
 * other: a summary view may select from a detail view. PostgreSQL and SQLite
 * reject `CREATE VIEW` when the referenced relation does not exist yet, so
 * declaration order in the schema file is not enough.
 *
 * The reference check is deliberately textual: a full SQL parser would be the
 * only way to be exact, and a false positive here merely reorders two independent
 * views. Missing an edge leaves the old declaration order, which is what this
 * function improves on rather than replaces.
 */
/** A view plus every identifier its SQL may use to reference it. */
export interface ViewOrderEntry {
    /** Physical name, model name, or both; qualified names are reduced to their last part too. */
    names: readonly string[];
    sql: string;
}
export interface ViewOrderResult<T> {
    ordered: T[];
    /** True when the references form a cycle, which no view definition can satisfy. */
    cyclic: boolean;
}
/**
 * Stable topological sort of `views`.
 *
 * Kahn's algorithm in declaration order, so a schema that was already correct is
 * left untouched. A cycle cannot be created by a database view definition; when
 * one is detected the remaining views keep their original order and the caller
 * can decide whether to warn or let the database report the error.
 */
export declare function orderViewsByDependency<T extends ViewOrderEntry>(views: readonly T[]): ViewOrderResult<T>;

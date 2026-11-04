"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderViewsByDependency = orderViewsByDependency;
/** Escapes a name for a regular expression. */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Identifiers in `sql` lose their quoting so `[s].[v]`, `"s"."v"` and `s.v` compare alike. */
function unquoteIdentifiers(sql) {
    return sql.replace(/[[\]"`]/g, '');
}
function mentions(sql, name) {
    if (!name)
        return false;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(name)}([^A-Za-z0-9_$]|$)`, 'i');
    return pattern.test(sql);
}
/** Every way a view in this schema can be referenced: `schema.name`, `name`, or a mapped name. */
function referenceNames(names) {
    const result = new Set();
    for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed)
            continue;
        result.add(trimmed);
        const dot = trimmed.lastIndexOf('.');
        if (dot >= 0 && dot < trimmed.length - 1)
            result.add(trimmed.slice(dot + 1));
    }
    return Array.from(result);
}
/**
 * Stable topological sort of `views`.
 *
 * Kahn's algorithm in declaration order, so a schema that was already correct is
 * left untouched. A cycle cannot be created by a database view definition; when
 * one is detected the remaining views keep their original order and the caller
 * can decide whether to warn or let the database report the error.
 */
function orderViewsByDependency(views) {
    if (views.length < 2)
        return { ordered: [...views], cyclic: false };
    const references = views.map((view) => referenceNames(view.names));
    const normalizedSql = views.map((view) => unquoteIdentifiers(view.sql));
    const byName = new Map();
    const owners = new Map();
    for (let index = 0; index < references.length; index += 1) {
        for (const name of references[index] ?? []) {
            const key = name.toLowerCase();
            const existing = owners.get(key);
            if (existing)
                existing.add(index);
            else
                owners.set(key, new Set([index]));
        }
    }
    // A bare `summary` is ambiguous when two schemas both have one; a dependency
    // guessed from it could reorder unrelated views or invent a cycle. Only names
    // that identify one view take part.
    for (const [name, indices] of owners) {
        if (indices.size === 1)
            byName.set(name, Array.from(indices));
    }
    const dependencies = views.map(() => new Set());
    for (let index = 0; index < views.length; index += 1) {
        for (const [name, candidates] of byName) {
            if (!mentions(normalizedSql[index] ?? '', name))
                continue;
            for (const candidate of candidates) {
                if (candidate !== index)
                    dependencies[index]?.add(candidate);
            }
        }
    }
    const dependents = views.map(() => []);
    const indegree = views.map((_, index) => dependencies[index]?.size ?? 0);
    for (let index = 0; index < dependencies.length; index += 1) {
        for (const dependency of dependencies[index] ?? []) {
            dependents[dependency]?.push(index);
        }
    }
    const ordered = [];
    const queued = new Set();
    const ready = [];
    for (let index = 0; index < views.length; index += 1) {
        if ((indegree[index] ?? 0) === 0)
            ready.push(index);
    }
    while (ready.length > 0) {
        const index = ready.shift();
        if (queued.has(index))
            continue;
        queued.add(index);
        ordered.push(views[index]);
        for (const dependent of dependents[index] ?? []) {
            const remaining = (indegree[dependent] ?? 0) - 1;
            indegree[dependent] = remaining;
            if (remaining === 0)
                ready.push(dependent);
        }
    }
    const cyclic = ordered.length !== views.length;
    // A cycle is preserved as written, which is the only order the caller can act
    // on; dropping the views would silently change the schema.
    for (let index = 0; index < views.length; index += 1) {
        if (!queued.has(index))
            ordered.push(views[index]);
    }
    return { ordered, cyclic };
}

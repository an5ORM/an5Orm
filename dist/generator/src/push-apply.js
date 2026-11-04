"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySchema = applySchema;
/**
 * Applying a schema to a database: what `db:push` does once the schema is read.
 *
 * Kept out of `push.ts` so the sequence can be run against a real database in a
 * test — the CLI needs a live server, and a test that re-implements the sequence
 * instead of calling it proves only that the copy works.
 *
 * The database is two functions rather than the adapter, which keeps this testable
 * and keeps the driver out of the decision making.
 */
const dialect_1 = require("./dialect");
const push_schema_1 = require("./push-schema");
const view_order_1 = require("./view-order");
/**
 * Creates whatever the schema has and the database does not.
 *
 * The order is deliberate: a table first, then missing columns, then unique
 * constraints and indexes — a unique over a column that does not exist yet fails.
 * Everything is checked before it is created, so running it twice changes nothing.
 */
async function applySchema(models, dialect, db, views = []) {
    const result = {
        tablesCreated: 0,
        tablesAltered: 0,
        columnsAdded: 0,
        indexesCreated: 0,
        uniqueConstraintsAdded: 0,
        viewsApplied: 0,
    };
    for (const model of models) {
        const tableName = (0, push_schema_1.qualifiedTableName)(model);
        const sqlTableName = dialect.quoteTable(tableName);
        const quoteFields = (fields) => fields.map((field) => dialect.quote(field));
        db.log(`Processing table ${sqlTableName}...`);
        const safeName = (0, push_schema_1.safeIdentifierName)(model.tableName);
        // SQLite has no named unique constraints — a UNIQUE there becomes an index the
        // engine names itself — so the unique index carries our name instead, and that
        // name is what the existence check can look for.
        const compoundUniques = model.compoundUniques.map((directive, idx) => ({
            name: (0, push_schema_1.directiveName)(directive, model.tableName, 'compound', idx),
            fields: directive.fields,
            directive,
        }));
        const tableExists = (await db.query(dialect.tableExists(tableName))).length > 0;
        if (!tableExists) {
            db.log(`Creating table ${sqlTableName}...`);
            const columnDefs = model.fields.map((field) => dialect.columnDefinition(field));
            for (const entry of compoundUniques) {
                if (!dialect.supportsNamedUniqueConstraint)
                    continue;
                const fieldsStr = quoteFields(entry.fields).join(', ');
                columnDefs.push(`CONSTRAINT ${dialect.quote(entry.name)} UNIQUE (${fieldsStr})`);
            }
            await db.execute(dialect.createTable(sqlTableName, columnDefs));
            db.log(`✅ Table ${sqlTableName} created.`);
            result.tablesCreated += 1;
        }
        else {
            for (const field of model.fields) {
                const columnExists = (await db.query(dialect.columnExists(tableName, field.name))).length > 0;
                if (columnExists)
                    continue;
                db.log(`Adding column ${dialect.quote(field.name)} to table ${sqlTableName}...`);
                await db.execute(dialect.addColumn(sqlTableName, field));
                result.columnsAdded += 1;
                // A new `@unique` column needs its unique too, and on SQLite that cannot
                // ride along with the ADD COLUMN — SQLite refuses to add a UNIQUE column.
                if (field.isUnique && !field.isId && !dialect.supportsUniqueInlineOnAddColumn) {
                    // The same name `db:migrate` expects for this column's unique, so the
                    // next diff sees push's artifact instead of adding another one.
                    const indexName = field.uniqueName ?? `UQ_${safeName}_${field.name}`;
                    const quoted = dialect.quote(indexName);
                    if ((await db.query(dialect.uniqueConstraintExists(tableName, indexName))).length === 0) {
                        db.log(`Creating unique index ${quoted} on table ${sqlTableName}...`);
                        await db.execute(dialect.createUniqueIndex(quoted, sqlTableName, quoteFields([field.name])));
                        result.uniqueConstraintsAdded += 1;
                    }
                }
            }
            result.tablesAltered += 1;
        }
        // Unique constraints that are not part of the column definitions above.
        for (const entry of compoundUniques) {
            if (await hasUniqueConstraint(db, dialect, tableName, entry.name))
                continue;
            const quoted = dialect.quote(entry.name);
            if (dialect.supportsNamedUniqueConstraint) {
                db.log(`Adding compound unique constraint ${quoted} to table ${sqlTableName}...`);
                await db.execute(dialect.addUniqueConstraint(quoted, sqlTableName, quoteFields(entry.fields)));
            }
            else {
                db.log(`Creating unique index ${quoted} on table ${sqlTableName}...`);
                await db.execute(dialect.createUniqueIndex(quoted, sqlTableName, quoteFields(entry.fields)));
                result.indexesCreated += 1;
            }
            result.uniqueConstraintsAdded += 1;
        }
        for (const [idx, directive] of model.indexes.entries()) {
            const name = (0, push_schema_1.directiveName)(directive, model.tableName, 'index', idx);
            if ((await db.query(dialect.indexExists(tableName, name))).length > 0)
                continue;
            const quoted = dialect.quote(name);
            db.log(`Creating index ${quoted} on table ${sqlTableName}...`);
            await db.execute(dialect.createIndex(quoted, sqlTableName, quoteFields(directive.fields), {
                includeFields: directive.includeFields ? quoteFields(directive.includeFields) : undefined,
                filter: directive.filter,
                options: directive.options,
            }));
            result.indexesCreated += 1;
        }
    }
    // Views are applied after every table: a view may select from a table this same
    // push created, and SQL Server validates the reference while compiling it.
    // Within the views, a dependent view has to come after the one it reads.
    const orderedViews = (0, view_order_1.orderViewsByDependency)(views.map((view) => ({
        view,
        names: [(0, push_schema_1.qualifiedViewName)(view), view.viewName],
        sql: view.sql,
    })));
    if (orderedViews.cyclic) {
        // The definitions cannot all exist at once; the database reports which one
        // is missing, which is more useful than a generic ordering error here.
        db.log('Warning: view definitions reference each other in a cycle; keeping schema order.');
    }
    for (const { view } of orderedViews.ordered) {
        const viewName = (0, push_schema_1.qualifiedViewName)(view);
        const sqlViewName = dialect.quoteTable(viewName);
        db.log(`Processing view ${sqlViewName}...`);
        const rows = await db.query(dialect.viewDefinition(viewName));
        const existing = rows[0];
        if (existing && (0, dialect_1.normalizeViewSql)(existing.definition) === (0, dialect_1.normalizeViewSql)(view.sql)) {
            // The catalog and the schema agree; recreating would just churn dependencies.
            continue;
        }
        if (existing && !dialect.supportsCreateOrReplaceView) {
            db.log(`Dropping view ${sqlViewName} before recreating it...`);
            await db.execute(dialect.dropView(sqlViewName));
        }
        db.log(`Creating view ${sqlViewName}...`);
        await db.execute(dialect.createView(sqlViewName, view.sql));
        result.viewsApplied += 1;
    }
    return result;
}
/**
 * Whether the unique is already there.
 *
 * A compound unique created inside `CREATE TABLE` has no separate object to look
 * for on the providers that keep them, so it is treated as present once the table
 * exists; the per-column uniques inside a column definition are handled with the
 * column above.
 */
async function hasUniqueConstraint(db, dialect, tableName, name) {
    return (await db.query(dialect.uniqueConstraintExists(tableName, name))).length > 0;
}

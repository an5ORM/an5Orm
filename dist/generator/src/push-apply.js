"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeIdentifierName = safeIdentifierName;
exports.applySchema = applySchema;
const push_schema_1 = require("./push-schema");
/**
 * An identifier for a generated name: letters, digits and underscores only.
 *
 * The name goes into DDL as an identifier, so anything else is replaced rather
 * than quoted — `@@map("catalog entries")` must not produce a name the provider
 * then rejects.
 */
function safeIdentifierName(raw) {
    return raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}
/**
 * Creates whatever the schema has and the database does not.
 *
 * The order is deliberate: a table first, then missing columns, then unique
 * constraints and indexes — a unique over a column that does not exist yet fails.
 * Everything is checked before it is created, so running it twice changes nothing.
 */
async function applySchema(models, dialect, db) {
    const result = {
        tablesCreated: 0,
        tablesAltered: 0,
        columnsAdded: 0,
        indexesCreated: 0,
        uniqueConstraintsAdded: 0,
    };
    for (const model of models) {
        const tableName = (0, push_schema_1.qualifiedTableName)(model);
        const sqlTableName = dialect.quoteTable(tableName);
        const quoteFields = (fields) => fields.map((field) => dialect.quote(field));
        db.log(`Processing table ${sqlTableName}...`);
        const safeName = safeIdentifierName(model.tableName);
        // SQLite has no named unique constraints — a UNIQUE there becomes an index the
        // engine names itself — so the unique index carries our name instead, and that
        // name is what the existence check can look for.
        const compoundUniques = model.compoundUniques.map((fields, idx) => ({
            name: `UQ_${safeName}_compound_${idx}`,
            fields,
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
                    const indexName = `UQ_${safeName}_${field.name}`;
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
                result.uniqueConstraintsAdded += 1;
            }
            result.uniqueConstraintsAdded += 1;
        }
        for (const [idx, fields] of model.indexes.entries()) {
            const name = `IX_${safeName}_${fields.join('_')}`;
            if ((await db.query(dialect.indexExists(tableName, name))).length > 0)
                continue;
            const quoted = dialect.quote(name);
            db.log(`Creating index ${quoted} on table ${sqlTableName}...`);
            await db.execute(dialect.createIndex(quoted, sqlTableName, quoteFields(fields)));
            result.indexesCreated += 1;
        }
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

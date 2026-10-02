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
import { PushDialect } from './dialect';
import { PushIndex, PushModel, directiveName, qualifiedTableName, safeIdentifierName } from './push-schema';

/** The two things this needs from a database connection. */
export interface PushDatabase {
  /** Runs a query and returns its rows; existence checks are `length > 0`. */
  query(sql: string): Promise<readonly unknown[]>;
  /** Runs one statement. */
  execute(sql: string): Promise<void>;
  /** Progress, so the CLI prints what it is doing. */
  log(message: string): void;
}

export interface ApplyResult {
  /** How many tables were created, and how many altered. */
  tablesCreated: number;
  tablesAltered: number;
  columnsAdded: number;
  indexesCreated: number;
  uniqueConstraintsAdded: number;
}

/**
 * Creates whatever the schema has and the database does not.
 *
 * The order is deliberate: a table first, then missing columns, then unique
 * constraints and indexes — a unique over a column that does not exist yet fails.
 * Everything is checked before it is created, so running it twice changes nothing.
 */
export async function applySchema(
  models: readonly PushModel[],
  dialect: PushDialect,
  db: PushDatabase,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    tablesCreated: 0,
    tablesAltered: 0,
    columnsAdded: 0,
    indexesCreated: 0,
    uniqueConstraintsAdded: 0,
  };

  for (const model of models) {
    const tableName = qualifiedTableName(model);
    const sqlTableName = dialect.quoteTable(tableName);
    const quoteFields = (fields: readonly string[]) => fields.map((field) => dialect.quote(field));
    db.log(`Processing table ${sqlTableName}...`);

    const safeName = safeIdentifierName(model.tableName);
    // SQLite has no named unique constraints — a UNIQUE there becomes an index the
    // engine names itself — so the unique index carries our name instead, and that
    // name is what the existence check can look for.
    const compoundUniques = model.compoundUniques.map((directive, idx) => ({
      name: directiveName(directive, model.tableName, 'compound', idx),
      fields: directive.fields,
      directive,
    }));

    const tableExists = (await db.query(dialect.tableExists(tableName))).length > 0;

    if (!tableExists) {
      db.log(`Creating table ${sqlTableName}...`);
      const columnDefs = model.fields.map((field) => dialect.columnDefinition(field));
      for (const entry of compoundUniques) {
        if (!dialect.supportsNamedUniqueConstraint) continue;
        const fieldsStr = quoteFields(entry.fields).join(', ');
        columnDefs.push(`CONSTRAINT ${dialect.quote(entry.name)} UNIQUE (${fieldsStr})`);
      }
      await db.execute(dialect.createTable(sqlTableName, columnDefs));
      db.log(`✅ Table ${sqlTableName} created.`);
      result.tablesCreated += 1;
    } else {
      for (const field of model.fields) {
        const columnExists = (await db.query(dialect.columnExists(tableName, field.name))).length > 0;
        if (columnExists) continue;
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
      if (await hasUniqueConstraint(db, dialect, tableName, entry.name)) continue;
      const quoted = dialect.quote(entry.name);
      if (dialect.supportsNamedUniqueConstraint) {
        db.log(`Adding compound unique constraint ${quoted} to table ${sqlTableName}...`);
        await db.execute(dialect.addUniqueConstraint(quoted, sqlTableName, quoteFields(entry.fields)));
      } else {
        db.log(`Creating unique index ${quoted} on table ${sqlTableName}...`);
        await db.execute(dialect.createUniqueIndex(quoted, sqlTableName, quoteFields(entry.fields)));
        result.indexesCreated += 1;
        result.uniqueConstraintsAdded += 1;
      }
      result.uniqueConstraintsAdded += 1;
    }

    for (const [idx, directive] of model.indexes.entries()) {
      const name = directiveName(directive, model.tableName, 'index', idx);
      if ((await db.query(dialect.indexExists(tableName, name))).length > 0) continue;
      const quoted = dialect.quote(name);
      db.log(`Creating index ${quoted} on table ${sqlTableName}...`);
      await db.execute(dialect.createIndex(quoted, sqlTableName, quoteFields(directive.fields)));
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
async function hasUniqueConstraint(
  db: PushDatabase,
  dialect: PushDialect,
  tableName: string,
  name: string,
): Promise<boolean> {
  return (await db.query(dialect.uniqueConstraintExists(tableName, name))).length > 0;
}
import "dotenv/config";
import { An5Adapter } from "@an5/adapters";
import { loadConfig, providerFromConfig, resolveConnectionString } from "./generator/src/config";
import { Provider } from "./generator/src/field-types";
import { sqlServerOnlyError } from "./provider-support";
import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const { config, outputs } = loadConfig();
const schemaDir = outputs.schemaDir;

let _adapter: An5Adapter | null = null;
async function getDb(): Promise<An5Adapter> {
  if (!_adapter) {
    _adapter = new An5Adapter({ connectionString: resolveConnectionString(config, process.env, "db:cleanup") });
    await _adapter.$connect();
  }
  return _adapter;
}

/**
 * Prints why a command cannot run against this provider and exits.
 *
 * The decision and the wording live in `./provider-support`, which stays free of Node
 * globals so it can be imported and tested anywhere; only the command files, which
 * are Node programs, do the exiting.
 */
function refuseIfNotSqlServer(provider: Provider, command: string): void {
  const message = sqlServerOnlyError(provider, command);
  if (message === null) return;
  console.error(message);
  process.exit(1);
}

/**
 * The tables and views the schema files declare, lower-cased.
 *
 * SQL Server compares object names case-insensitively in the default collation,
 * so `Users` and `users` are the same object here; a case-sensitive comparison
 * would drop a table the schema still declares.
 */
function declaredObjects(schemaText: string): { tables: Set<string>; views: Set<string> } {
  const tables = new Set<string>();
  const views = new Set<string>();
  let block: 'model' | 'view' | null = null;
  let blockName = '';

  for (const rawLine of schemaText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const start = /^(model|view)\s+(\w+)\s*\{/.exec(line);
    if (start) {
      block = start[1] as 'model' | 'view';
      blockName = start[2] ?? '';
      if (block === 'model') tables.add(blockName.toLowerCase() + 's');
      else views.add(blockName.toLowerCase() + 's');
      continue;
    }

    if (line === '}') {
      block = null;
      continue;
    }

    const mapped = /^@@map\(\s*"([^"]+)"\s*\)/.exec(line);
    if (mapped?.[1]) {
      // A mapped name replaces the default one, but `@@map` outside a block is
      // still read as a table name: older schema files may have it there.
      const target = block === 'view' ? views : tables;
      target.add(mapped[1].toLowerCase());
    }
  }

  return { tables, views };
}

/** Quotes a catalog identifier, doubling `]` the way T-SQL expects. */
function quoteName(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

async function cleanup() {
  // Drops tables by comparing sys.tables with the schema files, so a non-SQL
  // Server connection string is a mistake worth naming first.
  refuseIfNotSqlServer(providerFromConfig(config, process.env), "db:cleanup");

  console.log("🧹 Starting database cleanup...");

  let schemaText = "";
  if (fs.existsSync(schemaDir)) {
    const files = fs.readdirSync(schemaDir).filter(f => f.endsWith(".an5"));
    for (const file of files) {
      schemaText += fs.readFileSync(path.join(schemaDir, file), "utf8") + "\n";
    }
  } else {
    const schemaPath = path.join(__dirname, "schema.an5");
    if (fs.existsSync(schemaPath)) {
      schemaText = fs.readFileSync(schemaPath, "utf8");
    } else {
      console.error("No schema found!");
      process.exit(1);
    }
  }

  const { tables: validTables, views: validViews } = declaredObjects(schemaText);

  // Also include the capitalization variations from an5Metadata if we can,
  // but schema.an5 is the source of truth.

  console.log("Valid tables from schema:", Array.from(validTables));
  console.log("Valid views from schema:", Array.from(validViews));

  const dbTables = await (await getDb()).$queryRawUnsafe<any>(`
    SELECT name FROM sys.tables WHERE is_ms_shipped = 0
  `);
  const dbViews = await (await getDb()).$queryRawUnsafe<any>(`
    SELECT name FROM sys.views WHERE is_ms_shipped = 0
  `);

  const tablesToDrop = dbTables
    .map(t => t.name)
    .filter(name => !validTables.has(name.toLowerCase()));
  const viewsToDrop = dbViews
    .map(v => v.name)
    .filter(name => !validViews.has(name.toLowerCase()));

  // Views go first: one of them may read a table that is about to be dropped, and
  // an orphan view is exactly what this command is meant to remove.
  if (viewsToDrop.length > 0) {
    console.log("Views to be DROPPED:", viewsToDrop);
    for (const view of viewsToDrop) {
      console.log(`Dropping view [${view}]...`);
      try {
        await (await getDb()).$executeRawUnsafe(`DROP VIEW IF EXISTS ${quoteName(view)}`);
        console.log(`✅ Dropped [${view}]`);
      } catch (err: any) {
        console.error(`❌ Failed to drop view [${view}]: ${err.message}`);
      }
    }
  }

  if (tablesToDrop.length === 0) {
    console.log(viewsToDrop.length === 0
      ? "✅ No extra tables found. Database is clean."
      : "✅ No extra tables found.");
    console.log("✅ Cleanup completed.");
    process.exit(0);
  }

  console.log("Tables to be DROPPED:", tablesToDrop);

  for (const table of tablesToDrop) {
    console.log(`Dropping table [${table}]...`);
    try {
      // We need to handle foreign key constraints.
      // For a thorough cleanup, we might need to drop constraints first.
      // But for now, we'll try a simple DROP TABLE.
      await (await getDb()).$executeRawUnsafe(`DROP TABLE ${quoteName(table)}`);
      console.log(`✅ Dropped [${table}]`);
    } catch (err: any) {
      console.error(`❌ Failed to drop [${table}]: ${err.message}`);
      if (err.message.includes("FOREIGN KEY constraint")) {
          console.log(`Attempting to find and drop constraints for [${table}]...`);
          const constraints = await (await getDb()).$queryRawUnsafe<any>(`
            SELECT fk.name AS constraint_name, OBJECT_NAME(fk.parent_object_id) AS table_name
            FROM sys.foreign_keys AS fk
            WHERE OBJECT_NAME(fk.referenced_object_id) = @p_0 OR OBJECT_NAME(fk.parent_object_id) = @p_0
          `, table);
          
          for (const c of constraints) {
              console.log(`Dropping constraint [${c.constraint_name}] on [${c.table_name}]...`);
              await (await getDb()).$executeRawUnsafe(`ALTER TABLE ${quoteName(c.table_name)} DROP CONSTRAINT ${quoteName(c.constraint_name)}`);
          }
          // Try dropping again
          await (await getDb()).$executeRawUnsafe(`DROP TABLE ${quoteName(table)}`);
          console.log(`✅ Dropped [${table}] after removing constraints.`);
      }
    }
  }

  console.log("✅ Cleanup completed.");
  process.exit(0);
}

cleanup().catch(err => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const adapters_1 = require("@an5/adapters");
const config_1 = require("./generator/src/config");
const provider_support_1 = require("./provider-support");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const rootDir = process.cwd();
const { config, outputs } = (0, config_1.loadConfig)();
const schemaDir = outputs.schemaDir;
let _adapter = null;
async function getDb() {
    if (!_adapter) {
        _adapter = new adapters_1.An5Adapter({ connectionString: (0, config_1.resolveConnectionString)(config, process.env, "db:cleanup") });
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
function refuseIfNotSqlServer(provider, command) {
    const message = (0, provider_support_1.sqlServerOnlyError)(provider, command);
    if (message === null)
        return;
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
function declaredObjects(schemaText) {
    const tables = new Set();
    const views = new Set();
    let block = null;
    let blockName = '';
    for (const rawLine of schemaText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//'))
            continue;
        const start = /^(model|view)\s+(\w+)\s*\{/.exec(line);
        if (start) {
            block = start[1];
            blockName = start[2] ?? '';
            if (block === 'model')
                tables.add(blockName.toLowerCase() + 's');
            else
                views.add(blockName.toLowerCase() + 's');
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
function quoteName(name) {
    return `[${name.replace(/]/g, ']]')}]`;
}
async function cleanup() {
    // Drops tables by comparing sys.tables with the schema files, so a non-SQL
    // Server connection string is a mistake worth naming first.
    refuseIfNotSqlServer((0, config_1.providerFromConfig)(config, process.env), "db:cleanup");
    console.log("🧹 Starting database cleanup...");
    let schemaText = "";
    if (fs_1.default.existsSync(schemaDir)) {
        const files = fs_1.default.readdirSync(schemaDir).filter(f => f.endsWith(".an5"));
        for (const file of files) {
            schemaText += fs_1.default.readFileSync(path_1.default.join(schemaDir, file), "utf8") + "\n";
        }
    }
    else {
        const schemaPath = path_1.default.join(__dirname, "schema.an5");
        if (fs_1.default.existsSync(schemaPath)) {
            schemaText = fs_1.default.readFileSync(schemaPath, "utf8");
        }
        else {
            console.error("No schema found!");
            process.exit(1);
        }
    }
    const { tables: validTables, views: validViews } = declaredObjects(schemaText);
    // Also include the capitalization variations from an5Metadata if we can,
    // but schema.an5 is the source of truth.
    console.log("Valid tables from schema:", Array.from(validTables));
    console.log("Valid views from schema:", Array.from(validViews));
    const dbTables = await (await getDb()).$queryRawUnsafe(`
    SELECT name FROM sys.tables WHERE is_ms_shipped = 0
  `);
    const dbViews = await (await getDb()).$queryRawUnsafe(`
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
            }
            catch (err) {
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
        }
        catch (err) {
            console.error(`❌ Failed to drop [${table}]: ${err.message}`);
            if (err.message.includes("FOREIGN KEY constraint")) {
                console.log(`Attempting to find and drop constraints for [${table}]...`);
                const constraints = await (await getDb()).$queryRawUnsafe(`
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

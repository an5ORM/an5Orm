"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const adapters_1 = require("@an5/adapters");
const config_1 = require("./generator/src/config");
const field_types_1 = require("./generator/src/field-types");
const dialect_1 = require("./generator/src/dialect");
const push_apply_1 = require("./generator/src/push-apply");
const push_schema_1 = require("./generator/src/push-schema");
const rootDir = process.cwd();
const { config, outputs } = (0, config_1.loadConfig)();
const schemaDir = outputs.schemaDir;
// The target provider comes from the connection string: the allowed types have
// to match the database about to receive the SQL, not one list shared by every
// database.
const provider = (0, config_1.providerFromConfig)(config, process.env);
let _adapter = null;
async function getDb() {
    if (!_adapter) {
        _adapter = new adapters_1.An5Adapter({ connectionString: (0, config_1.resolveConnectionString)(config, process.env, "db:push") });
        await _adapter.$connect();
    }
    return _adapter;
}
async function push() {
    const dialect = (0, dialect_1.dialectFor)(provider);
    // Google Sheets is a grid of cells, not tables: there is no DDL to send and
    // nothing to create. Say that instead of failing inside the driver.
    if (!dialect.supportsDdl) {
        console.error(`❌ db:push has nothing to create for ${field_types_1.PROVIDER_LABELS[provider]}: a sheet is a\n` +
            '   range of cells, not a table, so there is no DDL to send.\n' +
            '   Write rows through the adapter instead — the header row appears on the\n' +
            '   first insert.');
        process.exit(1);
    }
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
            console.error(`No schema found in ${schemaDir} or schema.an5`);
            process.exit(1);
        }
    }
    const { models, views, issues } = (0, push_schema_1.parsePushSchema)(schemaText, provider);
    if (issues.length > 0)
        throw new field_types_1.FieldTypeError(provider, issues);
    console.log(`🚀 Pushing schema to database (${field_types_1.PROVIDER_LABELS[provider]})...`);
    const result = await (0, push_apply_1.applySchema)(models, dialect, {
        query: async (sql) => (await getDb()).$queryRawUnsafe(sql),
        execute: async (sql) => {
            await (await getDb()).$executeRawUnsafe(sql);
        },
        log: (message) => console.log(message),
    }, views);
    if (result.tablesCreated > 0)
        console.log(`   ${result.tablesCreated} table(s) created.`);
    if (result.columnsAdded > 0)
        console.log(`   ${result.columnsAdded} column(s) added.`);
    if (result.uniqueConstraintsAdded > 0)
        console.log(`   ${result.uniqueConstraintsAdded} unique(s) added.`);
    if (result.indexesCreated > 0)
        console.log(`   ${result.indexesCreated} index(es) created.`);
    if (result.viewsApplied > 0)
        console.log(`   ${result.viewsApplied} view(s) created or replaced.`);
    console.log("✅ Database push completed.");
    process.exit(0);
}
push().catch((err) => {
    // A field type error carries one line per offending field; the message alone
    // would name the provider without saying which fields to fix.
    if (err instanceof field_types_1.FieldTypeError) {
        console.error(`❌ ${err.message}:`);
        console.error((0, config_1.formatIssues)(err.issues));
    }
    else {
        console.error(`❌ Push failed: ${err instanceof Error ? err.message : err}`);
    }
    process.exit(1);
});

import "dotenv/config";
import fs from "fs";
import path from "path";
import { An5Adapter } from "@an5/adapters";
import { formatIssues, loadConfig, providerFromConfig, resolveConnectionString } from "./generator/src/config";
import { FieldTypeError, PROVIDER_LABELS } from "./generator/src/field-types";
import { dialectFor } from "./generator/src/dialect";
import { applySchema } from "./generator/src/push-apply";
import { parsePushSchema } from "./generator/src/push-schema";

const rootDir = process.cwd();
const { config, outputs } = loadConfig();
const schemaDir = outputs.schemaDir;

// The target provider comes from the connection string: the allowed types have
// to match the database about to receive the SQL, not one list shared by every
// database.
const provider = providerFromConfig(config, process.env);

let _adapter: An5Adapter | null = null;

async function getDb(): Promise<An5Adapter> {
  if (!_adapter) {
    _adapter = new An5Adapter({ connectionString: resolveConnectionString(config, process.env, "db:push") });
    await _adapter.$connect();
  }
  return _adapter;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--preview');
const skipSnapshot = args.includes('--no-snapshot');

function snapshotSqliteIfNeeded(connectionString: string): string | undefined {
  if (dryRun || skipSnapshot) return undefined;
  const match = connectionString.match(/^(?:sqlite|file):(?:\/\/)?(.+)$/i);
  if (!match) return undefined;
  const rawTarget = match[1].trim();
  if (!rawTarget || rawTarget === ':memory:') return undefined;
  const dbPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(rootDir, rawTarget);
  if (!fs.existsSync(dbPath)) return undefined;
  const snapDir = path.join(rootDir, '.an5', 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapPath = path.join(snapDir, `${path.basename(dbPath)}.${stamp}.bak`);
  fs.copyFileSync(dbPath, snapPath);
  // Keep only the 5 most recent snapshots for this database file.
  const prefix = `${path.basename(dbPath)}.`;
  const existing = fs.readdirSync(snapDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.bak'))
    .sort()
    .reverse();
  for (const old of existing.slice(5)) {
    try { fs.unlinkSync(path.join(snapDir, old)); } catch { /* ignore cleanup error */ }
  }
  return path.relative(rootDir, snapPath);
}

async function push() {
  const dialect = dialectFor(provider);

  // Google Sheets is a grid of cells, not tables: there is no DDL to send and
  // nothing to create. Say that instead of failing inside the driver.
  if (!dialect.supportsDdl) {
    console.error(
      `❌ db:push has nothing to create for ${PROVIDER_LABELS[provider]}: a sheet is a\n` +
        '   range of cells, not a table, so there is no DDL to send.\n' +
        '   Write rows through the adapter instead — the header row appears on the\n' +
        '   first insert.',
    );
    process.exit(1);
  }

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
      console.error(`No schema found in ${schemaDir} or schema.an5`);
      process.exit(1);
    }
  }

  const { models, views, issues } = parsePushSchema(schemaText, provider);
  if (issues.length > 0) throw new FieldTypeError(provider, issues);

  console.log(`${dryRun ? '🔍 Previewing schema changes (dry-run)' : '🚀 Pushing schema to database'} (${PROVIDER_LABELS[provider]})...`);

  const connStr = resolveConnectionString(config, process.env, 'db:push');
  const snapshotRel = snapshotSqliteIfNeeded(connStr);
  if (snapshotRel) {
    console.log(`💾 Saved SQLite snapshot: ${snapshotRel}`);
  }

  let dryRunCount = 0;
  const result = await applySchema(models, dialect, {
    query: async (sql) => (await getDb()).$queryRawUnsafe(sql),
    execute: async (sql) => {
      if (dryRun) {
        dryRunCount++;
        console.log(`[dry-run] ${sql}`);
        return;
      }
      await (await getDb()).$executeRawUnsafe(sql);
    },
    log: (message) => console.log(message),
  }, views);

  if (dryRun) {
    console.log(`✅ Dry-run preview complete (${dryRunCount} statement(s) would be applied).`);
    process.exit(0);
  }

  if (result.tablesCreated > 0) console.log(`   ${result.tablesCreated} table(s) created.`);
  if (result.columnsAdded > 0) console.log(`   ${result.columnsAdded} column(s) added.`);
  if (result.uniqueConstraintsAdded > 0) console.log(`   ${result.uniqueConstraintsAdded} unique(s) added.`);
  if (result.indexesCreated > 0) console.log(`   ${result.indexesCreated} index(es) created.`);
  if (result.viewsApplied > 0) console.log(`   ${result.viewsApplied} view(s) created or replaced.`);

  console.log("✅ Database push completed.");
  process.exit(0);
}

push().catch((err) => {
  // A field type error carries one line per offending field; the message alone
  // would name the provider without saying which fields to fix.
  if (err instanceof FieldTypeError) {
    console.error(`❌ ${err.message}:`);
    console.error(formatIssues(err.issues));
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Push failed: ${msg}`);
    if (/connectionString|DATABASE_URL|connection/i.test(msg)) {
      console.error('💡 Tip: Run "npx @an5/orm init" for a zero-config SQLite sandbox, or set DATABASE_URL in .env.');
    }
  }
  process.exit(1);
});

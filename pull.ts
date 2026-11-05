import "dotenv/config";
import fs from "fs";
import path from "path";
import { An5Adapter } from "@an5/adapters";
import { loadConfig, providerFromConfig, resolveConnectionString } from "./generator/src/config";
import { Provider } from "./generator/src/field-types";
import { blockNameForObject, blockRange, buildViewBlock, qualifiedBlockKey, sqlServerTypeForColumn } from "./generator/src/pull-schema";
import { sqlServerOnlyError } from "./provider-support";

const rootDir = process.cwd();
const { config, outputs } = loadConfig();
const schemaDir = outputs.schemaDir;

let _adapter: An5Adapter | null = null;
async function getDb(): Promise<An5Adapter> {
  if (!_adapter) {
    _adapter = new An5Adapter({ connectionString: resolveConnectionString(config, process.env, "db:pull") });
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
 * The block name `db:pull` used before it split snake_case and protected singular
 * words (`Order_item`, `User_statu`). Kept only to match a schema that already
 * contains those blocks.
 */
function legacyBlockName(objectName: string): string {
  return objectName.charAt(0).toUpperCase() + objectName.slice(1).replace(/s$/, "");
}

async function pull() {
  // Reads sys.tables/sys.columns and writes MSSQL-shaped type names, so another
  // provider would fail on the first catalog query with a driver error that says
  // nothing about the connection string being wrong.
  refuseIfNotSqlServer(providerFromConfig(config, process.env), "db:pull");

  console.log("🔍 Pulling schema from database...");

  const db = await getDb();

  // Safely detect if the SQL Server catalog supports native VECTOR metadata columns
  let hasVectorCatalog = false;
  try {
    const vecCheck = await db.$queryRawUnsafe<any>(
      `SELECT COL_LENGTH('sys.columns', 'vector_dimensions') AS hasVec`
    );
    hasVectorCatalog = !!(vecCheck?.[0]?.hasVec);
  } catch {
    hasVectorCatalog = false;
  }
  const vectorColumnSelect = hasVectorCatalog
    ? ",\n          c.vector_dimensions AS vectorDimensions,\n          c.vector_base_type_desc AS vectorBaseType"
    : "";

  const tables = await db.$queryRawUnsafe<any>(`
    SELECT s.name AS schemaName, t.name AS tableName
    FROM sys.tables t
    JOIN sys.schemas s ON t.schema_id = s.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY t.name
  `);

  // Load existing schema files
  const fileContents: Record<string, string> = {};
  const modelToFileMap: Record<string, string> = {}; // modelName -> fileName
  const tableToFileMap: Record<string, string> = {}; // tableName -> fileName
  const viewToFileMap: Record<string, string> = {}; // view name (bare and qualified) -> fileName
  const existingViewNames: Record<string, string> = {}; // view key -> block name

  if (fs.existsSync(schemaDir)) {
    const files = fs.readdirSync(schemaDir).filter(f => f.endsWith(".an5"));
    for (const file of files) {
      const fullPath = path.join(schemaDir, file);
      const text = fs.readFileSync(fullPath, "utf8");
      fileContents[file] = text;

      // Extract model definitions and table mappings from existing file contents
      const modelRegex = /model\s+(\w+)\s*\{([^}]*)\}/g;
      let match;
      while ((match = modelRegex.exec(text)) !== null) {
        const modelName = match[1];
        const block = match[2];
        modelToFileMap[modelName] = file;

        // Try to find @@map
        const mapMatch = block.match(/@@map\("(.+)"\)/);
        if (mapMatch) {
          const tableName = mapMatch[1];
          tableToFileMap[tableName] = file;
        } else {
          // Default pluralization mapping
          const defaultTableName = modelName.toLowerCase() + "s";
          tableToFileMap[defaultTableName] = file;
        }
      }

      // Views are tracked separately: a model and a view may share a name, and a
      // view without @@map is identified by its block name.
      const viewHeaderRegex = /view\s+(\w+)\s*\{/g;
      while ((match = viewHeaderRegex.exec(text)) !== null) {
        const blockName = match[1];
        const range = blockRange(text, "view", blockName);
        const block = range ? text.slice(range.start, range.end) : "";
        const mapMatch = block.match(/@@map\("(.+)"\)/);
        const objectName = mapMatch ? mapMatch[1] : blockName.toLowerCase() + "s";
        const schemaMatch = block.match(/@@schema\("(.*)"\)/);

        for (const key of new Set([
          blockName,
          objectName,
          qualifiedBlockKey(blockName, schemaMatch?.[1]),
          qualifiedBlockKey(objectName, schemaMatch?.[1]),
        ])) {
          viewToFileMap[key] = file;
          existingViewNames[key] = blockName;
        }
      }
    }
  } else {
    fs.mkdirSync(schemaDir, { recursive: true });
  }

  // Ensure default core.an5 exists in fileContents
  const defaultFile = "core.an5";
  if (!fileContents[defaultFile]) {
    fileContents[defaultFile] = "";
  }

  const existingModelNames = new Set(Object.keys(modelToFileMap));
  const generatedModels: Record<string, string> = {};

  for (const table of tables) {
    const { tableName, schemaName } = table;
    console.log(`Introspecting table [${tableName}]...`);

    // Get columns
    const columns = await db.$queryRawUnsafe<any>(`
      SELECT
          c.name AS columnName,
          ty.name AS dataType,
          c.max_length AS maxLength,
          c.precision AS precision,
          c.scale AS scale,
          c.is_nullable AS isNullable,
          c.is_identity AS isIdentity,
          pk.is_primary_key AS isPrimaryKey,
          d.definition AS defaultValue${vectorColumnSelect}
      FROM sys.columns c
      JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      LEFT JOIN (
          SELECT ic.object_id, ic.column_id, i.is_primary_key
          FROM sys.index_columns ic
          JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          WHERE i.is_primary_key = 1
      ) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
      LEFT JOIN sys.default_constraints d ON c.default_object_id = d.object_id
      WHERE c.object_id = OBJECT_ID(@p_0)
      ORDER BY c.column_id
    `, tableName);

    // Get indexes
    const indexes = await (await getDb()).$queryRawUnsafe<any>(`
      SELECT
          i.name AS indexName,
          i.is_unique AS isUnique,
          i.is_primary_key AS isPrimaryKey,
          c.name AS columnName,
          ic.key_ordinal AS keyOrdinal
      FROM sys.indexes i
      JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = OBJECT_ID(@p_0) AND i.is_hypothetical = 0 AND i.name IS NOT NULL
      ORDER BY i.name, ic.key_ordinal
    `, tableName);

    const indexGroups: Record<string, { isUnique: boolean; isPrimaryKey: boolean; columns: string[] }> = {};
    for (const idx of indexes) {
      if (!indexGroups[idx.indexName]) {
        indexGroups[idx.indexName] = {
          isUnique: idx.isUnique === 1 || idx.isUnique === true,
          isPrimaryKey: idx.isPrimaryKey === 1 || idx.isPrimaryKey === true,
          columns: []
        };
      }
      indexGroups[idx.indexName].columns.push(idx.columnName);
    }

    const uniqueColumns = new Set<string>();
    const compoundUniques: string[][] = [];
    const modelIndexes: string[][] = [];

    for (const [name, info] of Object.entries(indexGroups)) {
      if (info.isPrimaryKey) continue;
      
      if (info.isUnique) {
        if (info.columns.length === 1) {
          uniqueColumns.add(info.columns[0]);
        } else {
          compoundUniques.push(info.columns);
        }
      } else {
        modelIndexes.push(info.columns);
      }
    }

    let modelName = "";
    for (const [mName, file] of Object.entries(modelToFileMap)) {
      const text = fileContents[file];
      const modelRegex = new RegExp(`model\\s+(${mName})\\s*\\{[^}]*\\}`, 'g');
      let m;
      while ((m = modelRegex.exec(text)) !== null) {
        const block = m[0];
        const mapMatch = block.match(/@@map\("(.+)"\)/);
        if (mapMatch && mapMatch[1] === tableName) {
          modelName = mName;
          break;
        }
      }
      if (modelName) break;
    }

    if (!modelName) {
      // A schema pulled before `blockNameForObject` learned to split snake_case
      // has a block named `Order_item`; keep matching it rather than adding a
      // second block for the same table.
      const legacy = legacyBlockName(tableName);
      modelName = modelToFileMap[legacy] ? legacy : blockNameForObject(tableName);
    }

    // Parse existing model fields from file for merging
    const existingFields: Record<string, { line: string; isRelation: boolean; name: string }> = {};
    const targetFile = modelToFileMap[modelName] || defaultFile;
    const fileContent = fileContents[targetFile];

    if (fileContent) {
      const modelRegex = new RegExp(`model\\s+${modelName}\\s*\\{([^}]*)\\}`, 'g');
      const match = modelRegex.exec(fileContent);
      if (match) {
        const block = match[1];
        const lines = block.split("\n");
        for (let line of lines) {
          line = line.trim();
          if (!line || line.startsWith("@@") || line.startsWith("model ") || line === "}") continue;
          
          const parts = line.split(/\s+/);
          const name = parts[0];
          const type = parts[1];
          if (!name || !type) continue;
          
          const cleanType = type.replace("[]", "").replace("?", "");
          const isRelation = existingModelNames.has(cleanType) || type.endsWith("[]");
          
          existingFields[name.toLowerCase()] = {
            line,
            isRelation,
            name
          };
        }
      }
    }

    let modelStr = `model ${modelName} {\n`;

    for (const col of columns) {
      const { columnName, dataType, isNullable, isPrimaryKey, isIdentity, defaultValue } = col;

      const sqlType = sqlServerTypeForColumn(col);
      const dt = dataType.toLowerCase();

      const optional = isNullable ? "?" : "";
      let attributes = "";
      if (isPrimaryKey) attributes += " @id";
      if (isIdentity) attributes += " @default(autoincrement())";
      if (uniqueColumns.has(columnName) && !isPrimaryKey) attributes += " @unique";

      if (defaultValue) {
        if (defaultValue.includes("newid()")) {
          attributes += " @default(uuid())";
        } else if (defaultValue.includes("getdate()") || defaultValue.includes("sysdatetime()")) {
          attributes += " @default(now())";
        } else {
          const cleaned = defaultValue.replace(/^\(+(.*?)\)+$/, '$1');
          if (dt === "bit") {
            if (cleaned === "1" || cleaned.toLowerCase() === "true") attributes += " @default(true)";
            else if (cleaned === "0" || cleaned.toLowerCase() === "false") attributes += " @default(false)";
          } else if (dt === "int" || dt === "float" || dt === "bigint" || dt === "decimal" || dt === "numeric") {
            if (!isNaN(Number(cleaned))) attributes += ` @default(${cleaned})`;
          } else if (dt === "nvarchar" || dt === "varchar") {
            if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
              const val = cleaned.slice(1, -1).replace(/"/g, '\\"');
              attributes += ` @default("${val}")`;
            }
          }
        }
      }

      let fieldLine = `${columnName} ${sqlType}${optional}${attributes}`;

      // Merge decorators/attributes from existing schema
      const existing = existingFields[columnName.toLowerCase()];
      if (existing) {
        const attributesMatch = existing.line.match(/(@default\(.*?\)|@updatedAt)/g);
        if (attributesMatch) {
          for (const attr of attributesMatch) {
            if (!fieldLine.includes(attr)) {
              if (attr.startsWith("@default") && fieldLine.includes("@default")) {
                continue;
              }
              fieldLine += ` ${attr}`;
            }
          }
        }
      }

      modelStr += `  ${fieldLine}\n`;
    }

    // Append preserved relations
    for (const [lowerName, fieldInfo] of Object.entries(existingFields)) {
      if (fieldInfo.isRelation) {
        modelStr += `  ${fieldInfo.line}\n`;
      }
    }

    const uniqueStrings = new Set<string>();
    for (const cols of compoundUniques) {
      uniqueStrings.add(`@@unique([${cols.join(", ")}])`);
    }
    for (const key of uniqueStrings) {
      modelStr += `  ${key}\n`;
    }

    const indexStrings = new Set<string>();
    for (const cols of modelIndexes) {
      indexStrings.add(`@@index([${cols.join(", ")}])`);
    }
    for (const key of indexStrings) {
      modelStr += `  ${key}\n`;
    }

    if (tableName !== modelName.toLowerCase() + "s") {
      modelStr += `\n  @@map("${tableName}")\n`;
    }
    // A table outside `dbo` is only the same object when the schema travels with
    // it; without this, pushing the pulled schema created it in the connection's
    // default schema.
    if (schemaName && schemaName.toLowerCase() !== "dbo") {
      modelStr += `${tableName === modelName.toLowerCase() + "s" ? "\n" : ""}  @@schema("${schemaName}")\n`;
    }
    modelStr += "}";

    generatedModels[modelName] = modelStr;
  }

  // Views are pulled after the tables, for the same reason push creates them
  // after the tables: they may read a table this schema declares.
  const views = await (await getDb()).$queryRawUnsafe<any>(`
    SELECT s.name AS schemaName, v.name AS viewName, OBJECT_DEFINITION(v.object_id) AS definition
    FROM sys.views v
    JOIN sys.schemas s ON v.schema_id = s.schema_id
    WHERE v.is_ms_shipped = 0
    ORDER BY s.name, v.name
  `);

  const generatedViews: Record<string, { block: string; file: string }> = {};

  for (const view of views) {
    const { viewName, schemaName, definition } = view;
    const key = qualifiedBlockKey(viewName, schemaName);
    // The name a previous pull would have chosen, kept so the block is updated
    // in place instead of a duplicate appearing beside it.
    const legacy = legacyBlockName(viewName);
    const modelName = existingViewNames[key] ?? existingViewNames[viewName]
      ?? (existingViewNames[legacy] ? legacy : blockNameForObject(viewName));
    const targetFile = viewToFileMap[modelName] ?? viewToFileMap[key] ?? viewToFileMap[viewName] ?? defaultFile;

    console.log(`Introspecting view [${key}]...`);
    const columns = await db.$queryRawUnsafe<any>(`
      SELECT
          c.name AS columnName,
          ty.name AS dataType,
          c.max_length AS maxLength,
          c.precision AS precision,
          c.scale AS scale,
          c.is_nullable AS isNullable${vectorColumnSelect}
      FROM sys.columns c
      JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      WHERE c.object_id = OBJECT_ID(@p_0)
      ORDER BY c.column_id
    `, key);

    const block = buildViewBlock({ modelName, viewName, schemaName, columns, definition });
    if (block === null) {
      // Without a definition there is nothing to put in `@@sql`, and a view block
      // without one is rejected by push and migrate. Keep the database object and
      // tell the user why it is the only one not in the schema.
      console.warn(`⚠️ Skipped view [${key}]: its definition could not be read (VIEW DEFINITION permission?).`);
      continue;
    }
    generatedViews[modelName] = { block, file: targetFile };
  }

  for (const [modelName, modelStr] of Object.entries(generatedModels)) {
    const targetFile = modelToFileMap[modelName] || defaultFile;
    const fileContent = fileContents[targetFile];

    const modelRegex = new RegExp(`model\\s+${modelName}\\s*\\{[^}]*\\}`, 'g');
    if (modelRegex.test(fileContent)) {
      fileContents[targetFile] = fileContent.replace(modelRegex, modelStr);
      console.log(`✏️ Updated model [${modelName}] in file [${targetFile}]`);
    } else {
      fileContents[targetFile] = fileContent.trim() + "\n\n" + modelStr + "\n";
      console.log(`➕ Added model [${modelName}] to file [${targetFile}]`);
    }
  }

  for (const [viewName, entry] of Object.entries(generatedViews)) {
    const fileContent = fileContents[entry.file];
    const range = blockRange(fileContent, "view", viewName);

    if (range) {
      fileContents[entry.file] = fileContent.slice(0, range.start) + entry.block + fileContent.slice(range.end);
      console.log(`✏️ Updated view [${viewName}] in file [${entry.file}]`);
    } else {
      fileContents[entry.file] = fileContent.trim() + "\n\n" + entry.block + "\n";
      console.log(`➕ Added view [${viewName}] to file [${entry.file}]`);
    }
  }

  for (const [file, content] of Object.entries(fileContents)) {
    const fullPath = path.join(schemaDir, file);
    fs.writeFileSync(fullPath, content.trim() + "\n");
    console.log(`💾 Saved updates to [${fullPath}]`);
  }

  // Index schema into vector store for RAG
  console.log("\n📚 Indexing schema into vector store for RAG...");
  try {
    const { indexSchema, indexQuerySamples } = require(path.join(rootDir, "an5Agent", "dist", "rag", "indexer.js"));
    await indexSchema(schemaDir);
    await indexQuerySamples();
    console.log("✅ Schema indexed for RAG.");
  } catch (err: any) {
    console.warn(`⚠️ RAG indexing skipped: ${err.message || err}`);
    console.warn(`   Run 'npm --prefix an5Agent run rag:index' manually to build vector store.`);
  }

  console.log("✅ Database schema pulling completed successfully.");
  process.exit(0);
}

pull().catch((err) => {
  console.error("❌ Pull failed:", err);
  process.exit(1);
});

import "dotenv/config";
import fs from "fs";
import path from "path";
import { An5Adapter } from "@an5/adapters";

const rootDir = process.cwd();
let config: any = {};
try {
  const configPath = path.join(rootDir, "an5Orm.config.js");
  if (fs.existsSync(configPath)) {
    config = require(configPath);
  }
} catch (err) {
  console.warn("⚠️ Could not load config file in push.ts, using defaults.");
}

const schemaDir = path.resolve(rootDir, config.schemaDir || "an5Schema");

let _adapter: An5Adapter | null = null;
async function getDb(): Promise<An5Adapter> {
  if (!_adapter) {
    _adapter = new An5Adapter({ connectionString: process.env.DATABASE_URL! });
    await _adapter.$connect();
  }
  return _adapter;
}

// Supported SQL Server types (base types without params)
const AN5_TYPES = new Set([
  "NVARCHAR", "VARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT", "XML",
  "INT", "SMALLINT", "TINYINT", "BIGINT", "FLOAT", "REAL", "DECIMAL", "NUMERIC",
  "MONEY", "SMALLMONEY", "BIT",
  "DATETIME", "DATETIME2", "SMALLDATETIME", "DATE", "TIME", "DATETIMEOFFSET",
  "VARBINARY", "BINARY", "IMAGE",
  "UNIQUEIDENTIFIER", "SQL_VARIANT", "ROWVERSION",
  "HIERARCHYID", "GEOGRAPHY", "GEOMETRY", "VECTOR",
]);

// Parse base type from "NVARCHAR(255)" → "NVARCHAR"
function parseSqlType(raw: string): string {
  const match = raw.match(/^(\w+)/);
  return match ? match[1].toUpperCase() : raw.toUpperCase();
}

function parseTableName(raw: string): { schema?: string; name: string } {
  const cleaned = raw.replace(/[\[\]"]/g, "");
  const parts = cleaned.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return { schema: parts[parts.length - 2], name: parts[parts.length - 1] };
  }
  return { name: cleaned };
}

function tableKey(raw: string): string {
  const table = parseTableName(raw);
  return `${table.schema || "dbo"}.${table.name}`.toLowerCase();
}

function tableSqlName(raw: string): string {
  const table = parseTableName(raw);
  return table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`;
}

function tableObjectName(raw: string): string {
  const table = parseTableName(raw);
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function safeIdentifierName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

async function dropTablesNotInSchema(models: any[]) {
  if (!config.push?.dropTables) {
    return;
  }

  const validTableKeys = new Set(models.map(model => tableKey(model.tableName)));
  const dbTables = await (await getDb()).$queryRawUnsafe(`
    SELECT s.name AS schemaName, t.name AS tableName
    FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
  `) as Array<{ schemaName: string; tableName: string }>;

  const tablesToDrop = dbTables.filter(table => !validTableKeys.has(`${table.schemaName}.${table.tableName}`.toLowerCase()));
  if (tablesToDrop.length === 0) {
    console.log("✅ No extra tables to drop.");
    return;
  }

  console.warn(`⚠️ Dropping ${tablesToDrop.length} table(s) not present in schema because push.dropTables=true.`);

  const dropKeys = new Set(tablesToDrop.map(table => `${table.schemaName}.${table.tableName}`.toLowerCase()));
  const foreignKeys = await (await getDb()).$queryRawUnsafe(`
    SELECT
      fk.name AS constraintName,
      ps.name AS parentSchema,
      pt.name AS parentTable,
      rs.name AS referencedSchema,
      rt.name AS referencedTable
    FROM sys.foreign_keys fk
    INNER JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
    INNER JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
    INNER JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
    INNER JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
  `) as Array<{
    constraintName: string;
    parentSchema: string;
    parentTable: string;
    referencedSchema: string;
    referencedTable: string;
  }>;

  for (const fk of foreignKeys) {
    const parentKey = `${fk.parentSchema}.${fk.parentTable}`.toLowerCase();
    const referencedKey = `${fk.referencedSchema}.${fk.referencedTable}`.toLowerCase();
    if (dropKeys.has(parentKey) || dropKeys.has(referencedKey)) {
      console.log(`Dropping foreign key [${fk.constraintName}] on [${fk.parentSchema}].[${fk.parentTable}]...`);
      await (await getDb()).$executeRawUnsafe(
        `ALTER TABLE [${fk.parentSchema}].[${fk.parentTable}] DROP CONSTRAINT [${fk.constraintName}]`
      );
    }
  }

  for (const table of tablesToDrop) {
    console.log(`Dropping table [${table.schemaName}].[${table.tableName}]...`);
    await (await getDb()).$executeRawUnsafe(`DROP TABLE [${table.schemaName}].[${table.tableName}]`);
    console.log(`✅ Dropped [${table.schemaName}].[${table.tableName}]`);
  }
}

async function push() {
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

  const lines = schemaText.split("\n");

  const models: any[] = [];
  let currentModel: any = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("//")) continue;

    const modelHeaderMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelHeaderMatch) {
      currentModel = {
        name: modelHeaderMatch[1],
        tableName: modelHeaderMatch[1].toLowerCase() + "s",
        fields: [],
        compoundUniques: [],
        indexes: [],
      };
      models.push(currentModel);
      continue;
    }

    if (line === "}") {
      currentModel = null;
      continue;
    }

    if (currentModel) {
      if (line.startsWith("@@map")) {
        const mapMatch = line.match(/@@map\("(.+)"\)/);
        if (mapMatch) currentModel.tableName = mapMatch[1];
        continue;
      }
      if (line.startsWith("@@unique")) {
        const uniqueMatch = line.match(/@@unique\(\[([\w,\s]+)\]\)/);
        if (uniqueMatch) {
          const fields = uniqueMatch[1].split(",").map(f => f.trim());
          currentModel.compoundUniques.push(fields);
        }
        continue;
      }
      if (line.startsWith("@@index")) {
        const indexMatch = line.match(/@@index\(\[([\w,\s]+)\]\)/);
        if (indexMatch) {
          const fields = indexMatch[1].split(",").map(f => f.trim());
          currentModel.indexes.push(fields);
        }
        continue;
      }
      if (line.startsWith("@@")) continue;

      const parts = line.split(/\s+/);
      const fieldName = parts[0];
      const fieldType = parts[1];

      if (!fieldName || !fieldType) continue;

      // Parse SQL Server type directly
      const cleanType = fieldType.replace("[]", "").replace("?", "");
      const sqlBase = parseSqlType(cleanType);

      // Skip if not a known SQL Server type (might be a relation)
      if (!AN5_TYPES.has(sqlBase)) {
        continue;
      }

      const isOptional = fieldType.endsWith("?");
      const isId = line.includes("@id");
      const isUnique = line.includes("@unique");

      // Use SQL Server type directly - no mapping needed
      const sqlType = cleanType.toUpperCase();

      let defaultValue = "";
      const defaultMatch = line.match(/@default\((.*)\)/);
      if (defaultMatch) {
        const val = defaultMatch[1];
        if (val === "uuid()") defaultValue = "DEFAULT NEWID()";
        else if (val === "cuid()") defaultValue = "DEFAULT NEWID()";
        else if (val === "now()") defaultValue = "DEFAULT CURRENT_TIMESTAMP";
        else if (val === "autoincrement()") defaultValue = "IDENTITY(1,1)";
        else if (val === "true") defaultValue = "DEFAULT 1";
        else if (val === "false") defaultValue = "DEFAULT 0";
        else if (/^".*"$/.test(val)) defaultValue = `DEFAULT '${val.slice(1, -1)}'`;
        else defaultValue = `DEFAULT ${val}`;
      } else if (line.includes("@updatedAt")) {
        defaultValue = "DEFAULT CURRENT_TIMESTAMP";
      }

      currentModel.fields.push({
        name: fieldName,
        sqlType,
        isOptional,
        isId,
        isUnique,
        defaultValue,
      });
    }
  }

  console.log(`🚀 Pushing schema to database...`);

  await dropTablesNotInSchema(models);

  for (const model of models) {
    const sqlTableName = tableSqlName(model.tableName);
    const objectName = tableObjectName(model.tableName);
    console.log(`Processing table ${sqlTableName}...`);

    // Check if table exists
    const tableExists = await (await getDb()).$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sys.tables WHERE object_id = OBJECT_ID('${objectName}')`
    );

    if (tableExists.length === 0) {
      console.log(`Creating table ${sqlTableName}...`);
      const colDefs = model.fields.map((f: any) => {
        let def = `[${f.name}] ${f.sqlType}`;
        if (f.isId) def += " PRIMARY KEY";
        if (f.defaultValue) def += ` ${f.defaultValue}`;
        if (!f.isOptional && !f.defaultValue && !f.isId) def += " NOT NULL";
        if (f.isUnique && !f.isId) def += " UNIQUE";
        return def;
      });

      // Add compound uniques as table constraints
      if (model.compoundUniques && model.compoundUniques.length > 0) {
        model.compoundUniques.forEach((fields: string[], idx: number) => {
          const constraintName = `UQ_${safeIdentifierName(model.tableName)}_compound_${idx}`;
          const fieldsStr = fields.map(f => `[${f}]`).join(", ");
          colDefs.push(`CONSTRAINT [${constraintName}] UNIQUE (${fieldsStr})`);
        });
      }

      const createSql = `CREATE TABLE ${sqlTableName} (\n  ${colDefs.join(",\n  ")}\n)`;
      await (await getDb()).$executeRawUnsafe(createSql);
      console.log(`✅ Table ${sqlTableName} created.`);

      // Create indexes
      if (model.indexes && model.indexes.length > 0) {
        for (let idx = 0; idx < model.indexes.length; idx++) {
          const fields = model.indexes[idx];
          const indexName = `IX_${safeIdentifierName(model.tableName)}_${fields.join("_")}`;
          const fieldsStr = fields.map((f: string) => `[${f}]`).join(", ");
          console.log(`Creating index [${indexName}] on table ${sqlTableName}...`);
          await (await getDb()).$executeRawUnsafe(`CREATE INDEX [${indexName}] ON ${sqlTableName} (${fieldsStr})`);
        }
      }
    } else {
      // 1. Check for missing columns
      for (const field of model.fields) {
        const colExists = await (await getDb()).$queryRawUnsafe<{ name: string }[]>(
          `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${objectName}') AND name = '${field.name}'`
        );

        if (colExists.length === 0) {
          console.log(`Adding column [${field.name}] to table ${sqlTableName}...`);
          let alterSql = `ALTER TABLE ${sqlTableName} ADD [${field.name}] ${field.sqlType}`;
          if (field.defaultValue) alterSql += ` ${field.defaultValue}`;
          if (field.isUnique && !field.isId) alterSql += " UNIQUE";
          if (!field.isOptional && !field.defaultValue) {
             if (!field.defaultValue) alterSql += " NULL";
             else alterSql += " NOT NULL";
          }
          await (await getDb()).$executeRawUnsafe(alterSql);
        }
      }

      // 2. Check for missing compound uniques
      if (model.compoundUniques && model.compoundUniques.length > 0) {
        for (let idx = 0; idx < model.compoundUniques.length; idx++) {
          const fields = model.compoundUniques[idx];
          const constraintName = `UQ_${safeIdentifierName(model.tableName)}_compound_${idx}`;

          const constraintExists = await (await getDb()).$queryRawUnsafe<any[]>(
            `SELECT name FROM sys.objects WHERE type = 'UQ' AND parent_object_id = OBJECT_ID('${objectName}') AND name = '${constraintName}'`
          );

          if (constraintExists.length === 0) {
            console.log(`Adding compound unique constraint [${constraintName}] to table ${sqlTableName}...`);
            const fieldsStr = fields.map((f: string) => `[${f}]`).join(", ");
            await (await getDb()).$executeRawUnsafe(
              `ALTER TABLE ${sqlTableName} ADD CONSTRAINT [${constraintName}] UNIQUE (${fieldsStr})`
            );
          }
        }
      }

      // 3. Check for missing indexes
      if (model.indexes && model.indexes.length > 0) {
        for (let idx = 0; idx < model.indexes.length; idx++) {
          const fields = model.indexes[idx];
          const indexName = `IX_${safeIdentifierName(model.tableName)}_${fields.join("_")}`;

          const indexExists = await (await getDb()).$queryRawUnsafe<any[]>(
            `SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('${objectName}') AND name = '${indexName}'`
          );

          if (indexExists.length === 0) {
            console.log(`Creating index [${indexName}] on table ${sqlTableName}...`);
            const fieldsStr = fields.map((f: string) => `[${f}]`).join(", ");
            await (await getDb()).$executeRawUnsafe(
              `CREATE INDEX [${indexName}] ON ${sqlTableName} (${fieldsStr})`
            );
          }
        }
      }
    }
  }

  console.log("✅ Database push completed.");
  process.exit(0);
}

push().catch((err) => {
  console.error("❌ Push failed:", err);
  process.exit(1);
});

import { An5Adapter } from "@an5/adapters";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { An5ClientKnownRequestError } from "./errors";
import { DEFAULT_METADATA, An5Metadata } from "./metadata";
import {
  quoteIdentifier,
  sanitizeParamName,
  normalizeSortDirection,
  toNonNegativeInt,
  buildOrderBy,
  parseWhere as buildWhere,
} from "./sql-utils";

type ExecutorFn = (queryText: string, params?: Record<string, any>) => Promise<any[]>;

function aggSelect(fn: string, key: string): string {
  return `${fn}(${quoteIdentifier(key)}) as ${aggAlias(fn, key)}`;
}

function aggAlias(fn: string, key: string): string {
  return sanitizeParamName(`${fn}_${key}`);
}

let adapter: An5Adapter | null = null;

async function getAdapter(): Promise<An5Adapter> {
  if (!adapter) {
    adapter = new An5Adapter({ connectionString: process.env.DATABASE_URL! });
    await adapter.$connect();
  }
  return adapter;
}

async function execQuery(queryText: string, params?: Record<string, any>): Promise<any[]> {
  const a = await getAdapter();
  return a.exec(queryText, params);
}

function projectFields(row: any, select: any) {
  if (!row || !select) return row;
  const projected: any = {};
  for (const [key, val] of Object.entries(select)) {
    if (val) {
      projected[key] = row[key];
    }
  }
  if (row._count) {
    projected._count = row._count;
  }
  return projected;
}

// Helper to batch-query and resolve relationships
async function resolveIncludes(modelName: string, rows: any[], include: any, executor: ExecutorFn, metadata: An5Metadata) {
  if (!rows || rows.length === 0 || !include) return;

  const modelRelations = metadata.relationMap[modelName];
  if (!modelRelations) return;

  for (const [key, value] of Object.entries(include)) {
    if (!value) continue;

    const relation = modelRelations[key];
    if (!relation) {
      if (key === "_count" && value && typeof value === "object") {
        const countFields = Object.keys((value as any).select || {});
        for (const countField of countFields) {
          const rel = modelRelations[countField];
          if (rel) {
            const relTable = metadata.modelToTable[rel.modelName];
            const localKeys = rows.map(r => r[rel.localKey]).filter(Boolean);
            if (localKeys.length === 0) {
              rows.forEach(r => { r._count = { ...r._count, [countField]: 0 }; });
              continue;
            }

            const sqlText = `
              SELECT ${quoteIdentifier(rel.foreignKey)} as parentId, COUNT(*) as count 
              FROM ${relTable} WITH (NOLOCK)
              WHERE ${quoteIdentifier(rel.foreignKey)} IN (${localKeys.map((_, i) => `@lk_${i}`).join(", ")})
              GROUP BY ${quoteIdentifier(rel.foreignKey)}
            `;
            const countParams: Record<string, any> = {};
            localKeys.forEach((lk, i) => { countParams[`lk_${i}`] = lk; });

            const counts = await executor(sqlText, countParams);
            const countMap = new Map(counts.map((c: any) => [c.parentId, c.count]));

            rows.forEach(r => {
              if (!r._count) r._count = {};
              r._count[countField] = countMap.get(r[rel.localKey]) || 0;
            });
          }
        }
      }
      continue;
    }

    const relTable = metadata.modelToTable[relation.modelName];
    const isMany = relation.relationType === "many";
    const matchKey = relation.relationType === "one" ? relation.foreignKey : relation.localKey;
    const searchKey = relation.relationType === "one" ? relation.localKey : relation.foreignKey;

    const keys = rows.map(r => r[matchKey]).filter(Boolean);
    if (keys.length === 0) {
      rows.forEach(r => { r[key] = isMany ? [] : null; });
      continue;
    }

    const uniqueKeys = Array.from(new Set(keys));
    let relCols = "*";
    if (value && typeof value === "object" && (value as any).select) {
      const subSelect = (value as any).select;
      const subRelations = metadata.relationMap[relation.modelName] || {};
      const selectedSubCols = Object.keys(subSelect)
        .filter(k => subSelect[k] && !subRelations[k])
        .map(k => quoteIdentifier(k));
      if (selectedSubCols.length > 0) {
        const quotedSearchKey = quoteIdentifier(searchKey);
        if (!selectedSubCols.includes(quotedSearchKey)) {
          selectedSubCols.push(quotedSearchKey);
        }
        relCols = selectedSubCols.join(", ");
      }
    }

    let sqlText = `SELECT ${relCols} FROM ${relTable} WITH (NOLOCK) WHERE ${quoteIdentifier(searchKey)} IN (${uniqueKeys.map((_, i) => `@k_${i}`).join(", ")})`;
    const subParams: Record<string, any> = {};
    uniqueKeys.forEach((k, i) => { subParams[`k_${i}`] = k; });

    if (value && typeof value === "object") {
      const subArgs = value as any;
      if (subArgs.orderBy) {
        sqlText += buildOrderBy(subArgs.orderBy);
      }
    }

    const relatedRows = await executor(sqlText, subParams);

    if (value && typeof value === "object" && (value as any).select) {
      relatedRows.forEach((r, idx) => {
        relatedRows[idx] = projectFields(r, (value as any).select);
      });
    }

    if (value && typeof value === "object" && (value as any).include) {
      await resolveIncludes(relation.modelName, relatedRows, (value as any).include, executor, metadata);
    }

    const groupMap = new Map<any, any[]>();
    relatedRows.forEach((r: any) => {
      const k = r[searchKey];
      if (!groupMap.has(k)) groupMap.set(k, []);
      groupMap.get(k)!.push(r);
    });

    rows.forEach(r => {
      const k = r[matchKey];
      const matches = groupMap.get(k) || [];
      if (isMany) {
        r[key] = matches;
      } else {
        r[key] = matches[0] || null;
      }
    });
  }
}

// Table query executor client class
class TableClient<T = any> {
  constructor(
    private modelName: string,
    private tableName: string,
    private executor: ExecutorFn,
    private orm: An5ORM
  ) { }

  async findMany(args?: any): Promise<T[]> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'findMany', args }, async (params) => {
      const { args: finalArgs } = params;
      const hasSkip = finalArgs?.skip !== undefined && finalArgs?.skip !== null;

      let cols = "*";
      if (finalArgs?.select) {
        const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
        const selectedCols = Object.keys(finalArgs.select)
          .filter(k => finalArgs.select[k] && !modelRelations[k])
          .map(k => quoteIdentifier(k));
        if (selectedCols.length > 0) {
          cols = selectedCols.join(", ");
        }
      }

      let sqlText = "SELECT";
      if (finalArgs?.take && !hasSkip) {
        sqlText += ` TOP (${toNonNegativeInt(finalArgs.take, 1)})`;
      }
      sqlText += ` ${cols} FROM ${this.tableName} WITH (NOLOCK)`;

      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs?.where, p);
      if (whereSql) {
        sqlText += ` WHERE ${whereSql}`;
      }

      if (finalArgs?.orderBy) {
        sqlText += buildOrderBy(finalArgs.orderBy);
      } else if (hasSkip) {
        // OFFSET requires an ORDER BY clause in SQL Server
        sqlText += " ORDER BY (SELECT NULL)";
      }

      if (hasSkip) {
        sqlText += ` OFFSET ${toNonNegativeInt(finalArgs.skip)} ROWS`;
        if (finalArgs?.take) {
          sqlText += ` FETCH NEXT ${toNonNegativeInt(finalArgs.take, 1)} ROWS ONLY`;
        }
      }

      const rows = await this.executor(sqlText, p);
      if (finalArgs?.select) {
        rows.forEach((r, idx) => {
          rows[idx] = projectFields(r, finalArgs.select);
        });
      }
      if (finalArgs?.include) {
        await resolveIncludes(this.modelName, rows, finalArgs.include, this.executor, this.orm.metadata);
      }
      return rows as T[];
    });
  }

  async findFirst(args?: any): Promise<T | null> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'findFirst', args }, async (params) => {
      const rows = await this.findMany({ ...params.args, take: 1 });
      return rows[0] || null;
    });
  }

  async findUnique(args?: any): Promise<T | null> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'findUnique', args }, async (params) => {
      return this.findFirst(params.args);
    });
  }

  async count(args?: any): Promise<number> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'count', args }, async (params) => {
      const { args: finalArgs } = params;
      let sqlText = `SELECT COUNT(*) as count FROM ${this.tableName} WITH (NOLOCK)`;
      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs?.where, p);
      if (whereSql) {
        sqlText += ` WHERE ${whereSql}`;
      }
      const result = await this.executor(sqlText, p);
      return result[0]?.count || 0;
    });
  }

  private async handleNestedWrites(data: any, parentId: any) {
    const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
    for (const [key, value] of Object.entries(data)) {
      const relation = modelRelations[key];
      if (!relation || !value || typeof value !== "object" || (value instanceof Date)) continue;

      const relTableClient = this.orm[relation.modelName];
      if (!relTableClient) continue;

      const nestedOps = value as any;

      // Handle deleteMany (an5Orm-style)
      if (nestedOps.deleteMany) {
        const deleteWhere = Array.isArray(nestedOps.deleteMany) ? { OR: nestedOps.deleteMany } : nestedOps.deleteMany;
        // Scope deletion to parent
        const scopedWhere = { ...deleteWhere, [relation.foreignKey]: parentId };
        await relTableClient.deleteMany({ where: scopedWhere });
      }

      // Handle create
      if (nestedOps.create) {
        const createItems = Array.isArray(nestedOps.create) ? nestedOps.create : [nestedOps.create];
        for (const item of createItems) {
          // Inject parent ID
          const itemData = { ...item, [relation.foreignKey]: parentId };
          await relTableClient.create({ data: itemData });
        }
      }

      // Handle connect
      if (nestedOps.connect) {
        const connectItems = Array.isArray(nestedOps.connect) ? nestedOps.connect : [nestedOps.connect];
        for (const item of connectItems) {
          if (relation.relationType === "many") {
            await relTableClient.update({
              where: item,
              data: { [relation.foreignKey]: parentId }
            });
          }
        }
      }
    }
  }

  async create(args: any): Promise<T> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'create', args }, async (params) => {
      const { args: finalArgs } = params;
      try {
        const data = { ...finalArgs.data };

        // Extract nested writes
        const nestedData: Record<string, any> = {};
        const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
        for (const key of Object.keys(data)) {
          if (modelRelations[key]) {
            nestedData[key] = data[key];
            delete data[key];
          }
        }

        if (!data.id && this.orm.metadata.modelFields[this.modelName]?.id?.ts === "string") {
          data.id = randomUUID();
        }
        const now = new Date();
        if (!data.createdAt && this.orm.metadata.modelFields[this.modelName]?.createdAt) data.createdAt = now;
        if (!data.updatedAt && this.orm.metadata.modelFields[this.modelName]?.updatedAt) data.updatedAt = now;

        // Handle one-relation connect where we hold the FK
        for (const [key, value] of Object.entries(nestedData)) {
          const rel = modelRelations[key];
          if (rel && rel.relationType === "one" && (value as any).connect) {
            const connectObj = (value as any).connect;
            const targetId = connectObj.id || Object.values(connectObj)[0];
            data[rel.foreignKey] = targetId;
          }
        }

        const keys = Object.keys(data);
        const columns = keys.map(k => quoteIdentifier(k)).join(", ");
        const safeKeys = keys.map(k => sanitizeParamName(k));
        const placeholders = safeKeys.map(k => `@${k}`).join(", ");
        const safeData: Record<string, any> = {};
        keys.forEach((k, i) => { safeData[safeKeys[i]] = data[k]; });

        const sqlText = `INSERT INTO ${this.tableName} (${columns}) OUTPUT inserted.* VALUES (${placeholders})`;
        const rows = await this.executor(sqlText, safeData);
        const createdRow = rows[0];

        if (!createdRow) {
          throw new Error("Failed to insert record and retrieve output");
        }

        const pkField = ("id" in createdRow) ? "id" : Object.keys(createdRow).find(k => k.endsWith("_id"));
        const insertedId = pkField ? createdRow[pkField] : undefined;

        // Process other nested writes
        await this.handleNestedWrites(nestedData, insertedId);

        const created = await this.findUnique({
          where: pkField ? { [pkField]: insertedId } : {},
          include: finalArgs.include
        });
        if (!created) {
          throw new Error(`Failed to retrieve newly created record with ID ${insertedId}`);
        }
        return created;
      } catch (error: any) {
        const msg = String(error?.message || '').toLowerCase();
        const errNumber = error?.number;

        if (
          msg.includes('duplicate') ||
          msg.includes('unique') ||
          errNumber === 2627 ||
          errNumber === 2601
        ) {
          throw new An5ClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "mock",
          });
        }

        if (msg.includes('foreign key') || errNumber === 547) {
          throw new An5ClientKnownRequestError("Foreign key constraint failed", {
            code: "P2003",
            clientVersion: "mock",
          });
        }

        if (msg.includes('not found') || errNumber === 404) {
          throw new An5ClientKnownRequestError("Record not found", {
            code: "P2025",
            clientVersion: "mock",
          });
        }

        throw error;
      }
    });
  }

  async update(args: any): Promise<T> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'update', args }, async (params) => {
      const { args: finalArgs } = params;
      const data = { ...finalArgs.data };
      if (this.orm.metadata.modelFields[this.modelName]?.updatedAt) {
        data.updatedAt = new Date();
      }

      // Extract nested writes
      const nestedData: Record<string, any> = {};
      const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
      for (const key of Object.keys(data)) {
        if (modelRelations[key]) {
          nestedData[key] = data[key];
          delete data[key];
        }
      }

      delete data.id;

      // Handle one-relation connect where we hold the FK
      for (const [key, value] of Object.entries(nestedData)) {
        const rel = modelRelations[key];
        if (rel && rel.relationType === "one" && (value as any).connect) {
          const connectObj = (value as any).connect;
          const targetId = connectObj.id || Object.values(connectObj)[0];
          data[rel.foreignKey] = targetId;
        }
      }

      const sets: string[] = [];
      const p: Record<string, any> = {};

      for (const key of Object.keys(data)) {
        const val = data[key];
        const col = quoteIdentifier(key);
        const safeKey = sanitizeParamName(key);
        if (val && typeof val === "object" && !(val instanceof Date)) {
          if (val.increment !== undefined) {
            sets.push(`${col} = ${col} + @${safeKey}_inc`);
            p[`${safeKey}_inc`] = val.increment;
            continue;
          } else if (val.decrement !== undefined) {
            sets.push(`${col} = ${col} - @${safeKey}_dec`);
            p[`${safeKey}_dec`] = val.decrement;
            continue;
          } else if (val.set !== undefined) {
            sets.push(`${col} = @${safeKey}_set`);
            p[`${safeKey}_set`] = val.set;
            continue;
          }
        }

        sets.push(`${col} = @${safeKey}`);
        p[safeKey] = val;
      }

      const whereParams: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, whereParams, "w_");
      Object.assign(p, whereParams);

      const sqlText = `UPDATE ${this.tableName} SET ${sets.join(", ")} WHERE ${whereSql}`;
      await this.executor(sqlText, p);

      // Get parent ID for nested writes
      const existing = await this.findUnique({ where: finalArgs.where });
      if (!existing) throw new Error("Record not found to update");
      const parentId = (existing as any).id;

      // Process nested writes
      await this.handleNestedWrites(nestedData, parentId);

      const updated = await this.findUnique({ where: finalArgs.where, include: finalArgs.include });
      if (!updated) {
        throw new Error(`Failed to retrieve updated record`);
      }
      return updated;
    });
  }

  async updateMany(args: any): Promise<{ count: number }> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'updateMany', args }, async (params) => {
      const { args: finalArgs } = params;
      const data = { ...finalArgs.data };
      if (this.orm.metadata.modelFields[this.modelName]?.updatedAt) {
        data.updatedAt = new Date();
      }
      delete data.id;

      const sets: string[] = [];
      const p: Record<string, any> = {};

      for (const key of Object.keys(data)) {
        const val = data[key];
        if (this.orm.metadata.relationMap[this.modelName]?.[key]) continue;
        const col = quoteIdentifier(key);
        const safeKey = sanitizeParamName(key);

        if (val && typeof val === "object" && !(val instanceof Date)) {
          if (val.increment !== undefined) {
            sets.push(`${col} = ${col} + @${safeKey}_inc`);
            p[`${safeKey}_inc`] = val.increment;
            continue;
          } else if (val.decrement !== undefined) {
            sets.push(`${col} = ${col} - @${safeKey}_dec`);
            p[`${safeKey}_dec`] = val.decrement;
            continue;
          } else if (val.set !== undefined) {
            sets.push(`${col} = @${safeKey}_set`);
            p[`${safeKey}_set`] = val.set;
            continue;
          }
        }

        sets.push(`${col} = @${safeKey}`);
        p[safeKey] = val;
      }

      const whereParams: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, whereParams, "w_");
      Object.assign(p, whereParams);

      const sqlText = `UPDATE ${this.tableName} SET ${sets.join(", ")} ${whereSql ? `WHERE ${whereSql}` : ""}`;
      const count = await (await getAdapter())._executeRaw(sqlText, p);
      return { count };
    });
  }

  async delete(args: any): Promise<T> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'delete', args }, async (params) => {
      const { args: finalArgs } = params;
      const existing = await this.findUnique({ where: finalArgs.where });
      if (!existing) throw new Error("Record not found to delete");

      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, p);
      const sqlText = `DELETE FROM ${this.tableName} WHERE ${whereSql}`;
      await this.executor(sqlText, p);

      return existing;
    });
  }

  async deleteMany(args?: any): Promise<{ count: number }> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'deleteMany', args }, async (params) => {
      const { args: finalArgs } = params;
      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs?.where, p);
      const sqlText = `DELETE FROM ${this.tableName} ${whereSql ? `WHERE ${whereSql}` : ""}`;

      const count = await (await getAdapter())._executeRaw(sqlText, p);
      return { count };
    });
  }

  async vectorSearch(args: {
    vector: number[];
    take?: number;
    where?: any;
    include?: any;
    vectorField?: string;
    distanceMetric?: 'cosine' | 'euclidean' | 'dot';
    vectorElementType?: 'float32' | 'float16' | 'uint8';
  }): Promise<(T & { distance: number })[]> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'vectorSearch', args }, async (params) => {
      const { args: finalArgs } = params;
      const field = finalArgs.vectorField || "embedding";
      const METRICS = ["cosine", "euclidean", "dot"];
      const ELEMENT_TYPES = ["float32", "float16", "uint8"];
      const metric = METRICS.includes(finalArgs.distanceMetric) ? finalArgs.distanceMetric : "cosine";
      const elementType = ELEMENT_TYPES.includes(finalArgs.vectorElementType) ? finalArgs.vectorElementType : "float32";
      const take = toNonNegativeInt(finalArgs.take, 10);
      const dim = Number(finalArgs.vector?.length) || 0;
      const vectorJson = JSON.stringify(finalArgs.vector);
      const col = quoteIdentifier(field);

      try {
        if (dim > 1998) {
          throw new Error("Vector dimension exceeds SQL Server limit of 1998");
        }
        let sqlText = `SELECT TOP (${take}) *, `;
        sqlText += `VECTOR_DISTANCE('${metric}', CAST(${col} AS VECTOR(${dim}, ${elementType})), CAST(@query_vector AS VECTOR(${dim}, ${elementType}))) AS distance `;
        sqlText += `FROM ${this.tableName} WITH (NOLOCK) `;

        const p: Record<string, any> = {
          query_vector: vectorJson
        };

        const whereClauses: string[] = [];
        whereClauses.push(`${col} IS NOT NULL`);

        const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, p, "v_");
        if (whereSql) {
          whereClauses.push(whereSql);
        }

        sqlText += `WHERE ${whereClauses.join(" AND ")} `;
        sqlText += `ORDER BY distance ASC`;

        const rows = await this.executor(sqlText, p);
        if (finalArgs.include) {
          await resolveIncludes(this.modelName, rows, finalArgs.include, this.executor, this.orm.metadata);
        }
        return rows as (T & { distance: number })[];
      } catch (err: any) {
        const msg = String(err.message || "").toLowerCase();
        
        // Handle specific float16 to float32 conversion error by retrying with float16
        if (msg.includes("float16") && msg.includes("float32") && msg.includes("conversion") && !finalArgs.vectorElementType) {
          logger.info(`Detected float16 vector storage. Retrying vectorSearch with float16 element type.`);
          return (this as any).vectorSearch({ ...finalArgs, vectorElementType: 'float16' });
        }

        const isUnsupported = msg.includes("vector_distance") ||
          msg.includes("type vector") ||
          msg.includes("limit of 1998") ||
          err?.number === 195;

        if (!isUnsupported) {
          throw err;
        }

        logger.warn(`Native VECTOR_DISTANCE not supported by SQL Server instance. Falling back to in-memory similarity search.`);

        let fallbackSql = `SELECT * FROM ${this.tableName} WITH (NOLOCK) `;
        const fallbackParams: Record<string, any> = {};
        const fallbackWhereClauses: string[] = [];
        fallbackWhereClauses.push(`${col} IS NOT NULL`);

        const fallbackWhereSql = this.orm.parseWhere(this.modelName, finalArgs.where, fallbackParams, "vf_");
        if (fallbackWhereSql) {
          fallbackWhereClauses.push(fallbackWhereSql);
        }
        fallbackSql += `WHERE ${fallbackWhereClauses.join(" AND ")}`;

        const rows = await this.executor(fallbackSql, fallbackParams);

        const scored = rows.map((row: any) => {
          let distance = 1.0;
          try {
            const rowVector = typeof row[field] === "string"
              ? (JSON.parse(row[field]) as number[])
              : (row[field] as number[]);

            if (Array.isArray(rowVector)) {
              let dotProduct = 0;
              let normA = 0;
              let normB = 0;
              for (let i = 0; i < finalArgs.vector.length; i++) {
                const valA = finalArgs.vector[i] || 0;
                const valB = rowVector[i] || 0;
                dotProduct += valA * valB;
                normA += valA * valA;
                normB += valB * valB;
              }
              const similarity = (normA === 0 || normB === 0) ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
              distance = 1.0 - similarity;
            }
          } catch { /* skip */ }
          return {
            ...row,
            distance
          };
        });

        const results = scored
          .sort((a, b) => a.distance - b.distance)
          .slice(0, take);

        if (finalArgs.include && results.length > 0) {
          await resolveIncludes(this.modelName, results, finalArgs.include, this.executor, this.orm.metadata);
        }

        return results;
      }
    });
  }

  async createMany(args: { data: any[]; skipDuplicates?: boolean }): Promise<{ count: number }> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'createMany', args }, async (params) => {
      const { args: finalArgs } = params;
      if (!finalArgs.data || finalArgs.data.length === 0) return { count: 0 };

      try {
        const fields = this.orm.metadata.modelFields[this.modelName] || {};
        const fieldNames = Object.keys(fields);

        const now = new Date();
        const rows = finalArgs.data.map((item: any) => {
          const rowData: Record<string, any> = { ...item };
          if (!rowData.id && fields.id?.ts === "string") rowData.id = randomUUID();
          if (!rowData.createdAt && fields.createdAt) rowData.createdAt = now;
          if (!rowData.updatedAt && fields.updatedAt) rowData.updatedAt = now;
          return rowData;
        });

        const cols = fieldNames.filter(col => rows.some((r: any) => r[col] !== undefined));
        if (cols.length === 0) throw new Error("No insertable columns");

        const params: Record<string, any> = {};
        const rowPlaceholders: string[] = [];
        rows.forEach((row: any, rowIdx: number) => {
          const vals = cols.map(col => {
            const p = sanitizeParamName(`r${rowIdx}_${col}`);
            params[p] = row[col] ?? null;
            return `@${p}`;
          });
          rowPlaceholders.push(`(${vals.join(", ")})`);
        });

        const sqlText = `INSERT INTO ${this.tableName} (${cols.map(quoteIdentifier).join(", ")}) VALUES ${rowPlaceholders.join(", ")}`;
        await (await getAdapter())._executeRaw(sqlText, params);
        return { count: rows.length };
      } catch (err: any) {
        logger.warn(`Bulk insert failed, falling back to sequential inserts: ${err.message}`);
        let count = 0;
        for (const item of finalArgs.data) {
          try {
            await this.create({ data: item });
            count++;
          } catch (innerErr) {
            if (finalArgs.skipDuplicates) continue;
            throw innerErr;
          }
        }
        return { count };
      }
    });
  }

  async aggregate(args: any): Promise<any> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'aggregate', args }, async (params) => {
      const { args: finalArgs } = params;
      const selects: string[] = [];
      const resultObj: any = {};

      if (finalArgs._sum) {
        resultObj._sum = {};
        for (const key of Object.keys(finalArgs._sum)) {
          selects.push(aggSelect("SUM", key));
        }
      }
      if (finalArgs._avg) {
        resultObj._avg = {};
        for (const key of Object.keys(finalArgs._avg)) {
          selects.push(aggSelect("AVG", key));
        }
      }
      if (finalArgs._min) {
        resultObj._min = {};
        for (const key of Object.keys(finalArgs._min)) {
          selects.push(aggSelect("MIN", key));
        }
      }
      if (finalArgs._max) {
        resultObj._max = {};
        for (const key of Object.keys(finalArgs._max)) {
          selects.push(aggSelect("MAX", key));
        }
      }
      if (finalArgs._count) {
        resultObj._count = {};
        if (finalArgs._count === true || finalArgs._count._all) {
          selects.push(`COUNT(*) as count_all`);
        } else {
          for (const key of Object.keys(finalArgs._count)) {
            selects.push(aggSelect("COUNT", key));
          }
        }
      }

      if (selects.length === 0) {
        throw new Error("Aggregate requires at least one aggregator field");
      }

      let sqlText = `SELECT ${selects.join(", ")} FROM ${this.tableName} WITH (NOLOCK)`;
      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs?.where, p);
      if (whereSql) {
        sqlText += ` WHERE ${whereSql}`;
      }

      const rows = await this.executor(sqlText, p);
      const row = rows[0] || {};

      if (finalArgs._sum) {
        for (const key of Object.keys(finalArgs._sum)) {
          resultObj._sum[key] = row[aggAlias("sum", key)] !== undefined ? row[aggAlias("sum", key)] : null;
        }
      }
      if (finalArgs._avg) {
        for (const key of Object.keys(finalArgs._avg)) {
          resultObj._avg[key] = row[aggAlias("avg", key)] !== undefined ? row[aggAlias("avg", key)] : null;
        }
      }
      if (finalArgs._min) {
        for (const key of Object.keys(finalArgs._min)) {
          resultObj._min[key] = row[aggAlias("min", key)] !== undefined ? row[aggAlias("min", key)] : null;
        }
      }
      if (finalArgs._max) {
        for (const key of Object.keys(finalArgs._max)) {
          resultObj._max[key] = row[aggAlias("max", key)] !== undefined ? row[aggAlias("max", key)] : null;
        }
      }
      if (finalArgs._count) {
        if (finalArgs._count === true || finalArgs._count._all) {
          resultObj._count._all = row[`count_all`] || 0;
        } else {
          for (const key of Object.keys(finalArgs._count)) {
            resultObj._count[key] = row[aggAlias("count", key)] || 0;
          }
        }
      }

      return resultObj;
    });
  }

  async groupBy(args: any): Promise<any[]> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'groupBy', args }, async (params) => {
      const { args: finalArgs } = params;
      const byFields = finalArgs.by || [];
      if (byFields.length === 0) {
        throw new Error("groupBy requires 'by' fields");
      }

      const selects = byFields.map((f: string) => quoteIdentifier(f));

      if (finalArgs._count) {
        if (finalArgs._count === true || finalArgs._count._all) {
          selects.push(`COUNT(*) as count_all`);
        } else {
          for (const key of Object.keys(finalArgs._count)) {
            selects.push(aggSelect("COUNT", key));
          }
        }
      }
      if (finalArgs._sum) {
        for (const key of Object.keys(finalArgs._sum)) {
          selects.push(aggSelect("SUM", key));
        }
      }
      if (finalArgs._avg) {
        for (const key of Object.keys(finalArgs._avg)) {
          selects.push(aggSelect("AVG", key));
        }
      }
      if (finalArgs._min) {
        for (const key of Object.keys(finalArgs._min)) {
          selects.push(aggSelect("MIN", key));
        }
      }
      if (finalArgs._max) {
        for (const key of Object.keys(finalArgs._max)) {
          selects.push(aggSelect("MAX", key));
        }
      }

      let sqlText = `SELECT ${selects.join(", ")} FROM ${this.tableName} WITH (NOLOCK)`;
      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs?.where, p);
      if (whereSql) {
        sqlText += ` WHERE ${whereSql}`;
      }

      sqlText += ` GROUP BY ${byFields.map((f: string) => quoteIdentifier(f)).join(", ")}`;

      const rows = await this.executor(sqlText, p);

      return rows.map((row: any) => {
        const item: any = {};
        byFields.forEach((field: string) => {
          item[field] = row[field];
        });

        if (finalArgs._count) {
          item._count = {};
          if (finalArgs._count === true || finalArgs._count._all) {
            item._count._all = row[`count_all`] || 0;
          } else {
            for (const key of Object.keys(finalArgs._count)) {
              item._count[key] = row[aggAlias("count", key)] || 0;
            }
          }
        }
        if (finalArgs._sum) {
          item._sum = {};
          for (const key of Object.keys(finalArgs._sum)) {
            item._sum[key] = row[aggAlias("sum", key)] !== undefined ? row[aggAlias("sum", key)] : null;
          }
        }
        if (finalArgs._avg) {
          item._avg = {};
          for (const key of Object.keys(finalArgs._avg)) {
            item._avg[key] = row[aggAlias("avg", key)] !== undefined ? row[aggAlias("avg", key)] : null;
          }
        }
        if (finalArgs._min) {
          item._min = {};
          for (const key of Object.keys(finalArgs._min)) {
            item._min[key] = row[aggAlias("min", key)] !== undefined ? row[aggAlias("min", key)] : null;
          }
        }
        if (finalArgs._max) {
          item._max = {};
          for (const key of Object.keys(finalArgs._max)) {
            item._max[key] = row[aggAlias("max", key)] !== undefined ? row[aggAlias("max", key)] : null;
          }
        }

        return item;
      });
    });
  }

  async upsert(args: any): Promise<T> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'upsert', args }, async (params) => {
      const { args: finalArgs } = params;
      const { where, create: createData, update: updateData, include } = finalArgs;

      // Filter out relation fields from data
      const cleanCreate = { ...createData };
      const cleanUpdate = { ...updateData };
      for (const key of Object.keys(cleanCreate)) {
        if (this.orm.metadata.relationMap[this.modelName]?.[key]) delete cleanCreate[key];
      }
      for (const key of Object.keys(cleanUpdate)) {
        if (this.orm.metadata.relationMap[this.modelName]?.[key]) delete cleanUpdate[key];
      }

      if (!cleanCreate.id && this.orm.metadata.modelFields[this.modelName]?.id?.ts === "string") {
        cleanCreate.id = randomUUID();
      }
      const now = new Date();
      if (!cleanCreate.createdAt && this.orm.metadata.modelFields[this.modelName]?.createdAt) cleanCreate.createdAt = now;
      if (!cleanCreate.updatedAt && this.orm.metadata.modelFields[this.modelName]?.updatedAt) cleanCreate.updatedAt = now;
      if (!cleanUpdate.updatedAt && this.orm.metadata.modelFields[this.modelName]?.updatedAt) cleanUpdate.updatedAt = now;

      const p: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, where, p, "upw_");

      const allKeys = Array.from(new Set([...Object.keys(cleanCreate), ...Object.keys(cleanUpdate)]));
      const cParam = (k: string) => `c_${sanitizeParamName(k)}`;
      const uParam = (k: string) => `u_${sanitizeParamName(k)}`;
      for (const k of allKeys) {
        if (cleanCreate[k] !== undefined) p[cParam(k)] = cleanCreate[k];
        if (cleanUpdate[k] !== undefined) p[uParam(k)] = cleanUpdate[k];
      }

      const sourceSelect = allKeys.map(k => {
        const val = cleanCreate[k] !== undefined ? `@${cParam(k)}` : (cleanUpdate[k] !== undefined ? `@${uParam(k)}` : "NULL");
        return `${val} as ${quoteIdentifier(k)}`;
      }).join(", ");

      const updateSets = Object.keys(cleanUpdate).map(k => `target.${quoteIdentifier(k)} = source.${quoteIdentifier(k)}`).join(", ");
      const insertCols = Object.keys(cleanCreate).map(k => quoteIdentifier(k)).join(", ");
      const insertVals = Object.keys(cleanCreate).map(k => `source.${quoteIdentifier(k)}`).join(", ");

      // Note: This MERGE assumes the 'where' translates to a simple ON clause.
      // For complex 'where', parseWhere might return something not easily usable in ON.
      // We'll try to extract simple equality for ON if possible, or fallback to sequential.

      const onClause = Object.keys(where).map(k => {
        if (typeof where[k] === 'object' && where[k] !== null && !(where[k] instanceof Date)) {
          // Flatten unique object if needed
          const inner = where[k];
          return Object.keys(inner).map(ik => `target.${quoteIdentifier(ik)} = @${sanitizeParamName(`upw_${k}_${ik}`)}`).join(" AND ");
        }
        return `target.${quoteIdentifier(k)} = @${sanitizeParamName(`upw_${k}`)}`;
      }).join(" AND ");

      const sqlText = `
        MERGE INTO ${this.tableName} WITH (HOLDLOCK) AS target
        USING (SELECT ${sourceSelect}) AS source
        ON (${onClause})
        WHEN MATCHED THEN
          UPDATE SET ${updateSets}
        WHEN NOT MATCHED THEN
          INSERT (${insertCols}) VALUES (${insertVals})
        OUTPUT inserted.*;
      `;

      try {
        const rows = await this.executor(sqlText, p);
        const result = rows[0];
        if (include && result) {
          await resolveIncludes(this.modelName, [result], include, this.executor, this.orm.metadata);
        }
        return result as T;
      } catch (err: any) {
        logger.warn(`Atomic upsert failed, falling back to sequential: ${err.message}`);
        const existing = await this.findUnique({ where: finalArgs.where });
        if (existing) {
          return this.update({ where: finalArgs.where, data: finalArgs.update, include: finalArgs.include });
        } else {
          return this.create({ data: finalArgs.create, include: finalArgs.include });
        }
      }
    });
  }
}

function addNoLockToQuery(sql: string, metadata: An5Metadata): string {
  // If it's not a SELECT query, don't modify it
  if (!/^\s*SELECT/i.test(sql)) {
    return sql;
  }

  const tableNames = Object.values(metadata.modelToTable);

  let modifiedSql = sql;

  for (const table of tableNames) {
    const escapedTable = (table as string).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b(FROM|JOIN)\\s+${escapedTable}\\b`, 'gi');

    modifiedSql = modifiedSql.replace(regex, (match, prefix, offset) => {
      const afterMatch = modifiedSql.slice(offset + match.length).trim();

      // If it's already followed by WITH (NOLOCK) or NOLOCK or similar, keep it.
      if (/^(WITH\s*\(NOLOCK\)|NOLOCK)/i.test(afterMatch)) {
        return match;
      }

      // Check if there is an alias (e.g. "FROM chunks c" or "FROM chunks as c")
      const aliasMatch = afterMatch.match(/^(?:as\s+)?([a-zA-Z0-9_]+)/i);
      if (aliasMatch) {
        const alias = aliasMatch[1];
        const keywords = ["where", "on", "join", "group", "order", "limit", "left", "right", "inner", "and", "or"];
        if (!keywords.includes(alias.toLowerCase())) {
          // It's an alias! Let's check if the alias itself is followed by WITH (NOLOCK)
          const afterAlias = afterMatch.slice(aliasMatch[0].length).trim();
          if (/^(WITH\s*\(NOLOCK\)|NOLOCK)/i.test(afterAlias)) {
            return match; // already has NOLOCK after the alias
          }
        }
      }

      return `${prefix} ${table} WITH (NOLOCK)`;
    });
  }

  return modifiedSql;
}

export interface MiddlewareParams {
  model?: string;
  action: string;
  args: any;
  runInTransaction?: boolean;
}

export type MiddlewareNext = (params: MiddlewareParams) => Promise<any>;
export type Middleware = (params: MiddlewareParams, next: MiddlewareNext) => Promise<any>;

// Lazy-load generated schema metadata from the optional `an5-client` package so
// `new An5ORM()` resolves schema models out of the box while staying decoupled.
let autoMetadata: An5Metadata | null = null;
function loadAutoMetadata(): An5Metadata {
  if (autoMetadata) return autoMetadata;
  try {
    const m = require("an5-client/typescript/an5Metadata.js") as An5Metadata;
    autoMetadata = {
      modelToTable: m.modelToTable || {},
      relationMap: m.relationMap || {},
      modelFields: m.modelFields || {},
    };
  } catch {
    autoMetadata = DEFAULT_METADATA;
  }
  return autoMetadata;
}

// Proxied AN5 ORM client class
export class An5ORM {
  [key: string]: any;
  private middlewares: Middleware[] = [];
  public readonly metadata: An5Metadata;

  constructor(private customExecutor?: ExecutorFn, metadata?: An5Metadata) {
    this.metadata = metadata ?? loadAutoMetadata();
    // Add default logging middleware
    this.$use(async (params, next) => {
      const start = Date.now();
      try {
        const result = await next(params);
        const duration = Date.now() - start;
        if (process.env.DEBUG_ORM === "true") {
          logger.info(`ORM [${params.model || 'raw'}.${params.action}] executed in ${duration}ms`);
        }
        return result;
      } catch (err: any) {
        const duration = Date.now() - start;
        logger.error(`ORM [${params.model || 'raw'}.${params.action}] failed after ${duration}ms`, err);
        throw err;
      }
    });

    return new Proxy(this, {
      get(target, prop: string) {
        if (prop === "$use") {
          return target.$use.bind(target);
        }
        if (prop === "$transaction") {
          return target.$transaction.bind(target);
        }
        if (prop === "$connect") {
          return target.$connect.bind(target);
        }
        if (prop === "$disconnect") {
          return target.$disconnect.bind(target);
        }
        if (prop === "$queryRaw") {
          return target.$queryRaw.bind(target);
        }
        if (prop === "$queryRawUnsafe") {
          return target.$queryRawUnsafe.bind(target);
        }
        if (prop === "$executeRaw") {
          return target.$executeRaw.bind(target);
        }
        if (prop === "$executeRawUnsafe") {
          return target.$executeRawUnsafe.bind(target);
        }
        if (!(prop in target) && typeof prop === "string" && !prop.startsWith("_")) {
          // Resolve modelName in camelCase and map to table name
          const tableName = target.metadata.modelToTable[prop];
          if (tableName) {
            target[prop] = new TableClient(
              prop,
              tableName,
              target.customExecutor || execQuery,
              target // Pass ORM instance for middleware access
            );
          }
        }
        return target[prop];
      }
    });
  }

  $use(middleware: Middleware) {
    this.middlewares.push(middleware);
  }

  parseWhere(modelName: string, where: any, params: Record<string, any>, prefix = ""): string {
    return buildWhere(modelName, where, params, prefix, {
      relationMap: this.metadata.relationMap,
      modelToTable: this.metadata.modelToTable,
    });
  }

  async _executeMiddleware(params: MiddlewareParams, finalAction: (params: MiddlewareParams) => Promise<any>): Promise<any> {
    let index = -1;
    const dispatch = async (i: number, currentParams: MiddlewareParams): Promise<any> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let fn: Middleware | undefined = this.middlewares[i];
      if (i === this.middlewares.length) {
        return finalAction(currentParams);
      }
      if (!fn) return;
      return fn(currentParams, (p) => dispatch(i + 1, p));
    };
    return dispatch(0, params);
  }

  async $connect(): Promise<void> { }
  async $disconnect(): Promise<void> {
    if (adapter) {
      await adapter.$disconnect();
      adapter = null;
    }
  }

  async $queryRaw(queryParts: any, ...values: any[]): Promise<any[]> {
    const executor = this.customExecutor || execQuery;
    let queryText = "";
    const params: Record<string, any> = {};

    if (Array.isArray(queryParts) && (queryParts as any).raw !== undefined) {
      const strings = queryParts as unknown as TemplateStringsArray;
      for (let i = 0; i < strings.length; i++) {
        queryText += strings[i];
        if (i < values.length) {
          const paramName = `p_${i}`;
          queryText += `@${paramName}`;
          params[paramName] = values[i];
        }
      }
    } else if (typeof queryParts === "string") {
      queryText = queryParts;
      if (values && values.length > 0) {
        values.forEach((val, idx) => {
          const paramName = `p_${idx}`;
          params[paramName] = val;
        });
      }
    } else {
      throw new Error("Invalid query format for $queryRaw");
    }

    queryText = addNoLockToQuery(queryText, this.metadata);
    return executor(queryText, params);
  }

  async $queryRawUnsafe<R = any>(queryText: string, ...values: any[]): Promise<R> {
    const executor = this.customExecutor || execQuery;
    const params: Record<string, any> = {};
    if (values && values.length > 0) {
      values.forEach((val, idx) => {
        const paramName = `p_${idx}`;
        params[paramName] = val;
      });
    }

    const modifiedQueryText = addNoLockToQuery(queryText, this.metadata);
    const result = await executor(modifiedQueryText, params);
    return result as unknown as R;
  }

  async $executeRaw(queryParts: any, ...values: any[]): Promise<number> {
    const executor = this.customExecutor || execQuery;
    let queryText = "";
    const params: Record<string, any> = {};

    if (Array.isArray(queryParts) && (queryParts as any).raw !== undefined) {
      const strings = queryParts as unknown as TemplateStringsArray;
      for (let i = 0; i < strings.length; i++) {
        queryText += strings[i];
        if (i < values.length) {
          const paramName = `p_${i}`;
          queryText += `@${paramName}`;
          params[paramName] = values[i];
        }
      }
    } else if (typeof queryParts === "string") {
      queryText = queryParts;
      if (values && values.length > 0) {
        values.forEach((val, idx) => {
          const paramName = `p_${idx}`;
          params[paramName] = val;
        });
      }
    } else {
      throw new Error("Invalid query format for $executeRaw");
    }

    queryText = addNoLockToQuery(queryText, this.metadata);
    const result = (await executor(queryText, params)) as any;
    return result.rowsAffected?.[0] || 0;
  }

  async $executeRawUnsafe(queryText: string, ...values: any[]): Promise<number> {
    const executor = this.customExecutor || execQuery;
    const params: Record<string, any> = {};
    if (values && values.length > 0) {
      values.forEach((val, idx) => {
        const paramName = `p_${idx}`;
        params[paramName] = val;
      });
    }

    const modifiedQueryText = addNoLockToQuery(queryText, this.metadata);
    const result = (await executor(modifiedQueryText, params)) as any;
    return result.rowsAffected?.[0] || 0;
  }

  async $transaction<R>(
    fn: ((tx: any) => Promise<R>) | Promise<any>[],
    options?: { timeout?: number }
  ): Promise<any> {
    if (Array.isArray(fn)) {
      return Promise.all(fn);
    }

    const a = await getAdapter();
    return a.$transaction(async (tx) => {
      const txExecutor: ExecutorFn = async (queryText: string, params?: Record<string, any>) => {
        const rows = await tx.exec(queryText, params);
        return rows;
      };

      const txClient = new An5ORM(txExecutor, this.metadata);
      return fn(txClient);
    }, options);
  }
}

export const an5Orm = new An5ORM();
export default an5Orm;

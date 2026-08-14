import { An5Adapter, AdapterTableClient, createAn5Adapter, executorFromAdapter, setAdapterMetadata } from "@an5/adapters";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { An5ClientKnownRequestError } from "./errors";
import { DEFAULT_METADATA, An5Metadata } from "./metadata";
import {
  quoteIdentifier,
  sanitizeParamName,
  normalizeSortDirection,
  toNonNegativeInt,
  quoteTableIdentifier,
  buildOrderBy,
  parseWhere as buildWhere,
} from "./sql-utils";

type ExecutorFn = ((queryText: string, params?: Record<string, any>) => Promise<any[]>) & {
  executeRaw?: (queryText: string, params?: Record<string, any>) => Promise<number>;
  transaction?: <R>(fn: (txExecutor: ExecutorFn) => Promise<R>, options?: { timeout?: number }) => Promise<R>;
  beginTransaction?: () => Promise<InteractiveTransactionExecutor>;
};

type InteractiveTransactionExecutor = {
  executor: ExecutorFn;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
};

function aggSelect(fn: string, key: string): string {
  return `${fn}(${quoteIdentifier(key)}) as ${aggAlias(fn.toLowerCase(), key)}`;
}

function aggAlias(fn: string, key: string): string {
  return sanitizeParamName(`${fn}_${key}`);
}

let defaultExecutor: ExecutorFn | null = null;

function getDefaultExecutor(): ExecutorFn {
  if (!defaultExecutor) {
    const adapter = createAn5Adapter({ connectionString: process.env.DATABASE_URL! });
    defaultExecutor = executorFromAdapter(adapter);
  }
  return defaultExecutor!;
}

function normalizeAffectedCount(result: any): number {
  if (typeof result === "number") return result;
  if (!result) return 0;
  if (Array.isArray(result.rowsAffected)) return Number(result.rowsAffected[0] ?? 0);
  if (typeof result.rowsAffected === "number") return result.rowsAffected;
  if (typeof result.count === "number") return result.count;
  if (Array.isArray(result) && result.length === 1) return normalizeAffectedCount(result[0]);
  return 0;
}

const FILTER_OPERATOR_KEYS = new Set(["in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt"]);

function flattenSimpleEqualityWhere(where: any): Record<string, any> | null {
  if (!where || typeof where !== "object" || where instanceof Date || Array.isArray(where)) {
    return null;
  }

  const flat: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    if (value === null || value === undefined || Array.isArray(value)) return null;
    if (value instanceof Date || typeof value !== "object") {
      flat[key] = value;
      continue;
    }
    if (!key.includes("_")) return null;

    for (const [innerKey, innerValue] of Object.entries(value as Record<string, any>)) {
      if (FILTER_OPERATOR_KEYS.has(innerKey)) return null;
      if (innerValue === null || innerValue === undefined || (typeof innerValue === "object" && !(innerValue instanceof Date))) {
        return null;
      }
      flat[innerKey] = innerValue;
    }
  }

  return Object.keys(flat).length > 0 ? flat : null;
}

function asArray<T = any>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function hasOwn(obj: any, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function appendUpdateSet(sets: string[], params: Record<string, any>, key: string, val: any): void {
  const col = quoteIdentifier(key);
  const safeKey = sanitizeParamName(key);

  if (val && typeof val === "object" && !(val instanceof Date)) {
    const ops: Array<[string, string]> = [
      ['increment', '+'],
      ['decrement', '-'],
      ['multiply', '*'],
      ['divide', '/'],
    ];

    for (const [opKey, symbol] of ops) {
      if (val[opKey] !== undefined) {
        const paramName = `${safeKey}_${opKey.slice(0, 3)}`;
        sets.push(`${col} = ${col} ${symbol} @${paramName}`);
        params[paramName] = val[opKey];
        return;
      }
    }

    if (val.set !== undefined) {
      const paramName = `${safeKey}_set`;
      sets.push(`${col} = @${paramName}`);
      params[paramName] = val.set;
      return;
    }
  }

  sets.push(`${col} = @${safeKey}`);
  params[safeKey] = val;
}

function normalizeByFields(by: any): string[] {
  if (typeof by === "string") return [by];
  return Array.isArray(by) ? by.filter((field) => typeof field === "string" && field.length > 0) : [];
}

function selectedAggregateFields(fields: any): string[] {
  if (!fields || typeof fields !== "object") return [];
  return Object.keys(fields).filter((key) => fields[key]);
}

function aggregateExpression(kind: string, field: string): string {
  const upper = kind.toUpperCase();
  if (upper === "COUNT" && field === "_all") return "COUNT(*)";
  return `${upper}(${quoteIdentifier(field)})`;
}

function addHavingPredicate(
  conditions: string[],
  params: Record<string, any>,
  expr: string,
  paramBase: string,
  filter: any
): void {
  if (filter && typeof filter === "object" && !(filter instanceof Date)) {
    for (const [op, value] of Object.entries(filter)) {
      const p = sanitizeParamName(`having_${paramBase}_${op}`);
      if (op === "equals") {
        conditions.push(`${expr} = @${p}`);
        params[p] = value;
      } else if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
        const symbol = op === "gt" ? ">" : op === "gte" ? ">=" : op === "lt" ? "<" : "<=";
        conditions.push(`${expr} ${symbol} @${p}`);
        params[p] = value;
      } else if (op === "not") {
        if (value && typeof value === "object" && !(value instanceof Date)) {
          const nested: string[] = [];
          addHavingPredicate(nested, params, expr, `${paramBase}_not`, value);
          if (nested.length > 0) conditions.push(`NOT (${nested.join(" AND ")})`);
        } else {
          conditions.push(`${expr} <> @${p}`);
          params[p] = value;
        }
      } else if ((op === "in" || op === "notIn") && Array.isArray(value)) {
        if (value.length === 0) {
          conditions.push(op === "in" ? "1 = 0" : "1 = 1");
        } else {
          const placeholders = value.map((item, idx) => {
            const itemParam = sanitizeParamName(`${p}_${idx}`);
            params[itemParam] = item;
            return `@${itemParam}`;
          });
          conditions.push(`${expr} ${op === "in" ? "IN" : "NOT IN"} (${placeholders.join(", ")})`);
        }
      }
    }
    return;
  }

  const p = sanitizeParamName(`having_${paramBase}`);
  conditions.push(`${expr} = @${p}`);
  params[p] = filter;
}

function buildHavingSql(having: any, params: Record<string, any>): string {
  if (!having || typeof having !== "object") return "";
  const conditions: string[] = [];
  const aggregateKeys: Record<string, string> = {
    _count: "COUNT",
    _sum: "SUM",
    _avg: "AVG",
    _min: "MIN",
    _max: "MAX",
  };

  for (const [key, sqlFn] of Object.entries(aggregateKeys)) {
    const fields = having[key];
    if (!fields || typeof fields !== "object") continue;
    for (const [field, filter] of Object.entries(fields)) {
      addHavingPredicate(conditions, params, aggregateExpression(sqlFn, field), `${key}_${field}`, filter);
    }
  }

  return conditions.length > 0 ? conditions.join(" AND ") : "";
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

function collectRelationSelections(modelName: string, select: any, metadata: An5Metadata): any {
  if (!select || typeof select !== "object") return undefined;
  const modelRelations = metadata.relationMap[modelName] || {};
  const relationSelections: Record<string, any> = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    if (key === "_count" || modelRelations[key]) {
      relationSelections[key] = value;
    }
  }
  return Object.keys(relationSelections).length > 0 ? relationSelections : undefined;
}

function mergeIncludes(primary: any, secondary: any): any {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return { ...secondary, ...primary };
}

function relationOrderClause(orderBy: any, fallbackKey: string): string {
  const sql = buildOrderBy(orderBy);
  return sql ? sql.replace(/^\s*ORDER\s+BY\s+/i, "") : `${quoteIdentifier(fallbackKey)} ASC`;
}

function requiredRelationKeys(modelName: string, include: any, metadata: An5Metadata): string[] {
  if (!include || typeof include !== "object") return [];
  const modelRelations = metadata.relationMap[modelName] || {};
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(include)) {
    if (!value) continue;
    const relation = modelRelations[key];
    if (!relation) {
      if (key === "_count") {
        for (const rel of Object.values(modelRelations)) {
          keys.add(rel.localKey);
        }
      }
      continue;
    }
    keys.add(relation.relationType === "one" ? relation.foreignKey : relation.localKey);
  }
  return Array.from(keys);
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
      if (key === "_count" && value) {
        const countFields = value === true
          ? Object.keys(modelRelations)
          : Object.keys((value as any).select || {}).filter((field) => (value as any).select[field]);
        for (const countField of countFields) {
          const rel = modelRelations[countField];
          if (rel) {
            const relTable = quoteTableIdentifier(metadata.modelToTable[rel.modelName] || rel.modelName);
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

    const relTable = quoteTableIdentifier(metadata.modelToTable[relation.modelName] || relation.modelName);
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
    const nestedInclude = value && typeof value === "object"
      ? mergeIncludes((value as any).include, collectRelationSelections(relation.modelName, (value as any).select, metadata))
      : undefined;
    if (value && typeof value === "object" && (value as any).select) {
      const subSelect = (value as any).select;
      const subRelations = metadata.relationMap[relation.modelName] || {};
      const selectedSubCols = Object.keys(subSelect)
        .filter(k => subSelect[k] && !subRelations[k])
        .map(k => quoteIdentifier(k));
      if (selectedSubCols.length > 0) {
        for (const requiredKey of [searchKey, ...requiredRelationKeys(relation.modelName, nestedInclude, metadata)]) {
          const quotedRequiredKey = quoteIdentifier(requiredKey);
          if (!selectedSubCols.includes(quotedRequiredKey)) {
            selectedSubCols.push(quotedRequiredKey);
          }
        }
        relCols = selectedSubCols.join(", ");
      }
    }

    const filters = [`${quoteIdentifier(searchKey)} IN (${uniqueKeys.map((_, i) => `@k_${i}`).join(", ")})`];
    let sqlText = "";
    const subParams: Record<string, any> = {};
    uniqueKeys.forEach((k, i) => { subParams[`k_${i}`] = k; });

    let subArgs: any = undefined;
    if (value && typeof value === "object") {
      subArgs = value as any;
      const subWhereSql = buildWhere(relation.modelName, subArgs.where, subParams, `rel_${key}_`, {
        relationMap: metadata.relationMap,
        modelToTable: metadata.modelToTable,
      });
      if (subWhereSql) {
        filters.push(subWhereSql);
      }
    }

    const hasRelationPagination = isMany && subArgs && (subArgs.take !== undefined || subArgs.skip !== undefined);
    if (hasRelationPagination) {
      const rn = quoteIdentifier("__an5_rn");
      const skip = toNonNegativeInt(subArgs.skip);
      const take = subArgs.take !== undefined ? toNonNegativeInt(subArgs.take, 1) : undefined;
      const whereSql = filters.join(" AND ");
      sqlText = `SELECT * FROM (
        SELECT ${relCols}, ROW_NUMBER() OVER (PARTITION BY ${quoteIdentifier(searchKey)} ORDER BY ${relationOrderClause(subArgs.orderBy, searchKey)}) AS ${rn}
        FROM ${relTable} WITH (NOLOCK)
        WHERE ${whereSql}
      ) AS [an5_rel]
      WHERE ${rn} > ${skip}`;
      if (take !== undefined) {
        sqlText += ` AND ${rn} <= ${skip + take}`;
      }
      sqlText += ` ORDER BY ${quoteIdentifier(searchKey)}, ${rn}`;
    } else {
      sqlText = `SELECT ${relCols} FROM ${relTable} WITH (NOLOCK) WHERE ${filters.join(" AND ")}`;
      if (subArgs?.orderBy) {
        sqlText += buildOrderBy(subArgs.orderBy);
      }
    }

    const relatedRows = await executor(sqlText, subParams);
    relatedRows.forEach((r: any) => { delete r.__an5_rn; });

    if (nestedInclude) {
      await resolveIncludes(relation.modelName, relatedRows, nestedInclude, executor, metadata);
    }

    const outputRows = value && typeof value === "object" && (value as any).select
      ? relatedRows.map((r) => projectFields(r, (value as any).select))
      : relatedRows;
    const groupMap = new Map<any, any[]>();
    relatedRows.forEach((r: any, idx: number) => {
      const k = r[searchKey];
      if (!groupMap.has(k)) groupMap.set(k, []);
      groupMap.get(k)!.push(outputRows[idx]);
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

function adapterFromExecutor(executor: ExecutorFn): An5Adapter {
  return new An5Adapter({
    engine: {
      dialect: "mssql",
      connect: async () => {},
      disconnect: async () => {},
      exec: async (q: string, p: any) => executor(q, p),
      executeRaw: async (q: string, p: any): Promise<number> => (executor.executeRaw ? executor.executeRaw(q, p) : normalizeAffectedCount(await executor(q, p))),
      beginTransaction: async () => { throw new Error("Transaction not supported"); },
    },
  });
}

// Table query executor client class
export class TableClient<T = any> extends AdapterTableClient<T> {
  public readonly rawTableName: string;

  constructor(
    modelName: string,
    rawTableName: string,
    private executor: ExecutorFn,
    private orm: An5ORM
  ) {
    super(adapterFromExecutor(executor), modelName);
    this.rawTableName = quoteTableIdentifier(rawTableName);
  }

  private async executeRaw(queryText: string, params?: Record<string, any>): Promise<number> {
    if (this.executor.executeRaw) {
      return this.executor.executeRaw(queryText, params);
    }
    return normalizeAffectedCount(await this.executor(queryText, params));
  }

  async findMany(args?: any): Promise<T[]> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'findMany', args }, async (params) => {
      const { args: finalArgs } = params;
      const hasSkip = finalArgs?.skip !== undefined && finalArgs?.skip !== null;
      const selectedRelations = collectRelationSelections(this.modelName, finalArgs?.select, this.orm.metadata);
      const include = mergeIncludes(finalArgs?.include, selectedRelations);

      let cols = "*";
      if (finalArgs?.select) {
        const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
        const selectedColNames = Object.keys(finalArgs.select)
          .filter(k => finalArgs.select[k] && !modelRelations[k] && k !== "_count");
        for (const key of requiredRelationKeys(this.modelName, include, this.orm.metadata)) {
          if (!selectedColNames.includes(key)) {
            selectedColNames.push(key);
          }
        }
        const selectedCols = selectedColNames.map(k => quoteIdentifier(k));
        if (selectedCols.length > 0) {
          cols = selectedCols.join(", ");
        }
      }

      let sqlText = "SELECT";
      if (finalArgs?.take && !hasSkip) {
        sqlText += ` TOP (${toNonNegativeInt(finalArgs.take, 1)})`;
      }
      sqlText += ` ${cols} FROM ${this.rawTableName} WITH (NOLOCK)`;

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
      if (include) {
        await resolveIncludes(this.modelName, rows, include, this.executor, this.orm.metadata);
      }
      if (finalArgs?.select) {
        rows.forEach((r, idx) => {
          rows[idx] = projectFields(r, finalArgs.select);
        });
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
      return super.count(params.args);
    });
  }

  private scopedRelationWhere(relation: any, parentId: any, where?: any): any {
    const parentWhere = { [relation.foreignKey]: parentId };
    if (!where || Object.keys(where).length === 0) return parentWhere;
    return { AND: [where, parentWhere] };
  }

  private async handleNestedWrites(data: any, parentId: any) {
    const modelRelations = this.orm.metadata.relationMap[this.modelName] || {};
    for (const [key, value] of Object.entries(data)) {
      const relation = modelRelations[key];
      if (!relation || !value || typeof value !== "object" || (value instanceof Date)) continue;

      const relTableClient = this.orm[relation.modelName];
      if (!relTableClient) continue;

      const nestedOps = value as any;
      if (relation.relationType !== "many") continue;

      if (hasOwn(nestedOps, "set")) {
        await relTableClient.updateMany({
          where: { [relation.foreignKey]: parentId },
          data: { [relation.foreignKey]: null },
        });
        for (const item of asArray(nestedOps.set)) {
          await relTableClient.update({
            where: item,
            data: { [relation.foreignKey]: parentId }
          });
        }
      }

      // Handle deleteMany (an5Orm-style)
      if (hasOwn(nestedOps, "deleteMany")) {
        const deleteWhere = Array.isArray(nestedOps.deleteMany) ? { OR: nestedOps.deleteMany } : nestedOps.deleteMany;
        // Scope deletion to parent
        const scopedWhere = this.scopedRelationWhere(relation, parentId, deleteWhere);
        await relTableClient.deleteMany({ where: scopedWhere });
      }

      if (hasOwn(nestedOps, "delete")) {
        const deleteWhere = Array.isArray(nestedOps.delete) ? { OR: nestedOps.delete } : nestedOps.delete;
        await relTableClient.deleteMany({
          where: this.scopedRelationWhere(relation, parentId, deleteWhere),
        });
      }

      if (hasOwn(nestedOps, "disconnect")) {
        const disconnectWhere = Array.isArray(nestedOps.disconnect) ? { OR: nestedOps.disconnect } : nestedOps.disconnect;
        await relTableClient.updateMany({
          where: this.scopedRelationWhere(relation, parentId, disconnectWhere),
          data: { [relation.foreignKey]: null },
        });
      }

      if (hasOwn(nestedOps, "update")) {
        for (const item of asArray(nestedOps.update)) {
          await relTableClient.update({
            where: this.scopedRelationWhere(relation, parentId, item.where),
            data: item.data,
          });
        }
      }

      if (hasOwn(nestedOps, "upsert")) {
        for (const item of asArray(nestedOps.upsert)) {
          await relTableClient.upsert({
            where: this.scopedRelationWhere(relation, parentId, item.where),
            create: { ...item.create, [relation.foreignKey]: parentId },
            update: item.update,
          });
        }
      }

      // Handle create
      if (hasOwn(nestedOps, "create")) {
        for (const item of asArray(nestedOps.create)) {
          // Inject parent ID
          const itemData = { ...item, [relation.foreignKey]: parentId };
          await relTableClient.create({ data: itemData });
        }
      }

      // Handle connect
      if (hasOwn(nestedOps, "connect")) {
        for (const item of asArray(nestedOps.connect)) {
          await relTableClient.update({
            where: item,
            data: { [relation.foreignKey]: parentId }
          });
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
          const nestedValue = value && typeof value === "object" ? (value as any) : {};
          if (rel && rel.relationType === "one" && (nestedValue.connect || nestedValue.set)) {
            const connectObj = nestedValue.connect || nestedValue.set;
            const targetId = connectObj[rel.localKey] || connectObj.id || Object.values(connectObj)[0];
            data[rel.foreignKey] = targetId;
          }
        }

        const keys = Object.keys(data);
        const columns = keys.map(k => quoteIdentifier(k)).join(", ");
        const safeKeys = keys.map(k => sanitizeParamName(k));
        const placeholders = safeKeys.map(k => `@${k}`).join(", ");
        const safeData: Record<string, any> = {};
        keys.forEach((k, i) => { safeData[safeKeys[i]] = data[k]; });

        const sqlText = `INSERT INTO ${this.rawTableName} (${columns}) OUTPUT inserted.* VALUES (${placeholders})`;
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
        const nestedValue = value && typeof value === "object" ? (value as any) : {};
        if (rel && rel.relationType === "one") {
          if (nestedValue.connect || nestedValue.set) {
            const connectObj = nestedValue.connect || nestedValue.set;
            const targetId = connectObj[rel.localKey] || connectObj.id || Object.values(connectObj)[0];
            data[rel.foreignKey] = targetId;
          } else if (hasOwn(nestedValue, "disconnect") || value === null) {
            data[rel.foreignKey] = null;
          }
        }
      }

      const sets: string[] = [];
      const p: Record<string, any> = {};

      for (const key of Object.keys(data)) {
        const val = data[key];
        appendUpdateSet(sets, p, key, val);
      }

      const whereParams: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, whereParams, "w_");
      Object.assign(p, whereParams);

      const existing = await this.findUnique({ where: finalArgs.where });
      if (!existing) throw new Error("Record not found to update");
      const parentId = (existing as any).id;

      if (sets.length > 0) {
        const sqlText = `UPDATE ${this.tableName} SET ${sets.join(", ")} WHERE ${whereSql}`;
        await this.executor(sqlText, p);
      }

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
        appendUpdateSet(sets, p, key, val);
      }

      if (sets.length === 0) {
        return { count: 0 };
      }

      const whereParams: Record<string, any> = {};
      const whereSql = this.orm.parseWhere(this.modelName, finalArgs.where, whereParams, "w_");
      Object.assign(p, whereParams);

      const sqlText = `UPDATE ${this.rawTableName} SET ${sets.join(", ")}${whereSql ? ` WHERE ${whereSql}` : ""}`;
      const count = await this.executeRaw(sqlText, p);
      return { count };
    });
  }

  async delete(args: any): Promise<T> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'delete', args }, async (params) => {
      const { args: finalArgs } = params;
      return super.delete({ where: finalArgs?.where || finalArgs });
    });
  }

  async deleteMany(args?: any): Promise<{ count: number }> {
    return this.orm._executeMiddleware({ model: this.modelName, action: 'deleteMany', args }, async (params) => {
      const { args: finalArgs } = params;
      return super.deleteMany({ where: finalArgs?.where || finalArgs });
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
        const msg = (String(err?.message || "") + " " + String(err?.originalError?.message || "")).toLowerCase();
        
        // Handle specific float16 to float32 conversion error by retrying with float16
        if (msg.includes("float16") && msg.includes("float32") && msg.includes("conversion") && !finalArgs.vectorElementType) {
          logger.info(`Detected float16 vector storage. Retrying vectorSearch with float16 element type.`);
          return (this as any).vectorSearch({ ...finalArgs, vectorElementType: 'float16' });
        }

        const isUnsupported = msg.includes("vector_distance") ||
          msg.includes("type vector") ||
          msg.includes("type \"vector\"") ||
          msg.includes("data type vector") ||
          msg.includes("incorrect syntax") ||
          msg.includes("syntax near") ||
          msg.includes("not a recognized built-in function") ||
          msg.includes("not a defined system type") ||
          msg.includes("limit of 1998") ||
          err?.number === 195 ||
          err?.number === 102 ||
          err?.number === 319 ||
          err?.originalError?.number === 319;

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
        await this.executeRaw(sqlText, params);
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
        for (const key of selectedAggregateFields(finalArgs._sum)) {
          selects.push(aggSelect("SUM", key));
        }
      }
      if (finalArgs._avg) {
        resultObj._avg = {};
        for (const key of selectedAggregateFields(finalArgs._avg)) {
          selects.push(aggSelect("AVG", key));
        }
      }
      if (finalArgs._min) {
        resultObj._min = {};
        for (const key of selectedAggregateFields(finalArgs._min)) {
          selects.push(aggSelect("MIN", key));
        }
      }
      if (finalArgs._max) {
        resultObj._max = {};
        for (const key of selectedAggregateFields(finalArgs._max)) {
          selects.push(aggSelect("MAX", key));
        }
      }
      if (finalArgs._count) {
        resultObj._count = {};
        if (finalArgs._count === true || finalArgs._count._all) {
          selects.push(`COUNT(*) as count_all`);
        } else {
          for (const key of selectedAggregateFields(finalArgs._count)) {
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
        for (const key of selectedAggregateFields(finalArgs._sum)) {
          resultObj._sum[key] = row[aggAlias("sum", key)] !== undefined ? row[aggAlias("sum", key)] : null;
        }
      }
      if (finalArgs._avg) {
        for (const key of selectedAggregateFields(finalArgs._avg)) {
          resultObj._avg[key] = row[aggAlias("avg", key)] !== undefined ? row[aggAlias("avg", key)] : null;
        }
      }
      if (finalArgs._min) {
        for (const key of selectedAggregateFields(finalArgs._min)) {
          resultObj._min[key] = row[aggAlias("min", key)] !== undefined ? row[aggAlias("min", key)] : null;
        }
      }
      if (finalArgs._max) {
        for (const key of selectedAggregateFields(finalArgs._max)) {
          resultObj._max[key] = row[aggAlias("max", key)] !== undefined ? row[aggAlias("max", key)] : null;
        }
      }
      if (finalArgs._count) {
        if (finalArgs._count === true || finalArgs._count._all) {
          resultObj._count._all = row[`count_all`] || 0;
        } else {
          for (const key of selectedAggregateFields(finalArgs._count)) {
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
      const byFields = normalizeByFields(finalArgs.by);
      if (byFields.length === 0) {
        throw new Error("groupBy requires 'by' fields");
      }

      const selects = byFields.map((f: string) => quoteIdentifier(f));

      if (finalArgs._count) {
        if (finalArgs._count === true || finalArgs._count._all) {
          selects.push(`COUNT(*) as count_all`);
        } else {
          for (const key of selectedAggregateFields(finalArgs._count)) {
            selects.push(aggSelect("COUNT", key));
          }
        }
      }
      if (finalArgs._sum) {
        for (const key of selectedAggregateFields(finalArgs._sum)) {
          selects.push(aggSelect("SUM", key));
        }
      }
      if (finalArgs._avg) {
        for (const key of selectedAggregateFields(finalArgs._avg)) {
          selects.push(aggSelect("AVG", key));
        }
      }
      if (finalArgs._min) {
        for (const key of selectedAggregateFields(finalArgs._min)) {
          selects.push(aggSelect("MIN", key));
        }
      }
      if (finalArgs._max) {
        for (const key of selectedAggregateFields(finalArgs._max)) {
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
      const havingSql = buildHavingSql(finalArgs?.having, p);
      if (havingSql) {
        sqlText += ` HAVING ${havingSql}`;
      }

      const hasSkip = finalArgs?.skip !== undefined && finalArgs?.skip !== null;
      const hasTake = finalArgs?.take !== undefined && finalArgs?.take !== null;
      if (finalArgs?.orderBy) {
        sqlText += buildOrderBy(finalArgs.orderBy);
      } else if (hasSkip || hasTake) {
        sqlText += ` ORDER BY ${byFields.map((f: string) => quoteIdentifier(f)).join(", ")}`;
      }
      if (hasSkip || hasTake) {
        sqlText += ` OFFSET ${toNonNegativeInt(finalArgs.skip)} ROWS`;
        if (hasTake) {
          sqlText += ` FETCH NEXT ${toNonNegativeInt(finalArgs.take, 1)} ROWS ONLY`;
        }
      }

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
            for (const key of selectedAggregateFields(finalArgs._count)) {
              item._count[key] = row[aggAlias("count", key)] || 0;
            }
          }
        }
        if (finalArgs._sum) {
          item._sum = {};
          for (const key of selectedAggregateFields(finalArgs._sum)) {
            item._sum[key] = row[aggAlias("sum", key)] !== undefined ? row[aggAlias("sum", key)] : null;
          }
        }
        if (finalArgs._avg) {
          item._avg = {};
          for (const key of selectedAggregateFields(finalArgs._avg)) {
            item._avg[key] = row[aggAlias("avg", key)] !== undefined ? row[aggAlias("avg", key)] : null;
          }
        }
        if (finalArgs._min) {
          item._min = {};
          for (const key of selectedAggregateFields(finalArgs._min)) {
            item._min[key] = row[aggAlias("min", key)] !== undefined ? row[aggAlias("min", key)] : null;
          }
        }
        if (finalArgs._max) {
          item._max = {};
          for (const key of selectedAggregateFields(finalArgs._max)) {
            item._max[key] = row[aggAlias("max", key)] !== undefined ? row[aggAlias("max", key)] : null;
          }
        }

        return item;
      });
    });
  }

  private async sequentialUpsert(finalArgs: any): Promise<T> {
    const existing = await this.findUnique({ where: finalArgs.where });
    if (existing) {
      return this.update({ where: finalArgs.where, data: finalArgs.update, include: finalArgs.include });
    }
    return this.create({ data: finalArgs.create, include: finalArgs.include });
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

      const atomicWhere = flattenSimpleEqualityWhere(where);
      if (!atomicWhere || Object.keys(cleanUpdate).length === 0) {
        return this.sequentialUpsert(finalArgs);
      }

      const p: Record<string, any> = {};

      const allKeys = Array.from(new Set([...Object.keys(cleanCreate), ...Object.keys(cleanUpdate)]));
      const cParam = (k: string) => `c_${sanitizeParamName(k)}`;
      const uParam = (k: string) => `u_${sanitizeParamName(k)}`;
      for (const k of allKeys) {
        if (cleanCreate[k] !== undefined) p[cParam(k)] = cleanCreate[k];
        if (cleanUpdate[k] !== undefined) p[uParam(k)] = cleanUpdate[k];
      }
      for (const [k, v] of Object.entries(atomicWhere)) {
        p[`upw_${sanitizeParamName(k)}`] = v;
      }

      const sourceSelect = allKeys.map(k => {
        const val = cleanCreate[k] !== undefined ? `@${cParam(k)}` : (cleanUpdate[k] !== undefined ? `@${uParam(k)}` : "NULL");
        return `${val} as ${quoteIdentifier(k)}`;
      }).join(", ");

      const updateSets = Object.keys(cleanUpdate).map(k => `target.${quoteIdentifier(k)} = source.${quoteIdentifier(k)}`).join(", ");
      const insertCols = Object.keys(cleanCreate).map(k => quoteIdentifier(k)).join(", ");
      const insertVals = Object.keys(cleanCreate).map(k => `source.${quoteIdentifier(k)}`).join(", ");

      const onClause = Object.keys(atomicWhere)
        .map(k => `target.${quoteIdentifier(k)} = @upw_${sanitizeParamName(k)}`)
        .join(" AND ");

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
        return this.sequentialUpsert(finalArgs);
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

export type LogLevel = "query" | "info" | "warn" | "error";

export interface QueryEvent {
  timestamp: Date;
  query: string;
  params?: Record<string, any>;
  duration: number;
  model?: string;
  action?: string;
  error?: Error;
}

export interface LogEvent {
  timestamp: Date;
  message: string;
  level: LogLevel;
  duration?: number;
  query?: string;
  params?: Record<string, any>;
  error?: Error;
}

export type EventListener<T = any> = (event: T) => void;

// Lazy-load generated schema metadata from the ORM's own generated copy so
// `new An5ORM()` resolves schema models out of the box without the core ever
// importing from the generated client package (client is generated FROM the ORM).
export class ViewClient<T = any> {
  private tableClient: TableClient<T>;

  constructor(
    public viewName: string,
    public rawTableName: string,
    public executor: ExecutorFn,
    public orm?: An5ORM
  ) {
    this.tableClient = new TableClient(viewName, rawTableName, executor, orm as An5ORM);
  }

  async findMany(args?: any): Promise<T[]> { return this.tableClient.findMany(args); }
  async findFirst(args?: any): Promise<T | null> { return this.tableClient.findFirst(args); }
  async findUnique(args?: any): Promise<T | null> { return this.tableClient.findUnique(args); }
  async count(args?: any): Promise<number> { return this.tableClient.count(args); }
  async aggregate(args?: any): Promise<any> { return this.tableClient.aggregate(args); }
  async groupBy(args?: any): Promise<any[]> { return this.tableClient.groupBy(args); }
  async vectorSearch(args: any): Promise<T[]> { return this.tableClient.vectorSearch(args); }

  async create(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support create operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async createMany(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support createMany operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async update(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support update operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async updateMany(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support updateMany operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async delete(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support delete operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async deleteMany(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support deleteMany operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
  async upsert(): Promise<never> {
    throw new An5ClientKnownRequestError("Views are read-only and do not support upsert operations.", { code: "P2000", clientVersion: "1.0.8" });
  }
}

function buildProcCallSql(procName: string, params?: Record<string, any> | any[]): { sqlText: string; p: Record<string, any> } {
  const p: Record<string, any> = {};
  const targetProc = quoteTableIdentifier(procName);
  if (!params) {
    return { sqlText: `EXEC ${targetProc};`, p };
  }
  if (Array.isArray(params)) {
    const argList = params.map((val, idx) => {
      const key = `p_${idx}`;
      p[key] = val;
      return `@${key}`;
    }).join(", ");
    return { sqlText: `EXEC ${targetProc} ${argList};`, p };
  }
  const argList = Object.entries(params).map(([key, val], idx) => {
    const paramKey = sanitizeParamName(`p_${key}_${idx}`);
    p[paramKey] = val;
    return `@${sanitizeParamName(key)} = @${paramKey}`;
  }).join(", ");
  return { sqlText: `EXEC ${targetProc} ${argList};`, p };
}

function buildFunctionCallSql(fnName: string, params?: Record<string, any> | any[]): { sqlText: string; p: Record<string, any> } {
  const p: Record<string, any> = {};
  const targetFn = quoteTableIdentifier(fnName);
  if (!params) {
    return { sqlText: `SELECT * FROM ${targetFn}();`, p };
  }
  if (Array.isArray(params)) {
    const argList = params.map((val, idx) => {
      const key = `p_${idx}`;
      p[key] = val;
      return `@${key}`;
    }).join(", ");
    return { sqlText: `SELECT * FROM ${targetFn}(${argList});`, p };
  }
  const argList = Object.entries(params).map(([key, val], idx) => {
    const paramKey = sanitizeParamName(`p_${key}_${idx}`);
    p[paramKey] = val;
    return `@${paramKey}`;
  }).join(", ");
  return { sqlText: `SELECT * FROM ${targetFn}(${argList});`, p };
}

let autoMetadata: An5Metadata | null = null;
function loadAutoMetadata(): An5Metadata {
  if (autoMetadata) return autoMetadata;
  const candidates = [
    "an5-client/typescript/an5Metadata",
    "../an5Client/typescript/an5Metadata"
  ];
  for (const cand of candidates) {
    try {
      const m = require(cand) as An5Metadata;
      if (m && m.modelToTable && Object.keys(m.modelToTable).length > 0) {
        autoMetadata = {
          modelToTable: m.modelToTable || {},
          relationMap: m.relationMap || {},
          modelFields: m.modelFields || {},
        };
        return autoMetadata;
      }
    } catch {}
  }
  autoMetadata = DEFAULT_METADATA;
  return autoMetadata;
}

// Proxied AN5 ORM client class
export class An5ORM {
  [key: string]: any;
  private middlewares: Middleware[] = [];
  private eventListeners: Map<string, Set<EventListener>> = new Map();
  public slowQueryThresholdMs: number = Number(process.env.SLOW_QUERY_THRESHOLD_MS ?? 500);
  public readonly metadata: An5Metadata;

  private customExecutor?: ExecutorFn;

  constructor(
    customExecutor?: ExecutorFn | An5Adapter | any,
    metadata?: An5Metadata,
    private readonly inTransaction = false,
    private transactionControl?: Pick<InteractiveTransactionExecutor, "commit" | "rollback">
  ) {
    if (customExecutor && typeof customExecutor === "object" && typeof customExecutor.exec === "function") {
      this.customExecutor = executorFromAdapter(customExecutor);
    } else if (typeof customExecutor === "function") {
      this.customExecutor = customExecutor;
    }
    this.metadata = metadata ?? loadAutoMetadata();
    if (this.metadata) {
      setAdapterMetadata({ modelToTable: this.metadata.modelToTable, modelFields: this.metadata.modelFields });
    }

    // Add default logging and telemetry event middleware
    this.$use(async (params, next) => {
      const start = Date.now();
      try {
        const result = await next(params);
        const duration = Date.now() - start;

        // Emit 'query' telemetry event
        const queryEvt: QueryEvent = {
          timestamp: new Date(),
          query: params.args?.queryText || `${params.model || "raw"}.${params.action}`,
          params: params.args,
          duration,
          model: params.model,
          action: params.action,
        };
        this.$emit("query", queryEvt);

        // Check slow query threshold
        if (this.slowQueryThresholdMs > 0 && duration >= this.slowQueryThresholdMs) {
          this.$emit("warn", {
            timestamp: new Date(),
            message: `Slow query detected: [${params.model || "raw"}.${params.action}] took ${duration}ms (threshold: ${this.slowQueryThresholdMs}ms)`,
            level: "warn",
            duration,
            query: queryEvt.query,
            params: params.args,
          });
        }

        if (process.env.DEBUG_ORM === "true") {
          logger.info(`ORM [${params.model || "raw"}.${params.action}] executed in ${duration}ms`);
        }
        return result;
      } catch (err: any) {
        const duration = Date.now() - start;
        this.$emit("error", {
          timestamp: new Date(),
          message: `ORM query failed: [${params.model || "raw"}.${params.action}] after ${duration}ms`,
          level: "error",
          duration,
          error: err,
        });
        logger.error(`ORM [${params.model || "raw"}.${params.action}] failed after ${duration}ms`, err);
        throw err;
      }
    });

    return new Proxy(this, {
      get(target, prop: string, receiver) {
        if (typeof prop === "string" && prop in target && typeof (target as any)[prop] === "function") {
          return (target as any)[prop].bind(target);
        }
        if (!(prop in target) && typeof prop === "string" && !prop.startsWith("_")) {
          let modelName = prop;
          let tableName = target.metadata.modelToTable[prop];
          if (!tableName) {
            const lowerProp = prop.toLowerCase();
            for (const [mName, tName] of Object.entries(target.metadata.modelToTable)) {
              const lowerModel = mName.toLowerCase();
              const lowerTable = (tName as string).toLowerCase();
              if (
                lowerModel === lowerProp ||
                lowerTable === lowerProp ||
                lowerModel + "s" === lowerProp ||
                lowerModel + "es" === lowerProp ||
                lowerTable + "s" === lowerProp ||
                lowerTable + "es" === lowerProp
              ) {
                modelName = mName;
                tableName = tName as string;
                break;
              }
            }
          }
          if (!tableName) {
            tableName = prop;
          }
          target[prop] = new TableClient(
            modelName,
            tableName,
            target.getExecutor(),
            receiver
          );
        }
        return target[prop];
      }
    });
  }

  $on(event: "query", listener: EventListener<QueryEvent>): void;
  $on(event: "info" | "warn" | "error", listener: EventListener<LogEvent>): void;
  $on(event: string, listener: EventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  $off(event: string, listener: EventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  $emit(event: string, payload: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          logger.error(`Error in ORM event listener for '${event}':`, err instanceof Error ? err : new Error(String(err)));
        }
      });
    }
  }

  private getExecutor(): ExecutorFn {
    return this.customExecutor || getDefaultExecutor();
  }

  table(name: string): TableClient {
    const rawTable = this.metadata.modelToTable[name] || name;
    return new TableClient(name, rawTable, this.getExecutor(), this);
  }

  view(name: string): ViewClient {
    const rawTable = this.metadata.modelToTable[name] || name;
    return new ViewClient(name, rawTable, this.getExecutor(), this);
  }

  $view(name: string): ViewClient {
    return this.view(name);
  }

  async $queryProc<T = any>(procName: string, params?: Record<string, any> | any[]): Promise<T[]> {
    const executor = this.getExecutor();
    const { sqlText, p } = buildProcCallSql(procName, params);
    return executor(sqlText, p) as Promise<T[]>;
  }

  async $executeProc(procName: string, params?: Record<string, any> | any[]): Promise<number> {
    const executor = this.getExecutor();
    const { sqlText, p } = buildProcCallSql(procName, params);
    if (executor.executeRaw) {
      return executor.executeRaw(sqlText, p);
    }
    return normalizeAffectedCount(await executor(sqlText, p));
  }

  async $queryFunction<T = any>(fnName: string, params?: Record<string, any> | any[]): Promise<T[]> {
    const executor = this.getExecutor();
    const { sqlText, p } = buildFunctionCallSql(fnName, params);
    return executor(sqlText, p) as Promise<T[]>;
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
    defaultExecutor = null;
  }

  async $queryRaw(queryParts: any, ...values: any[]): Promise<any[]> {
    const executor = this.getExecutor();
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
    const executor = this.getExecutor();
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
    const executor = this.getExecutor();
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
    if (executor.executeRaw) {
      return executor.executeRaw(queryText, params);
    }
    return normalizeAffectedCount(await executor(queryText, params));
  }

  async $executeRawUnsafe(queryText: string, ...values: any[]): Promise<number> {
    const executor = this.getExecutor();
    const params: Record<string, any> = {};
    if (values && values.length > 0) {
      values.forEach((val, idx) => {
        const paramName = `p_${idx}`;
        params[paramName] = val;
      });
    }

    const modifiedQueryText = addNoLockToQuery(queryText, this.metadata);
    if (executor.executeRaw) {
      return executor.executeRaw(modifiedQueryText, params);
    }
    return normalizeAffectedCount(await executor(modifiedQueryText, params));
  }

  async $transaction<R>(
    fn: ((tx: any) => Promise<R>) | Promise<any>[],
    options?: { timeout?: number }
  ): Promise<any> {
    if (Array.isArray(fn)) {
      return Promise.all(fn);
    }

    const executor = this.getExecutor();
    if (!executor.transaction) {
      if (this.inTransaction) {
        const txClient = new An5ORM(executor, this.metadata, true);
        return fn(txClient);
      }
      throw new Error("Transactions require an executor with transaction support");
    }
    return executor.transaction(async (txExecutor: ExecutorFn) => {
      const txClient = new An5ORM(txExecutor, this.metadata, true);
      return fn(txClient);
    }, options);
  }

  async $begin(): Promise<any> {
    if (this.inTransaction) {
      throw new Error("Interactive transactions cannot be nested");
    }
    const executor = this.getExecutor();
    if (!executor.beginTransaction) {
      throw new Error("Interactive transactions require an executor with beginTransaction support");
    }
    const tx = await executor.beginTransaction();
    return new An5ORM(tx.executor, this.metadata, true, {
      commit: tx.commit,
      rollback: tx.rollback,
    });
  }

  async $commit(): Promise<void> {
    if (!this.transactionControl) {
      throw new Error("$commit can only be called on an interactive transaction client");
    }
    const control = this.transactionControl;
    this.transactionControl = undefined;
    await control.commit();
  }

  async $rollback(): Promise<void> {
    if (!this.transactionControl) {
      throw new Error("$rollback can only be called on an interactive transaction client");
    }
    const control = this.transactionControl;
    this.transactionControl = undefined;
    await control.rollback();
  }
}

export const an5Orm = new An5ORM();
export default an5Orm;

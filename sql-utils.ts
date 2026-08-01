import type { RelationDef } from "./metadata";

/**
 * SQL Server identifier quoting.
 *
 * Wraps a bare identifier in square brackets and escapes any embedded
 * closing bracket (`]` → `]]`), which is the only character that can break
 * out of a bracketed identifier in T-SQL. This blocks SQL injection through
 * user-supplied column / alias names.
 */
export function quoteIdentifier(name: string): string {
  const s = String(name);
  return `[${s.replace(/\]/g, "]]")}]`;
}

/** Sanitizes a parameter name to a safe T-SQL identifier fragment. */
export function sanitizeParamName(name: string): string {
  const s = String(name);
  const cleaned = s.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `p_${cleaned}`;
}

/** Validates a direction token, defaulting to ASC. */
export function normalizeSortDirection(dir: unknown): "ASC" | "DESC" {
  const upper = typeof dir === "string" ? dir.toUpperCase() : "";
  return upper === "DESC" ? "DESC" : "ASC";
}

/** Coerces a value to a non-negative integer, or returns the fallback. */
export function toNonNegativeInt(value: unknown, fallback = 0): number {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface QueryContext {
  relationMap?: Record<string, Record<string, RelationDef>>;
  modelToTable?: Record<string, string>;
}

const OPERATOR_KEYS = ["in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt"];

function isOperatorValue(value: any): boolean {
  if (!value || typeof value !== "object" || value instanceof Date) return false;
  return OPERATOR_KEYS.some((op) => op in value);
}

export function buildOrderBy(orderBy: any): string {
  if (!orderBy) return "";
  const orderClauses: string[] = [];
  const orderByArr = Array.isArray(orderBy) ? orderBy : [orderBy];

  for (const orderObj of orderByArr) {
    if (orderObj && typeof orderObj === "object") {
      for (const [k, dir] of Object.entries(orderObj)) {
        orderClauses.push(`${quoteIdentifier(k)} ${normalizeSortDirection(dir)}`);
      }
    }
  }
  return orderClauses.length > 0 ? ` ORDER BY ${orderClauses.join(", ")}` : "";
}

/**
 * Recursively builds a WHERE clause from a Prisma-style filter object.
 *
 * Values are always bound as parameters (`@name`); only identifiers are
 * interpolated directly, and they are run through {@link quoteIdentifier}.
 */
export function parseWhere(
  modelName: string,
  where: any,
  params: Record<string, any>,
  prefix = "",
  ctx: QueryContext = {}
): string {
  if (!where) return "";
  const conditions: string[] = [];
  const relationMap = ctx.relationMap || {};
  const modelToTable = ctx.modelToTable || {};

  const cleanWhere: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    if (key.includes("_") && value && typeof value === "object" && !(value instanceof Date) && !isOperatorValue(value)) {
      Object.assign(cleanWhere, value);
    } else {
      cleanWhere[key] = value;
    }
  }

  for (const [key, value] of Object.entries(cleanWhere)) {
    if (key === "OR" && Array.isArray(value)) {
      const orConditions = value.map((subWhere, idx) => parseWhere(modelName, subWhere, params, `${prefix}or_${idx}_`, ctx));
      const filtered = orConditions.filter(Boolean);
      if (filtered.length > 0) {
        conditions.push(`(${filtered.join(" OR ")})`);
      }
    } else if (key === "AND" && Array.isArray(value)) {
      const andConditions = value.map((subWhere, idx) => parseWhere(modelName, subWhere, params, `${prefix}and_${idx}_`, ctx));
      const filtered = andConditions.filter(Boolean);
      if (filtered.length > 0) {
        conditions.push(`(${filtered.join(" AND ")})`);
      }
    } else {
      const modelRelations = relationMap[modelName];
      const relation = modelRelations?.[key];

      if (relation) {
        const relationTable = modelToTable[relation.modelName] || relation.modelName;
        const subParams: Record<string, any> = {};

        let subWhere: any = value;
        let op = "some";
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
          if (value.some) {
            subWhere = value.some;
            op = "some";
          } else if (value.none) {
            subWhere = value.none;
            op = "none";
          } else if (value.every) {
            subWhere = value.every;
            op = "every";
          }
        }

        const subWhereSql = parseWhere(relation.modelName, subWhere, subParams, `${prefix}${key}_`, ctx);
        Object.assign(params, subParams);

        if (subWhereSql) {
          const fk = quoteIdentifier(relation.foreignKey);
          const lk = quoteIdentifier(relation.localKey);
          if (relation.relationType === "one") {
            if (op === "none") {
              conditions.push(`${fk} NOT IN (SELECT ${lk} FROM ${relationTable} WITH (NOLOCK) WHERE ${subWhereSql})`);
            } else {
              conditions.push(`${fk} IN (SELECT ${lk} FROM ${relationTable} WITH (NOLOCK) WHERE ${subWhereSql})`);
            }
          } else {
            if (op === "none") {
              conditions.push(`${lk} NOT IN (SELECT ${fk} FROM ${relationTable} WITH (NOLOCK) WHERE ${subWhereSql})`);
            } else {
              conditions.push(`${lk} IN (SELECT ${fk} FROM ${relationTable} WITH (NOLOCK) WHERE ${subWhereSql})`);
            }
          }
        }
      } else {
        const col = quoteIdentifier(key);
        const paramName = sanitizeParamName(`${prefix}${key}`);
        if (value && typeof value === "object" && !(value instanceof Date)) {
          const ops = Object.entries(value);
          for (const [op, opVal] of ops) {
            if (op === "in" && Array.isArray(opVal)) {
              if (opVal.length === 0) {
                conditions.push("1 = 0");
              } else {
                const inParams: string[] = [];
                opVal.forEach((item, idx) => {
                  const inParamName = `${paramName}_in_${idx}`;
                  inParams.push(`@${inParamName}`);
                  params[inParamName] = item;
                });
                conditions.push(`${col} IN (${inParams.join(", ")})`);
              }
            } else if (op === "notIn" && Array.isArray(opVal)) {
              if (opVal.length === 0) {
                conditions.push("1 = 1");
              } else {
                const inParams: string[] = [];
                opVal.forEach((item, idx) => {
                  const inParamName = `${paramName}_notin_${idx}`;
                  inParams.push(`@${inParamName}`);
                  params[inParamName] = item;
                });
                conditions.push(`${col} NOT IN (${inParams.join(", ")})`);
              }
            } else if (op === "contains") {
              conditions.push(`${col} LIKE @${paramName}_contains`);
              params[`${paramName}_contains`] = `%${opVal}%`;
            } else if (op === "startsWith") {
              conditions.push(`${col} LIKE @${paramName}_startsWith`);
              params[`${paramName}_startsWith`] = `${opVal}%`;
            } else if (op === "endsWith") {
              conditions.push(`${col} LIKE @${paramName}_endsWith`);
              params[`${paramName}_endsWith`] = `%${opVal}`;
            } else if (op === "not") {
              conditions.push(`${col} <> @${paramName}_not`);
              params[`${paramName}_not`] = opVal;
            } else if (op === "gte") {
              conditions.push(`${col} >= @${paramName}_gte`);
              params[`${paramName}_gte`] = opVal;
            } else if (op === "lte") {
              conditions.push(`${col} <= @${paramName}_lte`);
              params[`${paramName}_lte`] = opVal;
            } else if (op === "gt") {
              conditions.push(`${col} > @${paramName}_gt`);
              params[`${paramName}_gt`] = opVal;
            } else if (op === "lt") {
              conditions.push(`${col} < @${paramName}_lt`);
              params[`${paramName}_lt`] = opVal;
            }
          }
        } else {
          if (value === null) {
            conditions.push(`${col} IS NULL`);
          } else {
            conditions.push(`${col} = @${paramName}`);
            params[paramName] = value;
          }
        }
      }
    }
  }

  return conditions.join(" AND ");
}

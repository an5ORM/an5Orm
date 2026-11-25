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

function unquoteBracketIdentifier(part: string): string {
  const trimmed = String(part).trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).replace(/\]\]/g, "]");
  }
  return trimmed;
}

function splitMultipartIdentifier(name: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBracket = false;
  const input = String(name).trim();

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "[") inBracket = true;
    if (ch === "]") {
      if (input[i + 1] === "]") {
        current += "]]";
        i += 1;
        continue;
      }
      inBracket = false;
    }
    if (ch === "." && !inBracket) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [input];
}

/** Quotes one-part or multipart SQL Server table identifiers safely. */
export function quoteTableIdentifier(name: string): string {
  return splitMultipartIdentifier(name)
    .map(part => quoteIdentifier(unquoteBracketIdentifier(part)))
    .join(".");
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

const OPERATOR_KEYS = ["equals", "in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt", "mode"];
const OPERATOR_KEY_SET = new Set(OPERATOR_KEYS);
const RELATION_OPERATOR_KEYS = new Set(["some", "none", "every", "is", "isNot", "is_not"]);

function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value) || value instanceof Date || value instanceof RegExp) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isOperatorValue(value: any): boolean {
  if (!isPlainObject(value)) return false;
  return OPERATOR_KEYS.some((op) => op in value);
}

function isRelationOperatorObject(value: any): boolean {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((k) => RELATION_OPERATOR_KEYS.has(k));
}

function resolveModelEntry<T>(map: Record<string, T> | undefined, modelName: string): T | undefined {
  if (!map || !modelName) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, modelName)) return map[modelName];
  const camel = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  if (Object.prototype.hasOwnProperty.call(map, camel)) return map[camel];
  const lower = modelName.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, lower)) return map[lower];
  for (const [k, v] of Object.entries(map)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
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
 * Recursively builds a WHERE clause from a structured filter object.
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
  if (where === null || where === undefined) return "";
  if (!isPlainObject(where)) {
    throw new Error("Where clause must be a plain object");
  }
  const conditions: string[] = [];
  const relationMap = ctx.relationMap || {};
  const modelToTable = ctx.modelToTable || {};
  const modelRelations = resolveModelEntry(relationMap, modelName) || {};

  const cleanWhere: Record<string, any> = {};
  for (const [key, value] of Object.entries(where)) {
    if (
      key !== "OR" &&
      key !== "AND" &&
      key !== "NOT" &&
      key.includes("_") &&
      !modelRelations[key] &&
      isPlainObject(value) &&
      !isOperatorValue(value) &&
      !isRelationOperatorObject(value)
    ) {
      const subKeys = Object.keys(value).filter((sk) => value[sk] !== undefined);
      if (subKeys.length > 0 && subKeys.every((sk) => key.includes(sk))) {
        Object.assign(cleanWhere, value);
        continue;
      }
    }
    cleanWhere[key] = value;
  }

  for (const [key, value] of Object.entries(cleanWhere)) {
    if (value === undefined) continue;
    if (key === "OR") {
      if (!Array.isArray(value)) {
        throw new Error("OR filter must be an array of filter objects");
      }
      const orConditions = value.map((subWhere, idx) => {
        if (!isPlainObject(subWhere)) {
          throw new Error("OR filter entries must be plain objects");
        }
        return parseWhere(modelName, subWhere, params, `${prefix}or_${idx}_`, ctx) || "1=1";
      });
      const filtered = orConditions.filter(Boolean);
      if (filtered.length > 0) {
        conditions.push(`(${filtered.join(" OR ")})`);
      } else {
        conditions.push("1=0");
      }
    } else if (key === "AND") {
      const andItems = Array.isArray(value) ? value : [value];
      const andConditions = andItems.map((subWhere, idx) => {
        if (!isPlainObject(subWhere)) {
          throw new Error("AND filter must be a plain object or an array of plain objects");
        }
        return parseWhere(modelName, subWhere, params, `${prefix}and_${idx}_`, ctx);
      });
      const filtered = andConditions.filter(Boolean);
      if (filtered.length > 0) {
        conditions.push(`(${filtered.join(" AND ")})`);
      }
    } else if (key === "NOT") {
      const notItems = Array.isArray(value) ? value : [value];
      const notConditions = notItems.map((subWhere, idx) => {
        if (!isPlainObject(subWhere)) {
          throw new Error("NOT filter must be a plain object or an array of plain objects");
        }
        return parseWhere(modelName, subWhere, params, `${prefix}not_${idx}_`, ctx) || "1=1";
      });
      const filtered = notConditions.filter(Boolean);
      if (filtered.length > 0) {
        conditions.push(`NOT (${filtered.join(" OR ")})`);
      }
    } else {
      const relation = modelRelations[key];

      if (relation) {
        if (!isPlainObject(value)) {
          throw new Error(`Relation filter for '${key}' on '${modelName}' must be a plain object`);
        }

        const relationTable = quoteTableIdentifier(resolveModelEntry(modelToTable, relation.modelName) || relation.modelName);
        const fk = quoteIdentifier(relation.foreignKey);
        const lk = quoteIdentifier(relation.localKey);
        const outerKey = relation.relationType === "one" ? fk : lk;
        const innerKey = relation.relationType === "one" ? lk : fk;

        if (relation.relationType === "many") {
          const opEntries = Object.entries(value).filter(([, v]) => v !== undefined);
          for (const [rawOp, opVal] of opEntries) {
            if (rawOp !== "some" && rawOp !== "none" && rawOp !== "every") {
              throw new Error(`Unsupported relation filter operator '${rawOp}' for to-many relation '${key}' on '${modelName}'`);
            }
            if (!isPlainObject(opVal)) {
              throw new Error(`Relation filter '${rawOp}' on '${key}' must be a plain object`);
            }
            const subPrefix = opEntries.length === 1 ? `${prefix}${key}_` : `${prefix}${key}_${rawOp}_`;
            const subParams: Record<string, any> = {};
            const subWhereSql = parseWhere(relation.modelName, opVal, subParams, subPrefix, ctx);
            Object.assign(params, subParams);
            if (rawOp === "every") {
              if (subWhereSql) {
                conditions.push(`${outerKey} NOT IN (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK) WHERE NOT (${subWhereSql}))`);
              } else {
                conditions.push("1 = 1");
              }
            } else {
              const relationPredicate = subWhereSql ? ` WHERE ${subWhereSql}` : "";
              const operator = rawOp === "none" ? "NOT IN" : "IN";
              conditions.push(`${outerKey} ${operator} (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK)${relationPredicate})`);
            }
          }
        } else {
          const definedEntries = Object.entries(value).filter(([, v]) => v !== undefined);
          const hasRelOps = definedEntries.some(([k]) => RELATION_OPERATOR_KEYS.has(k));
          if (hasRelOps) {
            const normalized: Record<string, any> = {};
            for (const [rawOp, opVal] of definedEntries) {
              const canonical = rawOp === "is_not" ? "isNot" : rawOp;
              if (canonical !== "is" && canonical !== "isNot") {
                throw new Error(`Unsupported relation filter operator '${rawOp}' for to-one relation '${key}' on '${modelName}'`);
              }
              if (Object.prototype.hasOwnProperty.call(normalized, canonical)) {
                throw new Error(`Duplicate relation filter operator '${rawOp}' for relation '${key}' on '${modelName}'`);
              }
              normalized[canonical] = opVal;
            }
            const opList = Object.entries(normalized);
            for (const [op, opVal] of opList) {
              const subPrefix = opList.length === 1 ? `${prefix}${key}_` : `${prefix}${key}_${op}_`;
              if (opVal === null) {
                const sqlOp = op === "is" ? "NOT IN" : "IN";
                conditions.push(`${outerKey} ${sqlOp} (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK))`);
              } else if (!isPlainObject(opVal)) {
                throw new Error(`Relation filter '${op}' on '${key}' must be a plain object or null`);
              } else {
                const subParams: Record<string, any> = {};
                const subWhereSql = parseWhere(relation.modelName, opVal, subParams, subPrefix, ctx);
                Object.assign(params, subParams);
                const relationPredicate = subWhereSql ? ` WHERE ${subWhereSql}` : "";
                const sqlOp = op === "is" ? "IN" : "NOT IN";
                conditions.push(`${outerKey} ${sqlOp} (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK)${relationPredicate})`);
              }
            }
          } else {
            const subParams: Record<string, any> = {};
            const subWhereSql = parseWhere(relation.modelName, value, subParams, `${prefix}${key}_`, ctx);
            Object.assign(params, subParams);
            const relationPredicate = subWhereSql ? ` WHERE ${subWhereSql}` : "";
            conditions.push(`${outerKey} IN (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK)${relationPredicate})`);
          }
        }
      } else {
        if (Array.isArray(value)) {
          throw new Error(`Invalid array filter value for field '${key}'; use { in: [...] } instead`);
        }

        const col = quoteIdentifier(key);
        const paramName = sanitizeParamName(`${prefix}${key}`);
        if (isPlainObject(value)) {
          const ops = Object.entries(value).filter(([, opVal]) => opVal !== undefined);
          for (const [op] of ops) {
            if (RELATION_OPERATOR_KEYS.has(op)) {
              throw new Error(`Relation filter operator '${op}' cannot be used on scalar field '${key}'`);
            }
            if (!OPERATOR_KEY_SET.has(op)) {
              throw new Error(`Unknown filter operator '${op}' on field '${key}'`);
            }
          }
          if (value.mode !== undefined && value.mode !== "default" && value.mode !== "insensitive") {
            throw new Error(`Invalid filter mode '${String(value.mode)}' on field '${key}'; expected 'default' or 'insensitive'`);
          }
          const insensitive = value.mode === "insensitive";

          for (const [op, opVal] of ops) {
            if (op === "mode") continue;
            if (op === "equals") {
              if (opVal === null) {
                conditions.push(`${col} IS NULL`);
              } else if (Array.isArray(opVal) || isPlainObject(opVal)) {
                throw new Error(`Filter operator 'equals' on field '${key}' must be a scalar value or null`);
              } else {
                const pName = `${paramName}_equals`;
                params[pName] = opVal;
                conditions.push(insensitive && typeof opVal === "string" ? `LOWER(${col}) = LOWER(@${pName})` : `${col} = @${pName}`);
              }
            } else if (op === "in") {
              if (!Array.isArray(opVal)) {
                throw new Error(`Filter operator 'in' on field '${key}' must be an array`);
              }
              if (opVal.length === 0) {
                conditions.push("1 = 0");
              } else {
                const lower = insensitive && opVal.some((item) => typeof item === "string");
                const inParams: string[] = [];
                opVal.forEach((item, idx) => {
                  const inParamName = `${paramName}_in_${idx}`;
                  params[inParamName] = item;
                  inParams.push(lower && typeof item === "string" ? `LOWER(@${inParamName})` : `@${inParamName}`);
                });
                conditions.push(`${lower ? `LOWER(${col})` : col} IN (${inParams.join(", ")})`);
              }
            } else if (op === "notIn") {
              if (!Array.isArray(opVal)) {
                throw new Error(`Filter operator 'notIn' on field '${key}' must be an array`);
              }
              if (opVal.length === 0) {
                conditions.push("1 = 1");
              } else {
                const lower = insensitive && opVal.some((item) => typeof item === "string");
                const inParams: string[] = [];
                opVal.forEach((item, idx) => {
                  const inParamName = `${paramName}_notin_${idx}`;
                  params[inParamName] = item;
                  inParams.push(lower && typeof item === "string" ? `LOWER(@${inParamName})` : `@${inParamName}`);
                });
                conditions.push(`${lower ? `LOWER(${col})` : col} NOT IN (${inParams.join(", ")})`);
              }
            } else if (op === "contains") {
              if (typeof opVal !== "string") {
                throw new Error(`Filter operator 'contains' on field '${key}' must be a string`);
              }
              const pName = `${paramName}_contains`;
              params[pName] = `%${opVal}%`;
              conditions.push(insensitive ? `LOWER(${col}) LIKE LOWER(@${pName})` : `${col} LIKE @${pName}`);
            } else if (op === "startsWith") {
              if (typeof opVal !== "string") {
                throw new Error(`Filter operator 'startsWith' on field '${key}' must be a string`);
              }
              const pName = `${paramName}_startsWith`;
              params[pName] = `${opVal}%`;
              conditions.push(insensitive ? `LOWER(${col}) LIKE LOWER(@${pName})` : `${col} LIKE @${pName}`);
            } else if (op === "endsWith") {
              if (typeof opVal !== "string") {
                throw new Error(`Filter operator 'endsWith' on field '${key}' must be a string`);
              }
              const pName = `${paramName}_endsWith`;
              params[pName] = `%${opVal}`;
              conditions.push(insensitive ? `LOWER(${col}) LIKE LOWER(@${pName})` : `${col} LIKE @${pName}`);
            } else if (op === "not") {
              if (opVal === null) {
                conditions.push(`${col} IS NOT NULL`);
              } else if (Array.isArray(opVal)) {
                throw new Error(`Filter operator 'not' on field '${key}' cannot be an array; use 'notIn' instead`);
              } else if (isPlainObject(opVal)) {
                const nestedParams: Record<string, any> = {};
                const nestedSql = parseWhere(modelName, { [key]: opVal }, nestedParams, `${prefix}${key}_not_`, ctx);
                Object.assign(params, nestedParams);
                if (nestedSql) conditions.push(`NOT (${nestedSql})`);
              } else {
                const pName = `${paramName}_not`;
                params[pName] = opVal;
                conditions.push(insensitive && typeof opVal === "string" ? `LOWER(${col}) <> LOWER(@${pName})` : `${col} <> @${pName}`);
              }
            } else if (op === "gte" || op === "lte" || op === "gt" || op === "lt") {
              if (opVal === null || Array.isArray(opVal) || isPlainObject(opVal)) {
                throw new Error(`Filter operator '${op}' on field '${key}' must be a scalar comparison value`);
              }
              const sqlOp = op === "gte" ? ">=" : op === "lte" ? "<=" : op === "gt" ? ">" : "<";
              conditions.push(`${col} ${sqlOp} @${paramName}_${op}`);
              params[`${paramName}_${op}`] = opVal;
            }
          }
        } else if (typeof value === "function" || typeof value === "symbol" || value instanceof RegExp) {
          throw new Error(`Invalid filter value for field '${key}'`);
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

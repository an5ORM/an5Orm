"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteIdentifier = quoteIdentifier;
exports.quoteTableIdentifier = quoteTableIdentifier;
exports.sanitizeParamName = sanitizeParamName;
exports.normalizeSortDirection = normalizeSortDirection;
exports.toNonNegativeInt = toNonNegativeInt;
exports.buildOrderBy = buildOrderBy;
exports.parseWhere = parseWhere;
/**
 * SQL Server identifier quoting.
 *
 * Wraps a bare identifier in square brackets and escapes any embedded
 * closing bracket (`]` → `]]`), which is the only character that can break
 * out of a bracketed identifier in T-SQL. This blocks SQL injection through
 * user-supplied column / alias names.
 */
function quoteIdentifier(name) {
    const s = String(name);
    return `[${s.replace(/\]/g, "]]")}]`;
}
function unquoteBracketIdentifier(part) {
    const trimmed = String(part).trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed.slice(1, -1).replace(/\]\]/g, "]");
    }
    return trimmed;
}
function splitMultipartIdentifier(name) {
    const parts = [];
    let current = "";
    let inBracket = false;
    const input = String(name).trim();
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (ch === "[")
            inBracket = true;
        if (ch === "]") {
            if (input[i + 1] === "]") {
                current += "]]";
                i += 1;
                continue;
            }
            inBracket = false;
        }
        if (ch === "." && !inBracket) {
            if (current.trim())
                parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim())
        parts.push(current.trim());
    return parts.length > 0 ? parts : [input];
}
/** Quotes one-part or multipart SQL Server table identifiers safely. */
function quoteTableIdentifier(name) {
    return splitMultipartIdentifier(name)
        .map(part => quoteIdentifier(unquoteBracketIdentifier(part)))
        .join(".");
}
/** Sanitizes a parameter name to a safe T-SQL identifier fragment. */
function sanitizeParamName(name) {
    const s = String(name);
    const cleaned = s.replace(/[^A-Za-z0-9_]/g, "_");
    return /^[A-Za-z]/.test(cleaned) ? cleaned : `p_${cleaned}`;
}
/** Validates a direction token, defaulting to ASC. */
function normalizeSortDirection(dir) {
    const upper = typeof dir === "string" ? dir.toUpperCase() : "";
    return upper === "DESC" ? "DESC" : "ASC";
}
/** Coerces a value to a non-negative integer, or returns the fallback. */
function toNonNegativeInt(value, fallback = 0) {
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const OPERATOR_KEYS = ["equals", "in", "notIn", "contains", "startsWith", "endsWith", "not", "gte", "lte", "gt", "lt"];
function isOperatorValue(value) {
    if (!value || typeof value !== "object" || value instanceof Date)
        return false;
    return OPERATOR_KEYS.some((op) => op in value);
}
function buildOrderBy(orderBy) {
    if (!orderBy)
        return "";
    const orderClauses = [];
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
function parseWhere(modelName, where, params, prefix = "", ctx = {}) {
    if (!where)
        return "";
    const conditions = [];
    const relationMap = ctx.relationMap || {};
    const modelToTable = ctx.modelToTable || {};
    const cleanWhere = {};
    for (const [key, value] of Object.entries(where)) {
        if (key.includes("_") && value && typeof value === "object" && !(value instanceof Date) && !isOperatorValue(value)) {
            Object.assign(cleanWhere, value);
        }
        else {
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
        }
        else if (key === "AND") {
            const andItems = Array.isArray(value) ? value : [value];
            const andConditions = andItems.map((subWhere, idx) => parseWhere(modelName, subWhere, params, `${prefix}and_${idx}_`, ctx));
            const filtered = andConditions.filter(Boolean);
            if (filtered.length > 0) {
                conditions.push(`(${filtered.join(" AND ")})`);
            }
        }
        else if (key === "NOT") {
            const notItems = Array.isArray(value) ? value : [value];
            const notConditions = notItems.map((subWhere, idx) => parseWhere(modelName, subWhere, params, `${prefix}not_${idx}_`, ctx));
            const filtered = notConditions.filter(Boolean);
            if (filtered.length > 0) {
                conditions.push(`NOT (${filtered.join(" AND ")})`);
            }
        }
        else {
            const modelRelations = relationMap[modelName];
            const relation = modelRelations?.[key];
            if (relation) {
                const relationTable = quoteTableIdentifier(modelToTable[relation.modelName] || relation.modelName);
                const subParams = {};
                let subWhere = value;
                let op = "some";
                if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
                    if (value.some) {
                        subWhere = value.some;
                        op = "some";
                    }
                    else if (value.none) {
                        subWhere = value.none;
                        op = "none";
                    }
                    else if (value.every) {
                        subWhere = value.every;
                        op = "every";
                    }
                }
                const subWhereSql = parseWhere(relation.modelName, subWhere, subParams, `${prefix}${key}_`, ctx);
                Object.assign(params, subParams);
                const fk = quoteIdentifier(relation.foreignKey);
                const lk = quoteIdentifier(relation.localKey);
                const outerKey = relation.relationType === "one" ? fk : lk;
                const innerKey = relation.relationType === "one" ? lk : fk;
                if (op === "every") {
                    if (subWhereSql) {
                        conditions.push(`${outerKey} NOT IN (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK) WHERE NOT (${subWhereSql}))`);
                    }
                    else {
                        conditions.push("1 = 1");
                    }
                }
                else {
                    const relationPredicate = subWhereSql ? ` WHERE ${subWhereSql}` : "";
                    const operator = op === "none" ? "NOT IN" : "IN";
                    conditions.push(`${outerKey} ${operator} (SELECT ${innerKey} FROM ${relationTable} WITH (NOLOCK)${relationPredicate})`);
                }
            }
            else {
                const col = quoteIdentifier(key);
                const paramName = sanitizeParamName(`${prefix}${key}`);
                if (value && typeof value === "object" && !(value instanceof Date)) {
                    const ops = Object.entries(value);
                    for (const [op, opVal] of ops) {
                        if (op === "equals") {
                            if (opVal === null) {
                                conditions.push(`${col} IS NULL`);
                            }
                            else {
                                conditions.push(`${col} = @${paramName}_equals`);
                                params[`${paramName}_equals`] = opVal;
                            }
                        }
                        else if (op === "in" && Array.isArray(opVal)) {
                            if (opVal.length === 0) {
                                conditions.push("1 = 0");
                            }
                            else {
                                const inParams = [];
                                opVal.forEach((item, idx) => {
                                    const inParamName = `${paramName}_in_${idx}`;
                                    inParams.push(`@${inParamName}`);
                                    params[inParamName] = item;
                                });
                                conditions.push(`${col} IN (${inParams.join(", ")})`);
                            }
                        }
                        else if (op === "notIn" && Array.isArray(opVal)) {
                            if (opVal.length === 0) {
                                conditions.push("1 = 1");
                            }
                            else {
                                const inParams = [];
                                opVal.forEach((item, idx) => {
                                    const inParamName = `${paramName}_notin_${idx}`;
                                    inParams.push(`@${inParamName}`);
                                    params[inParamName] = item;
                                });
                                conditions.push(`${col} NOT IN (${inParams.join(", ")})`);
                            }
                        }
                        else if (op === "contains") {
                            conditions.push(`${col} LIKE @${paramName}_contains`);
                            params[`${paramName}_contains`] = `%${opVal}%`;
                        }
                        else if (op === "startsWith") {
                            conditions.push(`${col} LIKE @${paramName}_startsWith`);
                            params[`${paramName}_startsWith`] = `${opVal}%`;
                        }
                        else if (op === "endsWith") {
                            conditions.push(`${col} LIKE @${paramName}_endsWith`);
                            params[`${paramName}_endsWith`] = `%${opVal}`;
                        }
                        else if (op === "not") {
                            if (opVal === null) {
                                conditions.push(`${col} IS NOT NULL`);
                            }
                            else if (opVal && typeof opVal === "object" && !(opVal instanceof Date) && !Array.isArray(opVal)) {
                                const nestedParams = {};
                                const nestedSql = parseWhere(modelName, { [key]: opVal }, nestedParams, `${prefix}${key}_not_`, ctx);
                                Object.assign(params, nestedParams);
                                if (nestedSql)
                                    conditions.push(`NOT (${nestedSql})`);
                            }
                            else {
                                conditions.push(`${col} <> @${paramName}_not`);
                                params[`${paramName}_not`] = opVal;
                            }
                        }
                        else if (op === "gte") {
                            conditions.push(`${col} >= @${paramName}_gte`);
                            params[`${paramName}_gte`] = opVal;
                        }
                        else if (op === "lte") {
                            conditions.push(`${col} <= @${paramName}_lte`);
                            params[`${paramName}_lte`] = opVal;
                        }
                        else if (op === "gt") {
                            conditions.push(`${col} > @${paramName}_gt`);
                            params[`${paramName}_gt`] = opVal;
                        }
                        else if (op === "lt") {
                            conditions.push(`${col} < @${paramName}_lt`);
                            params[`${paramName}_lt`] = opVal;
                        }
                    }
                }
                else {
                    if (value === null) {
                        conditions.push(`${col} IS NULL`);
                    }
                    else {
                        conditions.push(`${col} = @${paramName}`);
                        params[paramName] = value;
                    }
                }
            }
        }
    }
    return conditions.join(" AND ");
}
//# sourceMappingURL=sql-utils.js.map
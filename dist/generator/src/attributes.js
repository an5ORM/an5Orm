"use strict";
/**
 * Reading `@attribute(...)` arguments from a `.an5` field or model line.
 *
 * The schema used to be read with regexes such as `/@default\((.*)\)/`, which
 * ran to the *last* `)` on the line. A field with `@default(now())` followed by
 * `@description("...")` therefore had `now()) @description("..."` as its default
 * expression, and `db:push` emitted SQL no database accepts. The closing
 * parenthesis has to be the one that matches the opening one — parentheses nest
 * (`now()`, `uuid()`, `lower(...)`) and quoted strings may contain both.
 *
 * These helpers only read attributes; they do not validate the schema language.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAttribute = hasAttribute;
exports.attributeArgs = attributeArgs;
exports.unquote = unquote;
exports.splitSchemaLines = splitSchemaLines;
exports.stringOption = stringOption;
exports.fieldListOption = fieldListOption;
exports.parseIndexDirective = parseIndexDirective;
/** Finds a matching `)` for the `(` at `open`, ignoring parentheses inside quotes. */
function closingParenthesis(line, open) {
    let depth = 0;
    let quote = null;
    for (let index = open; index < line.length; index += 1) {
        const character = line[index];
        if (quote !== null) {
            if (character === '\\') {
                index += 1;
                continue;
            }
            if (character === quote)
                quote = null;
            continue;
        }
        // A triple-quoted string may span lines and may contain either quote, so it
        // has to be skipped as a unit before the single-quote rule below sees it.
        if (character === '"' && line[index + 1] === '"' && line[index + 2] === '"') {
            const end = line.indexOf('"""', index + 3);
            if (end < 0)
                return -1;
            index = end + 2;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === '(') {
            depth += 1;
            continue;
        }
        if (character === ')') {
            depth -= 1;
            if (depth === 0)
                return index;
        }
    }
    return -1;
}
/** Whether `line` has the attribute, with or without arguments. */
function hasAttribute(line, name) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(name)}(?![\\w])`);
    return pattern.test(line);
}
/**
 * The raw argument text of the first `name(...)` on `line`.
 *
 * Returns `undefined` when the attribute is absent, or when it is written
 * without parentheses. The returned text keeps its quotes, so callers decide
 * whether they are reading a string, a number or an expression.
 */
function attributeArgs(line, name) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(name)}\\s*\\(`, 'g');
    const match = pattern.exec(line);
    if (!match)
        return undefined;
    const open = line.indexOf('(', match.index + match[0].length - 1);
    if (open < 0)
        return undefined;
    const close = closingParenthesis(line, open);
    if (close < 0)
        return undefined;
    return line.slice(open + 1, close);
}
/** Strips one pair of surrounding double quotes, if present. */
function unquote(value) {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    // Triple quotes allow a view's SQL to be written over several lines without
    // escaping: `@@sql("""
    //   SELECT ...
    // """)`. The common indentation is removed so the generated DDL is not
    // needlessly indented, while meaningful inner indentation is kept.
    //
    // The closing `"""` ends the string, not the argument list: `)` may follow on
    // the same line or the next one, so the body is found by searching for the
    // closing quotes rather than assuming they sit at the very end.
    if (trimmed.startsWith('"""')) {
        const end = trimmed.indexOf('"""', 3);
        if (end >= 0) {
            const body = trimmed.slice(3, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
            const lines = body.split(/\r?\n/);
            const indents = lines
                .filter((line) => line.trim() !== '')
                .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
            const dedent = indents.length > 0 ? Math.min(...indents) : 0;
            return lines.map((line) => line.slice(dedent)).join('\n');
        }
    }
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
/**
 * Whether `line` holds a complete `@@sql("""…""")` directive.
 *
 * The closing `"""` and the `)` that closes the attribute need not share a line,
 * so this asks whether the argument list is balanced *and* the body it contains
 * has been closed. An incomplete directive is kept as a pending line instead of
 * being handed to the parser as if the SQL ended at the newline.
 */
function isCompleteViewDirective(line) {
    const args = attributeArgs(line, '@@sql') ?? attributeArgs(line, '@@definition');
    if (args === undefined)
        return false;
    const trimmed = args.trim();
    if (!trimmed.startsWith('"""'))
        return false;
    return trimmed.slice(3).includes('"""');
}
/**
 * Splits schema text into logical lines, keeping a triple-quoted `@@sql` body on
 * one line.
 *
 * The parsers read a schema line by line. Without this, a multi-line view body
 * would end the directive at its first newline and the rest of the `SELECT`
 * would be read as fields of the view. Newlines inside the quotes are preserved;
 * only the split points change.
 */
function splitSchemaLines(text) {
    const lines = [];
    let pending = null;
    for (const rawLine of text.split(/\r?\n/)) {
        if (pending !== null) {
            pending += `\n${rawLine}`;
            if (isCompleteViewDirective(pending)) {
                lines.push(pending);
                pending = null;
            }
            continue;
        }
        const start = /@@(?:sql|definition)\s*\(\s*"""/.exec(rawLine);
        if (start) {
            if (isCompleteViewDirective(rawLine)) {
                lines.push(rawLine);
                continue;
            }
            pending = rawLine;
            continue;
        }
        lines.push(rawLine);
    }
    if (pending !== null)
        lines.push(pending);
    return lines;
}
/**
 * Reads a named string option from an attribute argument list, e.g.
 * `map: "UQ_users_email"` in `@unique(map: "UQ_users_email")`.
 */
function stringOption(args, key) {
    if (!args)
        return undefined;
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    return pattern.exec(args)?.[1];
}
/** Reads a named field-list option, e.g. `include: [email, tenantId]`. */
function fieldListOption(args, key) {
    if (!args)
        return undefined;
    const pattern = new RegExp(`\\b${escapeRegExp(key)}\\s*:\\s*\\[([^\\]]*)\\]`);
    const value = pattern.exec(args)?.[1];
    if (value === undefined)
        return undefined;
    return value.split(',').map((field) => field.trim()).filter(Boolean);
}
/**
 * Parses the inside of `@@unique([a, b], map: "…", include: […], …)`.
 *
 * The directive is the one place a schema can carry raw SQL (`filter`,
 * `options`), so its argument list is balanced rather than cut at the first
 * `)`. A filter such as `(deletedAt IS NULL)` used to truncate the directive.
 */
function parseIndexDirective(args) {
    if (!args)
        return null;
    const fieldsMatch = args.match(/^\s*\[([\w\s,]*)\]/);
    if (!fieldsMatch)
        return null;
    const fields = (fieldsMatch[1] ?? '').split(',').map((field) => field.trim()).filter(Boolean);
    if (fields.length === 0)
        return null;
    const rest = args.slice(fieldsMatch[0].length);
    const directive = { fields };
    const name = stringOption(rest, 'map');
    if (name)
        directive.name = name;
    const includeFields = fieldListOption(rest, 'include');
    if (includeFields && includeFields.length > 0)
        directive.includeFields = includeFields;
    const filter = stringOption(rest, 'filter');
    if (filter !== undefined)
        directive.filter = filter;
    const options = stringOption(rest, 'options');
    if (options !== undefined)
        directive.options = options;
    return directive;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

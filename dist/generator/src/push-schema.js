"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSchemaFor = defaultSchemaFor;
exports.parsePushSchema = parsePushSchema;
exports.qualifiedTableName = qualifiedTableName;
/**
 * Reading `.an5` files for `db:push`.
 *
 * `SchemaParser` and `parseSchemaText` cover the generators and `db:migrate`;
 * this is the third reader, and it exists because push needs a shape of its own:
 * raw `@default` expressions rather than rendered SQL, and the schema a table
 * lands in. It is kept here rather than inline in `push.ts` so the mapping from
 * schema text to a column can be tested without a database.
 */
const field_types_1 = require("./field-types");
/**
 * The schema a model lands in when the schema file does not say: none, for every
 * provider, so the name goes wherever the connection resolves.
 *
 * The parser used to default this to `dbo` and push followed it, which failed two
 * ways: SQLite said "unknown database [dbo]", and a SQL Server login whose default
 * schema was something else had push look for `[dbo].[widgets]`, miss the table it
 * had created, and then fail with "there is already an object named ...".
 */
function defaultSchemaFor(_provider) {
    return '';
}
/**
 * `@@unique([a, b])` and `@@index([a, b])`, tolerating the trailing options
 * `@@unique([a, b], map: "UQ_x")` carries.
 *
 * Anchored on the closing bracket rather than the closing paren: requiring `)` right
 * after `]` silently dropped every mapped directive here while `db:migrate` still
 * honoured it, so a schema with a mapped unique got no unique pushed at all.
 */
const FIELD_LIST = /^@@(?:unique|index)\(\s*\[([\w\s,]+)\]/;
/**
 * Reads schema text for push, validating every field type against the provider.
 *
 * All bad types come back in `issues` rather than as an exception, so the caller
 * can print them as a group. A field whose type matches no table is only a
 * mistake once the whole schema has been read: it may be a relation to a model
 * declared further down.
 */
function parsePushSchema(text, provider) {
    const models = [];
    const issues = [];
    const modelRefs = [];
    let current = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//'))
            continue;
        const header = line.match(/^model\s+(\w+)\s*\{/);
        if (header) {
            current = {
                name: header[1],
                tableName: header[1].toLowerCase() + 's',
                schema: defaultSchemaFor(provider),
                fields: [],
                compoundUniques: [],
                indexes: [],
            };
            models.push(current);
            continue;
        }
        if (line === '}') {
            current = null;
            continue;
        }
        if (!current)
            continue;
        if (line.startsWith('@@map')) {
            const match = line.match(/@@map\("(.+)"\)/);
            if (match)
                current.tableName = match[1];
            continue;
        }
        if (line.startsWith('@@schema')) {
            // `(.*)` rather than `(.+)`, because `@@schema("")` is how a model says "no
            // schema" and has to survive as an empty string rather than being dropped as
            // no match — which is how SQLite and MySQL schemas are written.
            const match = line.match(/@@schema\("(.*)"\)/);
            if (match) {
                current.schema = match[1].trim();
                current.declaredSchema = current.schema;
            }
            continue;
        }
        if (line.startsWith('@@unique') || line.startsWith('@@index')) {
            const match = line.match(FIELD_LIST);
            if (match) {
                const fields = match[1].split(',').map((field) => field.trim()).filter(Boolean);
                if (line.startsWith('@@unique'))
                    current.compoundUniques.push(fields);
                else
                    current.indexes.push(fields);
            }
            continue;
        }
        if (line.startsWith('@@'))
            continue;
        const head = (0, field_types_1.readFieldLineHead)(line);
        if (!head)
            continue;
        if (!(0, field_types_1.resolveFieldType)(head.type, provider)) {
            modelRefs.push({ model: current.name, field: head.name, type: head.type });
            continue;
        }
        // The type is kept as written (upper-cased) because that is what the database
        // is told; which types exist is what `resolveFieldType` just checked.
        current.fields.push({
            name: head.name,
            sqlType: head.type.toUpperCase(),
            isOptional: head.isOptional,
            isId: line.includes('@id'),
            isUnique: line.includes('@unique'),
            // The expression rather than SQL: `uuid()` and `autoincrement()` are spelled
            // differently per provider, and only the dialect knows how. `@updatedAt` is
            // `now()` under another name.
            defaultExpr: line.match(/@default\((.*)\)/)?.[1]
                ?? (line.includes('@updatedAt') ? 'now()' : undefined),
        });
    }
    // A declared `dbo` on a provider without schemas would push to a database that
    // does not exist there; SQLite answers "unknown database [dbo]", which says
    // nothing about the schema file. Only an explicit declaration is worth reporting:
    // an absent one now means "whatever the connection resolves", on every provider.
    for (const model of models) {
        if (model.declaredSchema === 'dbo' && provider !== 'mssql') {
            issues.push({
                path: model.name,
                message: `schema "dbo" does not exist in ${provider}; remove the @@schema directive or set it ` +
                    'to the schema this database uses',
            });
        }
    }
    const modelNames = models.map((model) => model.name);
    for (const ref of modelRefs) {
        if (!modelNames.includes(ref.type)) {
            issues.push({
                path: `${ref.model}.${ref.field}`,
                message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, provider, modelNames),
            });
        }
    }
    return { models, issues };
}
/**
 * The table name to create, `schema.table` unless the model cleared the schema.
 *
 * An empty schema has to stay empty: `[].[widgets]` is not valid SQL, which is the
 * whole reason `@@schema("")` exists.
 */
function qualifiedTableName(model) {
    return model.schema ? `${model.schema}.${model.tableName}` : model.tableName;
}

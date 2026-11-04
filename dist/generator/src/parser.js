"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaParser = void 0;
exports.sqlTypeToTs = sqlTypeToTs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const attributes_1 = require("./attributes");
const field_types_1 = require("./field-types");
/**
 * Maps a column type of a provider to its TypeScript type.
 *
 * `provider` defaults to SQL Server so existing callers keep their behaviour;
 * the generator passes the provider derived from the connection string.
 */
function sqlTypeToTs(sqlType, provider = field_types_1.DEFAULT_PROVIDER) {
    return (0, field_types_1.resolveFieldType)(sqlType, provider)?.ts ?? 'any';
}
class SchemaParser {
    /**
     * @param schemaDir directory holding the `.an5` files
     * @param provider target database; decides which field types are valid
     */
    constructor(schemaDir, provider = field_types_1.DEFAULT_PROVIDER) {
        this.schemaDir = schemaDir;
        this.provider = provider;
        this.schemaText = '';
        this.issues = [];
        this.modelRefs = [];
        this.viewRefs = [];
        this.models = [];
    }
    async parse() {
        this.issues = [];
        this.modelRefs = [];
        this.viewRefs = [];
        this.models = [];
        this.loadSchema();
        const lines = (0, attributes_1.splitSchemaLines)(this.schemaText);
        const models = [];
        let currentModel = null;
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('//'))
                continue;
            const modelHeaderMatch = line.match(/^model\s+(\w+)\s*\{/);
            if (modelHeaderMatch) {
                const modelName = modelHeaderMatch[1];
                currentModel = {
                    name: modelName,
                    tableName: modelName.toLowerCase() + 's',
                    // SQL Server's default schema, and only SQL Server's. For SQLite or MySQL
                    // an unqualified name is what the connection resolves, and for PostgreSQL
                    // it follows `search_path` — the same rule `db:push` now uses, so the
                    // generated client and the pushed table cannot drift apart.
                    schemaName: this.provider === 'mssql' ? 'dbo' : '',
                    provider: this.provider,
                    fields: [],
                    relations: []
                };
                models.push(currentModel);
                continue;
            }
            const viewHeaderMatch = line.match(/^view\s+(\w+)\s*\{/);
            if (viewHeaderMatch) {
                const viewName = viewHeaderMatch[1];
                currentModel = {
                    name: viewName,
                    tableName: viewName.toLowerCase() + 's',
                    schemaName: this.provider === 'mssql' ? 'dbo' : '',
                    provider: this.provider,
                    fields: [],
                    relations: [],
                    isView: true,
                };
                models.push(currentModel);
                continue;
            }
            if (line === '}') {
                currentModel = null;
                continue;
            }
            if (currentModel) {
                this.parseModelLine(line, currentModel);
            }
        }
        this.models = models;
        this.resolveModelRefs();
        const missingSql = models.filter((model) => model.isView && !model.viewSql?.trim());
        if (missingSql.length > 0) {
            const names = missingSql.map((model) => `"${model.name}"`).join(', ');
            throw new Error(`View ${names} must declare @@sql("SELECT ...").`);
        }
        // Every bad type is reported at once, so one pass over the schema is enough
        // instead of re-running the generator after every line.
        if (this.issues.length > 0) {
            throw new field_types_1.FieldTypeError(this.provider, this.issues);
        }
        this.postProcessRelations(models);
        return models;
    }
    loadSchema() {
        if (fs_1.default.existsSync(this.schemaDir)) {
            const files = fs_1.default.readdirSync(this.schemaDir).filter(f => f.endsWith('.an5'));
            for (const file of files) {
                this.schemaText += fs_1.default.readFileSync(path_1.default.join(this.schemaDir, file), 'utf8') + '\n';
            }
        }
        else {
            throw new Error(`No schema directory found at ${this.schemaDir}`);
        }
    }
    parseModelLine(line, model) {
        if (line.startsWith('@@sql') || line.startsWith('@@definition')) {
            // `@@definition` is accepted as an alias: the directive names a SQL body,
            // and both spellings are unambiguous.
            const attribute = line.startsWith('@@sql') ? '@@sql' : '@@definition';
            if (model.isView) {
                const sql = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, attribute));
                if (sql !== undefined)
                    model.viewSql = sql.trim();
            }
            return;
        }
        if (line.startsWith('@@map')) {
            const mapped = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@@map'));
            if (mapped)
                model.tableName = mapped;
            return;
        }
        if (line.startsWith('@@schema')) {
            // An empty string is meaningful: `@@schema("")` says "no schema", needed
            // for databases that have no schema concept. It must not be dropped as if
            // the directive were absent.
            const declared = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@@schema'));
            if (declared !== undefined)
                model.schemaName = declared.trim();
            return;
        }
        if (line.startsWith('@@unique')) {
            // Constraints describe stored tables; a view's shape comes from its SQL.
            if (model.isView)
                return;
            const parsed = (0, attributes_1.parseIndexDirective)((0, attributes_1.attributeArgs)(line, '@@unique'));
            if (parsed) {
                model.compoundUniques = model.compoundUniques || [];
                model.compoundUniques.push(parsed.fields);
            }
            return;
        }
        if (line.startsWith('@@description')) {
            const description = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@@description'));
            if (description !== undefined)
                model.description = description;
            return;
        }
        if (line.startsWith('@@'))
            return;
        const head = (0, field_types_1.readFieldLineHead)(line);
        if (!head)
            return;
        // No table entry for this provider. This used to fall through to
        // `tsType = 'any'` (or, worse, become a relation to a model that does not
        // exist) and the client was still generated; the failure only surfaced
        // later at the database layer, in a message unrelated to the schema.
        const resolved = (0, field_types_1.resolveFieldType)(head.type, this.provider);
        if (!resolved) {
            if (model.isView) {
                // A view's fields are columns of a result set, never relations.
                this.viewRefs.push({ view: model.name, field: head.name, type: head.type });
                return;
            }
            this.modelRefs.push({ model, name: head.name, type: head.type, isArray: head.isArray, isOptional: head.isOptional, line });
            return;
        }
        const hasDefault = (0, attributes_1.hasAttribute)(line, '@default') || (0, attributes_1.hasAttribute)(line, '@updatedAt') || (0, attributes_1.hasAttribute)(line, '@id');
        const isId = (0, attributes_1.hasAttribute)(line, '@id');
        const description = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(line, '@description'));
        model.fields.push({ name: head.name, type: resolved.ts, sqlType: head.type, isOptional: head.isOptional, hasDefault, isId, ...(description !== undefined ? { description } : {}) });
    }
    /**
     * Settles the fields that matched no type: a name matching a model in the
     * schema is a relation, anything else is a bad type — reported with the
     * provider name and a suggestion.
     *
     * The decision has to wait for the whole schema, because a relation may point
     * at a model declared later. Every upper-case token used to count as a
     * relation, so `INTEGER` written for SQL Server became a relation to a model
     * named `INTEGER` and nothing ever complained.
     */
    resolveModelRefs() {
        const modelNames = this.models.map((model) => model.name);
        const tableNames = this.models.filter((model) => !model.isView).map((model) => model.name);
        const viewNames = new Set(this.models.filter((model) => model.isView).map((model) => model.name));
        for (const ref of this.viewRefs) {
            this.issues.push({
                path: `${ref.view}.${ref.field}`,
                message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, this.provider, modelNames),
            });
        }
        this.viewRefs = [];
        for (const ref of this.modelRefs) {
            if (viewNames.has(ref.type)) {
                // A relation carries a foreign key and generated write inputs. A view has
                // neither, and an `include` of it would have no CreateInput to reference.
                this.issues.push({
                    path: `${ref.model.name}.${ref.name}`,
                    message: `"${ref.type}" is a view and cannot be the target of a relation; select from it directly instead`,
                });
                continue;
            }
            if (!tableNames.includes(ref.type)) {
                this.issues.push({
                    path: `${ref.model.name}.${ref.name}`,
                    message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, this.provider, tableNames),
                });
                continue;
            }
            let foreignKey = '', localKey = '', relationName = '';
            const relationArgs = (0, attributes_1.attributeArgs)(ref.line, '@relation');
            if (relationArgs) {
                // `@relation("name", fields: [userId], references: [id])`; the name is
                // either positional or spelled `name:`.
                relationName = relationArgs.match(/^\s*(?:\w+\s*:\s*)?"([^"]+)"/)?.[1] ?? '';
                foreignKey = (relationArgs.match(/\bfields\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').split(',')[0]?.trim() ?? '';
                localKey = (relationArgs.match(/\breferences\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').split(',')[0]?.trim() ?? '';
            }
            const description = (0, attributes_1.unquote)((0, attributes_1.attributeArgs)(ref.line, '@description'));
            ref.model.relations.push({
                name: ref.name,
                type: ref.type,
                isArray: ref.isArray,
                isOptional: ref.isOptional,
                foreignKey,
                localKey,
                relationName,
                ...(description ? { description } : {}),
            });
        }
        this.modelRefs = [];
    }
    postProcessRelations(models) {
        for (const model of models) {
            for (const rel of model.relations) {
                if (!rel.foreignKey || !rel.localKey) {
                    const targetModel = models.find(m => m.name === rel.type);
                    if (targetModel) {
                        let opposite = rel.relationName ?
                            targetModel.relations.find(r => r.type === model.name && r.relationName === rel.relationName && r.foreignKey && r.localKey) :
                            targetModel.relations.find(r => r.type === model.name && r.foreignKey && r.localKey);
                        if (opposite) {
                            rel.foreignKey = opposite.foreignKey;
                            rel.localKey = opposite.localKey;
                        }
                    }
                }
            }
        }
    }
}
exports.SchemaParser = SchemaParser;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaParser = void 0;
exports.sqlTypeToTs = sqlTypeToTs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
        this.models = [];
    }
    async parse() {
        this.issues = [];
        this.modelRefs = [];
        this.models = [];
        this.loadSchema();
        const lines = this.schemaText.split('\n');
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
                    schemaName: 'dbo',
                    fields: [],
                    relations: []
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
        if (line.startsWith('@@map')) {
            const mapMatch = line.match(/@@map\("(.+)"\)/);
            if (mapMatch)
                model.tableName = mapMatch[1];
            return;
        }
        if (line.startsWith('@@schema')) {
            // `(.*)` rather than `(.+)`: `@@schema("")` is how a model says "no
            // schema", needed for databases that have no schema concept. With `(.+)`
            // the empty string does not match, the directive is silently ignored and
            // the model keeps `dbo`.
            const schemaMatch = line.match(/@@schema\("(.*)"\)/);
            if (schemaMatch)
                model.schemaName = schemaMatch[1].trim();
            return;
        }
        if (line.startsWith('@@unique')) {
            const uniqueMatch = line.match(/@@unique\(\[([\w,\s]+)\]\)/);
            if (uniqueMatch) {
                const fields = uniqueMatch[1].split(',').map(f => f.trim());
                model.compoundUniques = model.compoundUniques || [];
                model.compoundUniques.push(fields);
            }
            return;
        }
        if (line.startsWith('@@description')) {
            const descMatch = line.match(/@@description\("(.+)"\)/);
            if (descMatch)
                model.description = descMatch[1];
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
            this.modelRefs.push({ model, name: head.name, type: head.type, isArray: head.isArray, isOptional: head.isOptional, line });
            return;
        }
        const hasDefault = line.includes('@default') || line.includes('@updatedAt') || line.includes('@id');
        const isId = line.includes('@id');
        let description;
        const descMatch = line.match(/@description\("(.+)"\)/);
        if (descMatch)
            description = descMatch[1];
        model.fields.push({ name: head.name, type: resolved.ts, sqlType: head.type, isOptional: head.isOptional, hasDefault, isId, description });
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
        for (const ref of this.modelRefs) {
            if (!modelNames.includes(ref.type)) {
                this.issues.push({
                    path: `${ref.model.name}.${ref.name}`,
                    message: (0, field_types_1.unknownFieldTypeMessage)(ref.type, this.provider, modelNames),
                });
                continue;
            }
            let foreignKey = '', localKey = '', relationName = '';
            const nameMatch = ref.line.match(/@relation\("(\w+)"/);
            if (nameMatch)
                relationName = nameMatch[1];
            const relationMatch = ref.line.match(/@relation\((?:.*fields:\s*\[(\w+)\],)?\s*(?:.*references:\s*\[(\w+)\],?)?.*\)/);
            if (relationMatch) {
                foreignKey = relationMatch[1] || '';
                localKey = relationMatch[2] || '';
            }
            const description = ref.line.match(/@description\("(.+)"\)/)?.[1];
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

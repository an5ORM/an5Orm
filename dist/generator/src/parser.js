"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaParser = void 0;
exports.sqlTypeToTs = sqlTypeToTs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// SQL Server type → TypeScript type mapping
const AN5_TO_TS = {
    // String types
    'NVARCHAR': 'string',
    'VARCHAR': 'string',
    'CHAR': 'string',
    'NCHAR': 'string',
    'TEXT': 'string',
    'NTEXT': 'string',
    'XML': 'string',
    // Numeric types
    'INT': 'number',
    'SMALLINT': 'number',
    'TINYINT': 'number',
    'BIGINT': 'number | bigint',
    'FLOAT': 'number',
    'REAL': 'number',
    'DECIMAL': 'number',
    'NUMERIC': 'number',
    'MONEY': 'number',
    'SMALLMONEY': 'number',
    // Boolean
    'BIT': 'boolean',
    // Date types
    'DATETIME': 'Date',
    'DATETIME2': 'Date',
    'SMALLDATETIME': 'Date',
    'DATE': 'Date',
    'TIME': 'Date',
    'DATETIMEOFFSET': 'Date',
    // Binary types
    'VARBINARY': 'Buffer',
    'BINARY': 'Buffer',
    'IMAGE': 'Buffer',
    // Other
    'UNIQUEIDENTIFIER': 'string',
    'SQL_VARIANT': 'any',
    'ROWVERSION': 'Buffer',
    'HIERARCHYID': 'string',
    'GEOGRAPHY': 'string',
    'GEOMETRY': 'string',
    'VECTOR': 'number[] | string',
};
// Parse base type from "NVARCHAR(255)" → "NVARCHAR"
function parseSqlType(raw) {
    const match = raw.match(/^(\w+)(?:\((.+)\))?$/);
    if (!match)
        return { base: raw, params: '' };
    return { base: match[1].toUpperCase(), params: match[2] || '' };
}
// Map SQL Server type to TypeScript type
function sqlTypeToTs(sqlType) {
    const { base } = parseSqlType(sqlType);
    return AN5_TO_TS[base] || 'any';
}
class SchemaParser {
    constructor(schemaDir) {
        this.schemaDir = schemaDir;
        this.schemaText = '';
    }
    async parse() {
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
            const schemaMatch = line.match(/@@schema\("(.+)"\)/);
            if (schemaMatch)
                model.schemaName = schemaMatch[1];
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
        const parts = line.split(/\s+/);
        const fieldName = parts[0];
        let fieldType = parts[1];
        if (!fieldName || !fieldType)
            return;
        const isArray = fieldType.endsWith('[]');
        const isOptional = fieldType.endsWith('?');
        const cleanType = fieldType.replace('[]', '').replace('?', '');
        // Parse SQL Server type (e.g., "NVARCHAR(255)" → base="NVARCHAR")
        const { base: sqlBase } = parseSqlType(cleanType);
        let tsType = 'any';
        let isRelation = false;
        // Check if it's a known SQL Server type
        if (AN5_TO_TS[sqlBase]) {
            tsType = sqlTypeToTs(cleanType);
        }
        else if (cleanType[0] === cleanType[0].toUpperCase() && !cleanType.includes('(')) {
            // Uppercase without parens = likely a relation to another model
            tsType = cleanType;
            isRelation = true;
        }
        if (isRelation) {
            let foreignKey = '', localKey = '', relationName = '';
            const nameMatch = line.match(/@relation\("(\w+)"/);
            if (nameMatch)
                relationName = nameMatch[1];
            const relationMatch = line.match(/@relation\((?:.*fields:\s*\[(\w+)\],)?\s*(?:.*references:\s*\[(\w+)\],?)?.*\)/);
            if (relationMatch) {
                foreignKey = relationMatch[1] || '';
                localKey = relationMatch[2] || '';
            }
            model.relations.push({ name: fieldName, type: tsType, isArray, isOptional, foreignKey, localKey, relationName });
        }
        else {
            const hasDefault = line.includes('@default') || line.includes('@updatedAt') || line.includes('@id');
            const isId = line.includes('@id');
            let description;
            const descMatch = line.match(/@description\("(.+)"\)/);
            if (descMatch)
                description = descMatch[1];
            model.fields.push({ name: fieldName, type: tsType, sqlType: cleanType, isOptional, hasDefault, isId, description });
        }
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

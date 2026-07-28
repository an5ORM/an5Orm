"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonGenerator = void 0;
const fs_1 = __importDefault(require("fs"));
class PythonGenerator {
    constructor(outputPath) {
        this.outputPath = outputPath;
    }
    generate(models) {
        let pyContent = '# This file is auto-generated. Do not edit directly.\n\n';
        // 1. MODEL_TO_TABLE
        pyContent += 'MODEL_TO_TABLE = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            const fullTableName = `[${model.schemaName}].[${model.tableName}]`;
            for (const prop of props) {
                pyContent += `    "${prop}": "${fullTableName}",\n`;
            }
        }
        pyContent += '}\n\n';
        // 2. MODEL_FIELDS
        pyContent += 'MODEL_FIELDS = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            const fieldsStr = `{ ${model.fields.map(f => `"${f.name}": "${f.type}${f.isOptional ? '?' : ''}"`).join(', ')} }`;
            for (const prop of props) {
                pyContent += `    "${prop}": ${fieldsStr},\n`;
            }
        }
        pyContent += '}\n\n';
        // 3. RELATION_MAP
        pyContent += 'RELATION_MAP = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            let relationsContent = `{\n`;
            for (const rel of model.relations) {
                relationsContent += `        "${rel.name}": {\n`;
                relationsContent += `            "modelName": "${this.toCamelCase(rel.type)}",\n`;
                relationsContent += `            "relationType": "${rel.isArray ? 'many' : 'one'}",\n`;
                relationsContent += `            "foreignKey": "${rel.foreignKey || 'id'}",\n`;
                relationsContent += `            "localKey": "${rel.localKey || 'id'}"\n`;
                relationsContent += `        },\n`;
            }
            relationsContent += `    }`;
            for (const prop of props) {
                pyContent += `    "${prop}": ${relationsContent},\n`;
            }
        }
        pyContent += '}\n';
        fs_1.default.writeFileSync(this.outputPath, pyContent);
    }
    getAllPropertyVariations(modelName) {
        const variations = new Set();
        // 1. camelCase (User -> user, McpServer -> mcpServer)
        variations.add(this.toCamelCase(modelName));
        // 2. snake_case (User -> user, McpServer -> mcp_server)
        variations.add(this.toSnakeCase(modelName));
        const acronyms = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];
        for (const acronym of acronyms) {
            if (modelName.startsWith(acronym)) {
                variations.add(acronym.toLowerCase() + modelName.slice(acronym.length));
                variations.add(acronym[0].toLowerCase() + acronym.slice(1) + modelName.slice(acronym.length));
                variations.add(this.toSnakeCase(acronym.toLowerCase() + modelName.slice(acronym.length)));
            }
        }
        return Array.from(variations);
    }
    toCamelCase(str) {
        if (!str)
            return '';
        return str[0].toLowerCase() + str.slice(1);
    }
    toSnakeCase(str) {
        if (!str)
            return '';
        return str
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
            .replace(/([a-z\d])([A-Z])/g, '$1_$2')
            .toLowerCase();
    }
}
exports.PythonGenerator = PythonGenerator;

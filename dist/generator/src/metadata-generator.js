"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetadataGenerator = void 0;
const fs_1 = __importDefault(require("fs"));
class MetadataGenerator {
    constructor(outputPath) {
        this.outputPath = outputPath;
    }
    generate(models) {
        let metaContent = '// This file is auto-generated. Do not edit directly.\n\n';
        metaContent += 'export const modelToTable: Record<string, string> = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            const fullTableName = `[${model.schemaName}].[${model.tableName}]`;
            for (const prop of props) {
                metaContent += `  ${prop}: "${fullTableName}",\n`;
            }
        }
        metaContent += '};\n\n';
        metaContent += 'export const modelDescriptions: Record<string, string | undefined> = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            for (const prop of props) {
                metaContent += `  ${prop}: ${model.description ? JSON.stringify(model.description) : 'undefined'},\n`;
            }
        }
        metaContent += '};\n\n';
        metaContent += 'export const modelFields: Record<string, Record<string, { ts: string; sql: string; description?: string }>> = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            const fieldsStr = `{ ${model.fields.map(f => `${f.name}: ${this.formatFieldMetadata(f)}`).join(', ')} }`;
            for (const prop of props) {
                metaContent += `  ${prop}: ${fieldsStr},\n`;
            }
        }
        metaContent += '};\n\n';
        metaContent += 'export interface RelationDef {\n  modelName: string;\n  relationType: "many" | "one";\n  foreignKey: string;\n  localKey: string;\n}\n\n';
        metaContent += 'export const relationMap: Record<string, Record<string, RelationDef>> = {\n';
        for (const model of models) {
            const props = this.getAllPropertyVariations(model.name);
            let relationsContent = `  {\n`;
            for (const rel of model.relations) {
                relationsContent += `    ${rel.name}: { modelName: "${this.toCamelCase(rel.type)}", relationType: "${rel.isArray ? 'many' : 'one'}", foreignKey: "${rel.foreignKey || 'id'}", localKey: "${rel.localKey || 'id'}" },\n`;
            }
            relationsContent += `  }`;
            for (const prop of props) {
                metaContent += `  ${prop}: ${relationsContent},\n`;
            }
        }
        metaContent += '};\n';
        fs_1.default.writeFileSync(this.outputPath, metaContent);
    }
    getAllPropertyVariations(modelName) {
        const variations = new Set();
        // 1. Standard camelCase (e.g. User -> user, McpServer -> mcpServer)
        variations.add(this.toCamelCase(modelName));
        // 2. Handle known acronyms at start (e.g. LLMProvider -> lLMProvider)
        // This is already handled by toCamelCase if it only lowercases the first letter.
        // But we might want 'llmProvider' as well.
        const acronyms = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];
        for (const acronym of acronyms) {
            if (modelName.startsWith(acronym)) {
                // e.g. LLMProvider -> llmProvider
                variations.add(acronym.toLowerCase() + modelName.slice(acronym.length));
                // e.g. LLMProvider -> lLMProvider (Prisma style)
                variations.add(acronym[0].toLowerCase() + acronym.slice(1) + modelName.slice(acronym.length));
            }
        }
        return Array.from(variations);
    }
    formatFieldMetadata(field) {
        const entries = [
            `ts: ${JSON.stringify(`${field.type}${field.isOptional ? '?' : ''}`)}`,
            `sql: ${JSON.stringify(field.sqlType)}`,
        ];
        if (field.description) {
            entries.push(`description: ${JSON.stringify(field.description)}`);
        }
        return `{ ${entries.join(', ')} }`;
    }
    toCamelCase(str) {
        if (!str)
            return '';
        return str[0].toLowerCase() + str.slice(1);
    }
}
exports.MetadataGenerator = MetadataGenerator;

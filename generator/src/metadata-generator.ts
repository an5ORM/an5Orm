import fs from 'fs';
import path from 'path';
import { Model } from './types';

export class MetadataGenerator {
  constructor(private outputPath: string) {}

  public generate(models: Model[]) {
    let metaContent = '// This file is auto-generated. Do not edit directly.\n\n';
    metaContent += 'import type { RelationDef } from "@an5/orm";\n\n';

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

    fs.writeFileSync(this.outputPath, metaContent);
  }

  private getAllPropertyVariations(modelName: string): string[] {
    const variations = new Set<string>();
    
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

  private formatFieldMetadata(field: Model['fields'][number]): string {
    const entries = [
      `ts: ${JSON.stringify(`${field.type}${field.isOptional ? '?' : ''}`)}`,
      `sql: ${JSON.stringify(field.sqlType)}`,
    ];
    if (field.description) {
      entries.push(`description: ${JSON.stringify(field.description)}`);
    }
    return `{ ${entries.join(', ')} }`;
  }

  private toCamelCase(str: string): string {
    if (!str) return '';
    return str[0].toLowerCase() + str.slice(1);
  }
}

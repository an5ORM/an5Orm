import fs from 'fs';
import path from 'path';
import { Model } from './types';

export class MetadataGenerator {
  constructor(
    private outputPath: string,
    private relationImport: string = 'import type { RelationDef } from "@an5/orm";'
  ) {}

  public generate(models: Model[]) {
    let metaContent = '// This file is auto-generated. Do not edit directly.\n\n';
    metaContent += `${this.relationImport}\n\n`;

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

    // 1. PascalCase (User)
    variations.add(modelName);

    // 2. camelCase (user)
    variations.add(this.toCamelCase(modelName));

    // 3. Plural PascalCase (Users)
    variations.add(modelName + 's');

    // 4. Plural camelCase (users)
    variations.add(this.toCamelCase(modelName) + 's');

    // 5. snake_case (user, mc_server)
    variations.add(this.toSnakeCase(modelName));
    variations.add(this.toSnakeCase(modelName) + 's');

    const acronyms = ['LLM', 'AI', 'MCP', 'IT', 'QC', 'HR', 'MR', 'WH', 'SSIS', 'API', 'URL', 'ID', 'JSON'];
    for (const acronym of acronyms) {
      if (modelName.startsWith(acronym)) {
        variations.add(acronym.toLowerCase() + modelName.slice(acronym.length));
        variations.add(acronym[0].toLowerCase() + acronym.slice(1) + modelName.slice(acronym.length));
        variations.add(acronym.toLowerCase() + modelName.slice(acronym.length) + 's');
      }
    }

    return Array.from(variations);
  }

  private toSnakeCase(str: string): string {
    if (!str) return '';
    return str
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .toLowerCase();
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

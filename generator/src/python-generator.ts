import fs from 'fs';
import path from 'path';
import { Model } from './types';

export class PythonGenerator {
  constructor(private outputPath: string) {}

  public generate(models: Model[]) {
    const outputDir = path.dirname(this.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. Generate an5_metadata.py
    this.generateMetadata(models);

    // 2. Generate an5_models.py
    this.generateModels(models, outputDir);

    // 3. Generate an5_orm_types.py - type-safe ORM filter/args dataclasses
    this.generateOrmTypes(models, outputDir);

    // 4. Generate an5_client.py
    this.generateClient(models, outputDir);

    // 5. Generate __init__.py
    this.generateInit(models, outputDir);
  }

  private getPyFilterType(fieldType: string): string {
    const lower = fieldType.toLowerCase();
    if (['datetime', 'datetime2', 'date', 'smalldatetime', 'datetimeoffset', 'timestamp'].includes(lower)) return 'DateTimeFilter';
    if (['bool', 'boolean', 'bit'].includes(lower)) return 'BoolFilter';
    if (['int', 'integer', 'smallint', 'tinyint', 'bigint', 'number'].includes(lower)) return 'IntFilter';
    if (['float', 'real', 'double', 'decimal', 'numeric', 'money'].includes(lower)) return 'NumberFilter';
    return 'StringFilter';
  }

  private generateOrmTypes(models: Model[], outputDir: string) {
    let content = '# This file is auto-generated. Do not edit directly.\n';
    content += '"""\nAN5 ORM typed filter/args dataclasses for type-safe queries.\n\nUsage example::\n\n    db.user.find_many(where=UserWhereInput(name=StringFilter(contains="John")),\n                      order_by=UserOrderByInput(created_at="desc"),\n                      take=10)\n"""\n';
    content += 'from __future__ import annotations\n';
    content += 'from dataclasses import dataclass, field\n';
    content += 'from typing import List, Optional, Any\n';
    content += 'from datetime import datetime\n\n';

    // Base filter types
    content += '# ─── Base filter types ────────────────────────────────────────────────────────\n\n';
    content += `@dataclass\nclass StringFilter:\n    """Type-safe filter for string fields."""\n    equals: Optional[str] = None\n    not_: Optional[str] = None\n    contains: Optional[str] = None\n    starts_with: Optional[str] = None\n    ends_with: Optional[str] = None\n    in_: Optional[List[str]] = None\n    not_in: Optional[List[str]] = None\n    gt: Optional[str] = None\n    gte: Optional[str] = None\n    lt: Optional[str] = None\n    lte: Optional[str] = None\n\n`;

    content += `@dataclass\nclass IntFilter:\n    """Type-safe filter for integer fields."""\n    equals: Optional[int] = None\n    not_: Optional[int] = None\n    in_: Optional[List[int]] = None\n    not_in: Optional[List[int]] = None\n    gt: Optional[int] = None\n    gte: Optional[int] = None\n    lt: Optional[int] = None\n    lte: Optional[int] = None\n\n`;

    content += `@dataclass\nclass NumberFilter:\n    """Type-safe filter for float/decimal fields."""\n    equals: Optional[float] = None\n    not_: Optional[float] = None\n    in_: Optional[List[float]] = None\n    not_in: Optional[List[float]] = None\n    gt: Optional[float] = None\n    gte: Optional[float] = None\n    lt: Optional[float] = None\n    lte: Optional[float] = None\n\n`;

    content += `@dataclass\nclass BoolFilter:\n    """Type-safe filter for boolean fields."""\n    equals: Optional[bool] = None\n\n`;

    content += `@dataclass\nclass DateTimeFilter:\n    """Type-safe filter for datetime fields."""\n    equals: Optional[datetime] = None\n    not_: Optional[datetime] = None\n    in_: Optional[List[datetime]] = None\n    not_in: Optional[List[datetime]] = None\n    gt: Optional[datetime] = None\n    gte: Optional[datetime] = None\n    lt: Optional[datetime] = None\n    lte: Optional[datetime] = None\n\n`;

    // Per-model types
    for (const model of models) {
      const name = this.capitalize(model.name);
      content += `# ─── ${name} ORM Types ────────────────────────────────────────────────────────\n\n`;

      // WhereInput
      content += `@dataclass\nclass ${name}WhereInput:\n    """Type-safe WHERE filter for ${name} queries."""\n`;
      content += `    AND: Optional[List['${name}WhereInput']] = None\n`;
      content += `    OR: Optional[List['${name}WhereInput']] = None\n`;
      content += `    NOT: Optional['${name}WhereInput'] = None\n`;
      for (const f of model.fields) {
        const ft = this.getPyFilterType(f.type);
        content += `    ${this.toSnakeCase(f.name)}: Optional[${ft}] = None\n`;
      }
      content += '\n';

      // OrderByInput
      content += `@dataclass\nclass ${name}OrderByInput:\n    """Type-safe ORDER BY for ${name} queries. Value: 'asc' or 'desc'."""\n`;
      for (const f of model.fields) {
        content += `    ${this.toSnakeCase(f.name)}: Optional[str] = None\n`;
      }
      content += '\n';

      // CreateInput
      const requiredFields = model.fields.filter(f => !f.isId && !f.isOptional && !f.hasDefault);
      const optionalFields = model.fields.filter(f => !f.isId && (f.isOptional || f.hasDefault));
      content += `@dataclass\nclass ${name}CreateInput:\n    """Typed data for creating a new ${name} record."""\n`;
      for (const f of requiredFields) {
        content += `    ${this.toSnakeCase(f.name)}: ${this.mapPyType(f.type)}\n`;
      }
      for (const f of optionalFields) {
        content += `    ${this.toSnakeCase(f.name)}: Optional[${this.mapPyType(f.type)}] = None\n`;
      }
      if (requiredFields.length === 0 && optionalFields.length === 0) content += '    pass\n';
      content += '\n';

      // UpdateInput
      const updateFields = model.fields.filter(f => !f.isId);
      content += `@dataclass\nclass ${name}UpdateInput:\n    """Typed data for updating an existing ${name} record."""\n`;
      for (const f of updateFields) {
        content += `    ${this.toSnakeCase(f.name)}: Optional[${this.mapPyType(f.type)}] = None\n`;
      }
      if (updateFields.length === 0) content += '    pass\n';
      content += '\n';

      // FindManyArgs
      content += `@dataclass\nclass ${name}FindManyArgs:\n    """ORM-style args for ${name}.find_many()."""\n`;
      content += `    where: Optional[${name}WhereInput] = None\n`;
      content += `    order_by: Optional[${name}OrderByInput] = None\n`;
      content += `    take: Optional[int] = None\n`;
      content += `    skip: int = 0\n`;
      content += `    select: Optional[List[str]] = None\n\n`;

      // FindFirstArgs
      content += `@dataclass\nclass ${name}FindFirstArgs:\n    """ORM-style args for ${name}.find_first()."""\n`;
      content += `    where: Optional[${name}WhereInput] = None\n`;
      content += `    order_by: Optional[${name}OrderByInput] = None\n`;
      content += `    select: Optional[List[str]] = None\n\n`;
    }

    fs.writeFileSync(path.join(outputDir, 'an5_orm_types.py'), content);
  }

  private generateMetadata(models: Model[]) {
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

    // 2. MODEL_DESCRIPTIONS
    pyContent += 'MODEL_DESCRIPTIONS = {\n';
    for (const model of models) {
      const props = this.getAllPropertyVariations(model.name);
      for (const prop of props) {
        pyContent += `    "${prop}": ${this.pyString(model.description)},\n`;
      }
    }
    pyContent += '}\n\n';

    // 3. MODEL_FIELDS
    pyContent += 'MODEL_FIELDS = {\n';
    for (const model of models) {
      const props = this.getAllPropertyVariations(model.name);
      const fieldsStr = this.formatFields(model);
      for (const prop of props) {
        pyContent += `    "${prop}": ${fieldsStr},\n`;
      }
    }
    pyContent += '}\n\n';

    // 4. RELATION_MAP
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

    fs.writeFileSync(this.outputPath, pyContent);
  }

  private mapPyType(fieldType: string): string {
    const lower = fieldType.toLowerCase();
    if (['int', 'integer', 'smallint', 'tinyint', 'bigint', 'number'].includes(lower)) {
      return 'int';
    }
    if (['float', 'real', 'double', 'decimal', 'numeric', 'money'].includes(lower)) {
      return 'float';
    }
    if (['bool', 'boolean', 'bit'].includes(lower)) {
      return 'bool';
    }
    if (['datetime', 'datetime2', 'date', 'smalldatetime', 'datetimeoffset', 'timestamp'].includes(lower)) {
      return 'datetime';
    }
    if (['bytes', 'binary', 'varbinary'].includes(lower)) {
      return 'bytes';
    }
    return 'str';
  }

  private generateModels(models: Model[], outputDir: string) {
    let content = '# This file is auto-generated. Do not edit directly.\n';
    content += 'from dataclasses import dataclass, field\n';
    content += 'from typing import Optional, List, Any\n';
    content += 'from datetime import datetime\n\n';

    for (const model of models) {
      if (model.description) {
        content += `"""${model.description}"""\n`;
      }
      content += `@dataclass\nclass ${model.name}:\n`;

      if (model.fields.length === 0 && model.relations.length === 0) {
        content += '    pass\n\n';
        continue;
      }

      // Required fields first
      const required = model.fields.filter(f => !f.isOptional && !f.hasDefault);
      const optionals = model.fields.filter(f => f.isOptional || f.hasDefault);

      for (const f of required) {
        const pyType = this.mapPyType(f.type);
        const snakeName = this.toSnakeCase(f.name);
        content += `    ${snakeName}: ${pyType}\n`;
      }

      for (const f of optionals) {
        const pyType = this.mapPyType(f.type);
        const snakeName = this.toSnakeCase(f.name);
        content += `    ${snakeName}: Optional[${pyType}] = None\n`;
      }

      // Relations
      for (const rel of model.relations) {
        const relName = this.toSnakeCase(rel.name);
        if (rel.isArray) {
          content += `    ${relName}: List[Any] = field(default_factory=list)\n`;
        } else {
          content += `    ${relName}: Optional[Any] = None\n`;
        }
      }

      content += '\n';
    }

    fs.writeFileSync(path.join(outputDir, 'an5_models.py'), content);
  }

  private generateClient(models: Model[], outputDir: string) {
    let content = '# This file is auto-generated. Do not edit directly.\n';
    content += 'import os\n';
    content += 'from typing import Dict, List, Optional, Any, Callable\n\n';

    content += 'try:\n';
    content += '    from an5_adapter import An5Adapter, AdapterTableClient, create_an5_adapter, set_adapter_metadata\n';
    content += 'except ImportError:\n';
    content += '    from .an5_adapter import An5Adapter, AdapterTableClient, create_an5_adapter, set_adapter_metadata\n\n';

    content += 'try:\n';
    content += '    from .an5_metadata import MODEL_TO_TABLE, MODEL_FIELDS\n';
    content += 'except ImportError:\n';
    content += '    from an5_metadata import MODEL_TO_TABLE, MODEL_FIELDS\n\n';

    content += 'class An5Client:\n';
    content += '    """AN5 Python ORM Client - type-safe database access.\n\n';
    content += '    Usage:\n';
    content += '        db = An5Client()\n';
    content += '        users = db.user.find_many(where={"name": {"contains": "John"}}, order_by={"created_at": "asc"}, take=10)\n';
    content += '        user  = db.user.find_first(where={"id": "abc"})\n';
    content += '        new   = db.user.create(data={"name": "Alice", "email": "alice@example.com"})\n';
    content += '    """\n';
    content += '    def __init__(self, connection_string: Optional[str] = None):\n';
    content += '        conn_str = (connection_string or \n';
    content += '                    os.getenv("DATABASE_URL") or \n';
    content += '                    "Server=localhost;Database=master;Trusted_Connection=True;TrustServerCertificate=True;")\n';
    content += '        set_adapter_metadata({"model_to_table": MODEL_TO_TABLE, "model_fields": MODEL_FIELDS})\n';
    content += '        self.adapter: An5Adapter = create_an5_adapter(conn_str)\n\n';

    for (const model of models) {
      const propName = this.toSnakeCase(model.name) + 's';
      const singleName = this.toSnakeCase(model.name);
      content += `        client = AdapterTableClient(self.adapter, "${model.name}")\n`;
      content += `        self.${model.name}: AdapterTableClient = client\n`;
      content += `        self.${model.name}s: AdapterTableClient = client\n`;
      content += `        self.${singleName}: AdapterTableClient = client\n`;
      content += `        self.${propName}: AdapterTableClient = client\n`;
    }

    content += '\n';
    content += '    def __getattr__(self, name: str) -> AdapterTableClient:\n';
    content += '        return self.adapter.table(name)\n\n';
    content += '    def query_raw(self, sql: str, *params) -> List[Dict]:\n';
    content += '        return self.adapter.query_raw(sql, *params)\n\n';
    content += '    def execute_raw(self, sql: str, *params) -> int:\n';
    content += '        return self.adapter.execute_raw(sql, *params)\n\n';
    content += '    def transaction(self, fn: Callable) -> Any:\n';
    content += '        return self.adapter.transaction(fn)\n';

    fs.writeFileSync(path.join(outputDir, 'an5_client.py'), content);
  }

  private generateInit(models: Model[], outputDir: string) {
    let content = '# This file is auto-generated. Do not edit directly.\n';
    content += 'from .an5_metadata import MODEL_TO_TABLE, MODEL_DESCRIPTIONS, MODEL_FIELDS, RELATION_MAP\n';
    content += 'from .an5_models import *\n';
    content += 'from .an5_orm_types import (\n';
    content += '    StringFilter, IntFilter, NumberFilter, BoolFilter, DateTimeFilter,\n';
    for (const m of models) {
      const name = this.capitalize(m.name);
      content += `    ${name}WhereInput, ${name}OrderByInput,\n`;
      content += `    ${name}CreateInput, ${name}UpdateInput,\n`;
      content += `    ${name}FindManyArgs, ${name}FindFirstArgs,\n`;
    }
    content += ')\n';
    content += 'from .an5_client import An5Client\n\n';
    content += '__all__ = [\n';
    content += '    "MODEL_TO_TABLE",\n';
    content += '    "MODEL_DESCRIPTIONS",\n';
    content += '    "MODEL_FIELDS",\n';
    content += '    "RELATION_MAP",\n';
    content += '    "An5Client",\n';
    content += '    "StringFilter", "IntFilter", "NumberFilter", "BoolFilter", "DateTimeFilter",\n';

    for (const m of models) {
      const name = this.capitalize(m.name);
      content += `    "${m.name}",\n`;
      content += `    "${name}WhereInput", "${name}OrderByInput",\n`;
      content += `    "${name}CreateInput", "${name}UpdateInput",\n`;
      content += `    "${name}FindManyArgs", "${name}FindFirstArgs",\n`;
    }
    content += ']\n';

    fs.writeFileSync(path.join(outputDir, '__init__.py'), content);
  }

  private getAllPropertyVariations(modelName: string): string[] {
    const variations = new Set<string>();

    variations.add(this.toCamelCase(modelName));
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

  private formatFields(model: Model): string {
    if (model.fields.length === 0) return '[]';

    const fields = model.fields.map(f => {
      return `        { "name": "${f.name}", "type": "${f.type}${f.isOptional ? '?' : ''}", "sql": "${f.sqlType}", "isOptional": ${f.isOptional ? 'True' : 'False'}, "hasDefault": ${f.hasDefault ? 'True' : 'False'}, "isId": ${f.isId ? 'True' : 'False'}, "description": ${this.pyString(f.description)} }`;
    });

    return `[\n${fields.join(',\n')}\n    ]`;
  }

  private pyString(value?: string): string {
    return value ? JSON.stringify(value) : 'None';
  }

  private toCamelCase(str: string): string {
    if (!str) return '';
    return str[0].toLowerCase() + str.slice(1);
  }

  private toSnakeCase(str: string): string {
    if (!str) return '';
    return str
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }

  private capitalize(str: string): string {
    if (!str) return '';
    return str[0].toUpperCase() + str.slice(1);
  }
}

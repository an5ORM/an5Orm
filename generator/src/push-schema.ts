/**
 * Reading `.an5` files for `db:push`.
 *
 * `SchemaParser` and `parseSchemaText` cover the generators and `db:migrate`;
 * this is the third reader, and it exists because push needs a shape of its own:
 * raw `@default` expressions rather than rendered SQL, and the schema a table
 * lands in. It is kept here rather than inline in `push.ts` so the mapping from
 * schema text to a column can be tested without a database.
 */
import {
  attributeArgs,
  hasAttribute,
  parseIndexDirective,
  splitSchemaLines,
  stringOption,
  unquote,
} from './attributes';
import {
  FieldTypeIssue,
  Provider,
  readFieldLineHead,
  resolveFieldType,
  unknownFieldTypeMessage,
} from './field-types';

/** A column, as push needs it: the type as written plus what the dialect renders. */
export interface PushField {
  name: string;
  sqlType: string;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  /** `@unique(map: "…")`, so push and migrate create the same artifact name. */
  uniqueName?: string | undefined;
  /** The `@default(...)` expression, not SQL: only the dialect knows the spelling. */
  defaultExpr?: string | undefined;
}

export interface PushModel {
  name: string;
  tableName: string;
  /** The schema to create the table in; `''` when the provider has none. */
  schema: string;
  /** Set only when the schema file named one, so a wrong one can be reported. */
  declaredSchema?: string | undefined;
  fields: PushField[];
  /** `@@unique([a, b])`, as field lists. */
  compoundUniques: PushIndex[];
  /** `@@index([a, b])`, as field lists. */
  indexes: PushIndex[];
}

/**
 * A `view` block, as push needs it.
 *
 * `fields` describe the view's result columns for validation and generated
 * clients; the DDL itself is `sql`, the `@@sql("...")` body.
 */
export interface PushView {
  name: string;
  /** The database view name; `@@map` may rename it independently. */
  viewName: string;
  schema: string;
  declaredSchema?: string | undefined;
  fields: PushField[];
  sql: string;
}

/**
 * The schema a model lands in when the schema file does not say: none, for every
 * provider, so the name goes wherever the connection resolves.
 *
 * The parser used to default this to `dbo` and push followed it, which failed two
 * ways: SQLite said "unknown database [dbo]", and a SQL Server login whose default
 * schema was something else had push look for `[dbo].[widgets]`, miss the table it
 * had created, and then fail with "there is already an object named ...".
 */
export function defaultSchemaFor(_provider: Provider): string {
  return '';
}

/**
 * One `@@unique` or `@@index`, with the options `db:migrate` already understands.
 *
 * `name` matters as much as the fields: `map:` is how a schema asks for a specific
 * artifact name, and if push invented its own the two commands would create two
 * different constraints for the same directive — and the next migration would keep
 * trying to add the one push never made.
 */
export interface PushIndex {
  fields: string[];
  name?: string | undefined;
  includeFields?: string[] | undefined;
  filter?: string | undefined;
  options?: string | undefined;
}

export interface PushSchema {
  models: PushModel[];
  /** `view` blocks, applied after the tables they read from. */
  views: PushView[];
  /** Field types the provider does not have; empty when the schema is valid. */
  issues: FieldTypeIssue[];
}

/** Reads `@@unique(…)`/`@@index(…)` into the shape push and migrate share. */
function parseDirective(line: string, name: '@@unique' | '@@index'): PushIndex | null {
  const parsed = parseIndexDirective(attributeArgs(line, name));
  if (!parsed) return null;
  return {
    fields: parsed.fields,
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.includeFields ? { includeFields: parsed.includeFields } : {}),
    ...(parsed.filter !== undefined ? { filter: parsed.filter } : {}),
    ...(parsed.options !== undefined ? { options: parsed.options } : {}),
  };
}

/**
 * The name a `@@unique` or `@@index` artifact gets.
 *
 * `map:` wins; otherwise the name is derived from the table and fields, which is what
 * both commands have always done for an unnamed directive.
 */
export function directiveName(
  directive: PushIndex,
  table: string,
  kind: 'compound' | 'index',
  position: number,
): string {
  if (directive.name) return safeIdentifierName(directive.name);
  const base = safeIdentifierName(table);
  return kind === 'compound'
    ? `UQ_${base}_compound_${position}`
    : `IX_${base}_${directive.fields.join('_')}`;
}

/**
 * Reads schema text for push, validating every field type against the provider.
 *
 * All bad types come back in `issues` rather than as an exception, so the caller
 * can print them as a group. A field whose type matches no table is only a
 * mistake once the whole schema has been read: it may be a relation to a model
 * declared further down.
 */
export function parsePushSchema(text: string, provider: Provider): PushSchema {
  const models: PushModel[] = [];
  const views: PushView[] = [];
  const issues: FieldTypeIssue[] = [];
  const modelRefs: Array<{ model: string; field: string; type: string }> = [];
  const viewRefs: Array<{ view: string; field: string; type: string }> = [];
  let current: PushModel | null = null;
  let currentView: PushView | null = null;

  for (const raw of splitSchemaLines(text)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

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
      currentView = null;
      models.push(current);
      continue;
    }

    const viewHeader = line.match(/^view\s+(\w+)\s*\{/);
    if (viewHeader) {
      currentView = {
        name: viewHeader[1],
        viewName: viewHeader[1].toLowerCase() + 's',
        schema: defaultSchemaFor(provider),
        fields: [],
        sql: '',
      };
      current = null;
      views.push(currentView);
      continue;
    }

    if (line === '}') {
      current = null;
      currentView = null;
      continue;
    }

    if (currentView) {
      if (line.startsWith('@@sql') || line.startsWith('@@definition')) {
        const attribute = line.startsWith('@@sql') ? '@@sql' : '@@definition';
        const sql = unquote(attributeArgs(line, attribute));
        if (sql !== undefined) currentView.sql = sql.trim();
        continue;
      }
      if (line.startsWith('@@map')) {
        const mapped = unquote(attributeArgs(line, '@@map'));
        if (mapped) currentView.viewName = mapped;
        continue;
      }
      if (line.startsWith('@@schema')) {
        const declared = unquote(attributeArgs(line, '@@schema'));
        if (declared !== undefined) {
          currentView.schema = declared.trim();
          currentView.declaredSchema = currentView.schema;
        }
        continue;
      }
      if (line.startsWith('@@')) continue;

      const head = readFieldLineHead(line);
      if (!head) continue;
      if (!resolveFieldType(head.type, provider)) {
        // A view's fields are columns of a result set, never relations.
        viewRefs.push({ view: currentView.name, field: head.name, type: head.type });
        continue;
      }
      currentView.fields.push({
        name: head.name,
        sqlType: head.type.toUpperCase(),
        isOptional: head.isOptional,
        isId: false,
        isUnique: false,
      });
      continue;
    }

    if (!current) continue;

    if (line.startsWith('@@map')) {
      const mapped = unquote(attributeArgs(line, '@@map'));
      if (mapped) current.tableName = mapped;
      continue;
    }
    if (line.startsWith('@@schema')) {
      // An empty string is meaningful — `@@schema("")` says "no schema" for databases
      // that have none — so it has to survive as `''` rather than being dropped.
      const declared = unquote(attributeArgs(line, '@@schema'));
      if (declared !== undefined) {
        current.schema = declared.trim();
        current.declaredSchema = current.schema;
      }
      continue;
    }
    if (line.startsWith('@@unique') || line.startsWith('@@index')) {
      const isUnique = line.startsWith('@@unique');
      const definition = parseDirective(line, isUnique ? '@@unique' : '@@index');
      if (definition) {
        if (isUnique) current.compoundUniques.push(definition);
        else current.indexes.push(definition);
      }
      continue;
    }
    if (line.startsWith('@@')) continue;

    const head = readFieldLineHead(line);
    if (!head) continue;

    if (!resolveFieldType(head.type, provider)) {
      modelRefs.push({ model: current.name, field: head.name, type: head.type });
      continue;
    }

    // The type is kept as written (upper-cased) because that is what the database
    // is told; which types exist is what `resolveFieldType` just checked.
    const uniqueArgs = attributeArgs(line, '@unique');
    current.fields.push({
      name: head.name,
      sqlType: head.type.toUpperCase(),
      isOptional: head.isOptional,
      isId: hasAttribute(line, '@id'),
      isUnique: hasAttribute(line, '@unique'),
      ...(uniqueArgs ? { uniqueName: stringOption(uniqueArgs, 'map') } : {}),
      // The expression rather than SQL: `uuid()` and `autoincrement()` are spelled
      // differently per provider, and only the dialect knows how. `@updatedAt` is
      // `now()` under another name.
      defaultExpr: attributeArgs(line, '@default')
        ?? (hasAttribute(line, '@updatedAt') ? 'now()' : undefined),
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
        message:
          `schema "dbo" does not exist in ${provider}; remove the @@schema directive or set it ` +
          'to the schema this database uses',
      });
    }
  }

  for (const view of views) {
    if (view.declaredSchema === 'dbo' && provider !== 'mssql') {
      issues.push({
        path: view.name,
        message:
          `schema "dbo" does not exist in ${provider}; remove the @@schema directive or set it ` +
          'to the schema this database uses',
      });
    }
    if (!view.sql.trim()) {
      issues.push({ path: view.name, message: 'a view needs @@sql("SELECT ...")' });
    }
  }

  // A `@unique` without `map:` must still get the deterministic name `db:migrate`
  // expects, or push leaves a database-named constraint that the next diff cannot
  // recognise and adds a second one for the same column.
  for (const model of models) {
    const table = safeIdentifierName(model.tableName);
    for (const field of model.fields) {
      if (field.isUnique && !field.isId && !field.uniqueName) {
        field.uniqueName = `UQ_${table}_${safeIdentifierName(field.name)}`;
      }
    }
  }

  const modelNames = models.map((model) => model.name);
  const viewNames = new Set(views.map((view) => view.name));
  for (const ref of modelRefs) {
    if (viewNames.has(ref.type)) {
      issues.push({
        path: `${ref.model}.${ref.field}`,
        message: `"${ref.type}" is a view and cannot be the target of a relation; select from it directly instead`,
      });
      continue;
    }
    if (!modelNames.includes(ref.type)) {
      issues.push({
        path: `${ref.model}.${ref.field}`,
        message: unknownFieldTypeMessage(ref.type, provider, modelNames),
      });
    }
  }
  for (const ref of viewRefs) {
    issues.push({
      path: `${ref.view}.${ref.field}`,
      message: unknownFieldTypeMessage(ref.type, provider, modelNames),
    });
  }

  return { models, views, issues };
}

/**
 * The table name to create, `schema.table` unless the model cleared the schema.
 *
 * An empty schema has to stay empty: `[].[widgets]` is not valid SQL, which is the
 * whole reason `@@schema("")` exists.
 */
/**
 * An identifier for a generated artifact name: letters, digits and underscores only.
 *
 * The name goes into DDL as an identifier, so anything else is replaced rather than
 * quoted — `@@map("catalog entries")` must not produce a name the provider rejects.
 */
export function safeIdentifierName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function qualifiedTableName(model: PushModel): string {
  return model.schema ? `${model.schema}.${model.tableName}` : model.tableName;
}

/** The view name to create, qualified only when the view declared a schema. */
export function qualifiedViewName(view: PushView): string {
  return view.schema ? `${view.schema}.${view.viewName}` : view.viewName;
}
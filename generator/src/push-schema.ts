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
  /** Field types the provider does not have; empty when the schema is valid. */
  issues: FieldTypeIssue[];
}

/** The field list of `@@unique([a, b], …)`, plus whatever options follow it. */
const DIRECTIVE = /^@@(?:unique|index)\(\s*\[([\w\s,]+)\]([^)]*)\)/;

function parseDirective(line: string, fields: string): PushIndex {
  const options = line.match(DIRECTIVE)?.[2] ?? '';
  const name = options.match(/\bmap\s*:\s*"([^"]+)"/)?.[1];
  const include = options.match(/\binclude\s*:\s*\[([\w,\s]+)\]/)?.[1];
  const filter = options.match(/\bfilter\s*:\s*"([^"]+)"/)?.[1];
  const opts = options.match(/\boptions\s*:\s*"([^"]+)"/)?.[1];
  return {
    fields: fields.split(',').map((field) => field.trim()).filter(Boolean),
    ...(name ? { name } : {}),
    ...(include ? { includeFields: include.split(',').map((field) => field.trim()).filter(Boolean) } : {}),
    ...(filter ? { filter } : {}),
    ...(opts ? { options: opts } : {}),
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
  const issues: FieldTypeIssue[] = [];
  const modelRefs: Array<{ model: string; field: string; type: string }> = [];
  let current: PushModel | null = null;

  for (const raw of text.split('\n')) {
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
      models.push(current);
      continue;
    }

    if (line === '}') {
      current = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith('@@map')) {
      const match = line.match(/@@map\("(.+)"\)/);
      if (match) current.tableName = match[1];
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
      const match = line.match(DIRECTIVE);
      if (match) {
        const definition = parseDirective(line, match[1] ?? '');
        if (line.startsWith('@@unique')) current.compoundUniques.push(definition);
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
        message:
          `schema "dbo" does not exist in ${provider}; remove the @@schema directive or set it ` +
          'to the schema this database uses',
      });
    }
  }

  const modelNames = models.map((model) => model.name);
  for (const ref of modelRefs) {
    if (!modelNames.includes(ref.type)) {
      issues.push({
        path: `${ref.model}.${ref.field}`,
        message: unknownFieldTypeMessage(ref.type, provider, modelNames),
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
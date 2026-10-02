/**
 * Side-effect-free entrypoint for programmatic use of the code generator.
 *
 * Importing `./index` runs the CLI (`main()`), so tooling that wants to drive
 * the generator in-process — such as the an5Agent `generateClientCode` tool —
 * imports this module instead.
 *
 * The provider is optional and defaults to SQL Server. Pass one derived from
 * the connection string when the schema targets another database, so field
 * types are checked against that database's types — `providerForProject` reads
 * it from the config file for callers that only know the project directory:
 *
 * ```ts
 * import { SchemaParser, RustGenerator, providerForProject } from '@an5/orm/generator';
 *
 * const provider = providerForProject(__dirname);
 * const models = await new SchemaParser('an5Schema', provider).parse();
 * new RustGenerator('an5Client/rust').generate(models);
 * ```
 */
export { SchemaParser, sqlTypeToTs } from './parser';
export { CodeGenerator } from './code-generator';
export { MetadataGenerator } from './metadata-generator';
export { PythonGenerator } from './python-generator';
export { DotnetGenerator } from './dotnet-generator';
export { GolangGenerator } from './golang-generator';
export { RustGenerator } from './rust-generator';
export { detectProvider, providerFromConfig, providerForProject } from './config';
export { dialectFor, defaultClause, sqlLiteral } from './dialect';
export type { ColumnSpec, PushDialect } from './dialect';
export { DEFAULT_PROVIDER, FieldTypeError, PROVIDERS, PROVIDER_FIELD_TYPES, PROVIDER_LABELS, defaultSqlTypeForTs, fieldTypesFor, resolveFieldType, unknownFieldTypeMessage, } from './field-types';
export type { FieldTypeIssue, Provider, TsType } from './field-types';
export type { Model, Field, Relation } from './types';

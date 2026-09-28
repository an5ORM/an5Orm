/**
 * Side-effect-free entrypoint for programmatic use of the code generator.
 *
 * Importing `./index` runs the CLI (`main()`), so tooling that wants to drive
 * the generator in-process — such as the an5Agent `generateClientCode` tool —
 * imports this module instead.
 *
 * ```ts
 * import { SchemaParser, RustGenerator } from '@an5/orm/generator';
 *
 * const models = await new SchemaParser('an5Schema').parse();
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
export type { Model, Field, Relation } from './types';

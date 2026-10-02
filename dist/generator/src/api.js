"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unknownFieldTypeMessage = exports.resolveFieldType = exports.fieldTypesFor = exports.PROVIDER_LABELS = exports.PROVIDER_FIELD_TYPES = exports.PROVIDERS = exports.FieldTypeError = exports.DEFAULT_PROVIDER = exports.sqlLiteral = exports.defaultClause = exports.dialectFor = exports.providerForProject = exports.providerFromConfig = exports.detectProvider = exports.RustGenerator = exports.GolangGenerator = exports.DotnetGenerator = exports.PythonGenerator = exports.MetadataGenerator = exports.CodeGenerator = exports.sqlTypeToTs = exports.SchemaParser = void 0;
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
var parser_1 = require("./parser");
Object.defineProperty(exports, "SchemaParser", { enumerable: true, get: function () { return parser_1.SchemaParser; } });
Object.defineProperty(exports, "sqlTypeToTs", { enumerable: true, get: function () { return parser_1.sqlTypeToTs; } });
var code_generator_1 = require("./code-generator");
Object.defineProperty(exports, "CodeGenerator", { enumerable: true, get: function () { return code_generator_1.CodeGenerator; } });
var metadata_generator_1 = require("./metadata-generator");
Object.defineProperty(exports, "MetadataGenerator", { enumerable: true, get: function () { return metadata_generator_1.MetadataGenerator; } });
var python_generator_1 = require("./python-generator");
Object.defineProperty(exports, "PythonGenerator", { enumerable: true, get: function () { return python_generator_1.PythonGenerator; } });
var dotnet_generator_1 = require("./dotnet-generator");
Object.defineProperty(exports, "DotnetGenerator", { enumerable: true, get: function () { return dotnet_generator_1.DotnetGenerator; } });
var golang_generator_1 = require("./golang-generator");
Object.defineProperty(exports, "GolangGenerator", { enumerable: true, get: function () { return golang_generator_1.GolangGenerator; } });
var rust_generator_1 = require("./rust-generator");
Object.defineProperty(exports, "RustGenerator", { enumerable: true, get: function () { return rust_generator_1.RustGenerator; } });
var config_1 = require("./config");
Object.defineProperty(exports, "detectProvider", { enumerable: true, get: function () { return config_1.detectProvider; } });
Object.defineProperty(exports, "providerFromConfig", { enumerable: true, get: function () { return config_1.providerFromConfig; } });
Object.defineProperty(exports, "providerForProject", { enumerable: true, get: function () { return config_1.providerForProject; } });
var dialect_1 = require("./dialect");
Object.defineProperty(exports, "dialectFor", { enumerable: true, get: function () { return dialect_1.dialectFor; } });
Object.defineProperty(exports, "defaultClause", { enumerable: true, get: function () { return dialect_1.defaultClause; } });
Object.defineProperty(exports, "sqlLiteral", { enumerable: true, get: function () { return dialect_1.sqlLiteral; } });
var field_types_1 = require("./field-types");
Object.defineProperty(exports, "DEFAULT_PROVIDER", { enumerable: true, get: function () { return field_types_1.DEFAULT_PROVIDER; } });
Object.defineProperty(exports, "FieldTypeError", { enumerable: true, get: function () { return field_types_1.FieldTypeError; } });
Object.defineProperty(exports, "PROVIDERS", { enumerable: true, get: function () { return field_types_1.PROVIDERS; } });
Object.defineProperty(exports, "PROVIDER_FIELD_TYPES", { enumerable: true, get: function () { return field_types_1.PROVIDER_FIELD_TYPES; } });
Object.defineProperty(exports, "PROVIDER_LABELS", { enumerable: true, get: function () { return field_types_1.PROVIDER_LABELS; } });
Object.defineProperty(exports, "fieldTypesFor", { enumerable: true, get: function () { return field_types_1.fieldTypesFor; } });
Object.defineProperty(exports, "resolveFieldType", { enumerable: true, get: function () { return field_types_1.resolveFieldType; } });
Object.defineProperty(exports, "unknownFieldTypeMessage", { enumerable: true, get: function () { return field_types_1.unknownFieldTypeMessage; } });

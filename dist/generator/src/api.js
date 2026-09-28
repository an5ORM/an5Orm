"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RustGenerator = exports.GolangGenerator = exports.DotnetGenerator = exports.PythonGenerator = exports.MetadataGenerator = exports.CodeGenerator = exports.sqlTypeToTs = exports.SchemaParser = void 0;
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

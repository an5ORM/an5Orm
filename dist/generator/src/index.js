"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const field_types_1 = require("./field-types");
const parser_1 = require("./parser");
const code_generator_1 = require("./code-generator");
const metadata_generator_1 = require("./metadata-generator");
const python_generator_1 = require("./python-generator");
const dotnet_generator_1 = require("./dotnet-generator");
const golang_generator_1 = require("./golang-generator");
const rust_generator_1 = require("./rust-generator");
const fs_1 = __importDefault(require("fs"));
function clearGeneratedFiles(outputDir, extension) {
    if (!fs_1.default.existsSync(outputDir)) {
        fs_1.default.mkdirSync(outputDir, { recursive: true });
        return;
    }
    for (const entry of fs_1.default.readdirSync(outputDir)) {
        const fullPath = path_1.default.join(outputDir, entry);
        const stat = fs_1.default.statSync(fullPath);
        if (stat.isDirectory())
            continue;
        if (entry.endsWith(extension)) {
            fs_1.default.unlinkSync(fullPath);
        }
    }
}
function clearGeneratedPythonFiles(outputDir) {
    if (!fs_1.default.existsSync(outputDir)) {
        fs_1.default.mkdirSync(outputDir, { recursive: true });
        return;
    }
    // Delete generated .py files but preserve hand-maintained adapter.
    const preserve = new Set(['an5_adapter.py']);
    for (const entry of fs_1.default.readdirSync(outputDir)) {
        const fullPath = path_1.default.join(outputDir, entry);
        const stat = fs_1.default.statSync(fullPath);
        if (stat.isDirectory())
            continue;
        if (entry.endsWith('.py') && !preserve.has(entry)) {
            fs_1.default.unlinkSync(fullPath);
        }
    }
}
async function main() {
    // Loaded through the validating loader, so a mistyped key or a wrong type
    // stops here instead of quietly generating somewhere else.
    let config;
    try {
        config = (0, config_1.loadConfig)();
    }
    catch (err) {
        if (err instanceof config_1.ConfigError) {
            console.error(`❌ ${err.message}:`);
            console.error((0, config_1.formatIssues)(err.issues));
            process.exit(1);
        }
        console.warn('⚠️ Could not load an5Orm.config.js/.cjs, using defaults.', err);
        config = (0, config_1.loadConfig)(path_1.default.join(process.cwd(), 'no-such-dir'));
    }
    const { rootDir } = config;
    const schemaDir = config.outputs.schemaDir;
    const outputTypesDir = config.outputs.typescriptDir;
    const outputMetadataPath = config.outputs.typescriptMetadataFile;
    const outputPythonMetadataPath = config.outputs.pythonMetadataFile;
    const outputDotnetDir = config.outputs.dotnetDir;
    const outputGolangDir = config.outputs.golangDir;
    const outputRustDir = config.outputs.rustDir;
    const generateMetadata = config.config.generation.generateMetadata;
    console.log('🚀 Starting ORM generation...');
    // The target provider comes from the connection string: both the allowed
    // field types and the SQL follow it, instead of one shared list.
    const provider = (0, config_1.providerFromConfig)(config.config, process.env);
    console.log(`🗄️  Provider: ${field_types_1.PROVIDER_LABELS[provider]} (${provider})`);
    try {
        clearGeneratedFiles(outputTypesDir, '.ts');
        clearGeneratedFiles(outputDotnetDir, '.cs');
        clearGeneratedFiles(outputGolangDir, '.go');
        clearGeneratedFiles(path_1.default.join(outputRustDir, 'src'), '.rs');
        const pythonDirEarly = path_1.default.dirname(outputPythonMetadataPath);
        clearGeneratedPythonFiles(pythonDirEarly);
        if (config.config.generation.generateMetadata && fs_1.default.existsSync(outputMetadataPath)) {
            fs_1.default.unlinkSync(outputMetadataPath);
        }
        const parser = new parser_1.SchemaParser(schemaDir, provider);
        const models = await parser.parse();
        console.log(`📦 Parsed ${models.length} models from schema.`);
        const codeGen = new code_generator_1.CodeGenerator(outputTypesDir);
        codeGen.generate(models);
        console.log(`✨ Generated modular types in ${outputTypesDir}`);
        if (generateMetadata) {
            const metadataDir = path_1.default.dirname(outputMetadataPath);
            if (!fs_1.default.existsSync(metadataDir)) {
                fs_1.default.mkdirSync(metadataDir, { recursive: true });
            }
            const metadataGen = new metadata_generator_1.MetadataGenerator(outputMetadataPath);
            metadataGen.generate(models);
            console.log(`✨ Generated metadata in ${outputMetadataPath}`);
        }
        else {
            console.log('⏭ Skipping metadata (generation.generateMetadata is false)');
        }
        const pythonDir = path_1.default.dirname(outputPythonMetadataPath);
        if (!fs_1.default.existsSync(pythonDir)) {
            fs_1.default.mkdirSync(pythonDir, { recursive: true });
        }
        const pythonGen = new python_generator_1.PythonGenerator(outputPythonMetadataPath);
        pythonGen.generate(models);
        console.log(`✨ Generated Python metadata and client models in ${pythonDir}`);
        const dotnetGen = new dotnet_generator_1.DotnetGenerator(outputDotnetDir);
        dotnetGen.generate(models);
        console.log(`✨ Generated .NET models in ${outputDotnetDir}`);
        const golangGen = new golang_generator_1.GolangGenerator(outputGolangDir);
        golangGen.generate(models);
        console.log(`✨ Generated Golang models in ${outputGolangDir}`);
        const rustGen = new rust_generator_1.RustGenerator(outputRustDir);
        rustGen.generate(models);
        console.log(`✨ Generated Rust client in ${outputRustDir}`);
        console.log('✅ ORM generation completed successfully.');
    }
    catch (error) {
        // Print every bad field type with its provider, instead of the parser's
        // nested error object.
        if (error instanceof field_types_1.FieldTypeError) {
            console.error(`❌ ${error.message}:`);
            console.error((0, config_1.formatIssues)(error.issues));
            process.exit(1);
        }
        console.error('❌ ORM generation failed:', error);
        process.exit(1);
    }
}
main();

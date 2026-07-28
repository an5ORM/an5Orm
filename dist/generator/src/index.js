"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const parser_1 = require("./parser");
const code_generator_1 = require("./code-generator");
const metadata_generator_1 = require("./metadata-generator");
const python_generator_1 = require("./python-generator");
const dotnet_generator_1 = require("./dotnet-generator");
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
async function main() {
    const rootDir = process.cwd();
    let config = {};
    try {
        const configPath = path_1.default.join(rootDir, 'an5Orm.config.js');
        if (fs_1.default.existsSync(configPath)) {
            config = require(configPath);
        }
    }
    catch (err) {
        console.warn('⚠️ Could not load an5Orm.config.js, using defaults.', err);
    }
    const schemaDir = path_1.default.resolve(rootDir, config.schemaDir || 'an5Schema');
    const outputTypesDir = path_1.default.resolve(rootDir, config.outputs?.typescript?.outputDir || 'an5Client/typescript');
    const outputMetadataPath = path_1.default.resolve(rootDir, config.outputs?.typescript?.metadataFile || 'an5Client/typescript/an5Metadata.ts');
    const outputPythonMetadataPath = path_1.default.resolve(rootDir, config.outputs?.python?.metadataFile || 'an5Client/python/an5_metadata.py');
    const outputDotnetDir = path_1.default.resolve(rootDir, config.outputs?.dotnet?.outputDir || 'an5Client/dotnet');
    console.log('🚀 Starting ORM generation...');
    try {
        clearGeneratedFiles(outputTypesDir, '.ts');
        clearGeneratedFiles(outputDotnetDir, '.cs');
        if (fs_1.default.existsSync(outputMetadataPath)) {
            fs_1.default.unlinkSync(outputMetadataPath);
        }
        if (fs_1.default.existsSync(outputPythonMetadataPath)) {
            fs_1.default.unlinkSync(outputPythonMetadataPath);
        }
        const parser = new parser_1.SchemaParser(schemaDir);
        const models = await parser.parse();
        console.log(`📦 Parsed ${models.length} models from schema.`);
        const codeGen = new code_generator_1.CodeGenerator(outputTypesDir);
        codeGen.generate(models);
        console.log(`✨ Generated modular types in ${outputTypesDir}`);
        const metadataDir = path_1.default.dirname(outputMetadataPath);
        if (!fs_1.default.existsSync(metadataDir)) {
            fs_1.default.mkdirSync(metadataDir, { recursive: true });
        }
        const metadataGen = new metadata_generator_1.MetadataGenerator(outputMetadataPath);
        metadataGen.generate(models);
        console.log(`✨ Generated metadata in ${outputMetadataPath}`);
        const pythonDir = path_1.default.dirname(outputPythonMetadataPath);
        if (!fs_1.default.existsSync(pythonDir)) {
            fs_1.default.mkdirSync(pythonDir, { recursive: true });
        }
        const pythonGen = new python_generator_1.PythonGenerator(outputPythonMetadataPath);
        pythonGen.generate(models);
        console.log(`✨ Generated Python metadata in ${outputPythonMetadataPath}`);
        const dotnetGen = new dotnet_generator_1.DotnetGenerator(outputDotnetDir);
        dotnetGen.generate(models);
        console.log(`✨ Generated .NET models in ${outputDotnetDir}`);
        console.log('✅ ORM generation completed successfully.');
    }
    catch (error) {
        console.error('❌ ORM generation failed:', error);
        process.exit(1);
    }
}
main();

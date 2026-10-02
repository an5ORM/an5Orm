import path from 'path';
import { loadConfig, providerFromConfig, ConfigError, formatIssues } from './config';
import { FieldTypeError, PROVIDER_LABELS } from './field-types';
import { SchemaParser } from './parser';
import { CodeGenerator } from './code-generator';
import { MetadataGenerator } from './metadata-generator';
import { PythonGenerator } from './python-generator';
import { DotnetGenerator } from './dotnet-generator';
import { GolangGenerator } from './golang-generator';
import { RustGenerator } from './rust-generator';

import fs from 'fs';

function clearGeneratedFiles(outputDir: string, extension: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    return;
  }

  for (const entry of fs.readdirSync(outputDir)) {
    const fullPath = path.join(outputDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) continue;
    if (entry.endsWith(extension)) {
      fs.unlinkSync(fullPath);
    }
  }
}

function clearGeneratedPythonFiles(outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    return;
  }

  // Delete generated .py files but preserve hand-maintained adapter.
  const preserve = new Set(['an5_adapter.py']);
  for (const entry of fs.readdirSync(outputDir)) {
    const fullPath = path.join(outputDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) continue;
    if (entry.endsWith('.py') && !preserve.has(entry)) {
      fs.unlinkSync(fullPath);
    }
  }
}

async function main() {
  // Loaded through the validating loader, so a mistyped key or a wrong type
  // stops here instead of quietly generating somewhere else.
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`❌ ${err.message}:`);
      console.error(formatIssues(err.issues));
      process.exit(1);
    }
    console.warn('⚠️ Could not load an5Orm.config.js/.cjs, using defaults.', err);
    config = loadConfig(path.join(process.cwd(), 'no-such-dir'));
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
  const provider = providerFromConfig(config.config, process.env);
  console.log(`🗄️  Provider: ${PROVIDER_LABELS[provider]} (${provider})`);

  try {
    clearGeneratedFiles(outputTypesDir, '.ts');
    clearGeneratedFiles(outputDotnetDir, '.cs');
    clearGeneratedFiles(outputGolangDir, '.go');
    clearGeneratedFiles(path.join(outputRustDir, 'src'), '.rs');
    const pythonDirEarly = path.dirname(outputPythonMetadataPath);
    clearGeneratedPythonFiles(pythonDirEarly);
    if (config.config.generation.generateMetadata && fs.existsSync(outputMetadataPath)) {
      fs.unlinkSync(outputMetadataPath);
    }

    const parser = new SchemaParser(schemaDir, provider);
    const models = await parser.parse();
    console.log(`📦 Parsed ${models.length} models from schema.`);

    const codeGen = new CodeGenerator(outputTypesDir);
    codeGen.generate(models);
    console.log(`✨ Generated modular types in ${outputTypesDir}`);

    if (generateMetadata) {
      const metadataDir = path.dirname(outputMetadataPath);
      if (!fs.existsSync(metadataDir)) {
        fs.mkdirSync(metadataDir, { recursive: true });
      }
      const metadataGen = new MetadataGenerator(outputMetadataPath);
      metadataGen.generate(models);
      console.log(`✨ Generated metadata in ${outputMetadataPath}`);
    } else {
      console.log('⏭ Skipping metadata (generation.generateMetadata is false)');
    }

    const pythonDir = path.dirname(outputPythonMetadataPath);
    if (!fs.existsSync(pythonDir)) {
      fs.mkdirSync(pythonDir, { recursive: true });
    }
    const pythonGen = new PythonGenerator(outputPythonMetadataPath);
    pythonGen.generate(models);
    console.log(`✨ Generated Python metadata and client models in ${pythonDir}`);

    const dotnetGen = new DotnetGenerator(outputDotnetDir);
    dotnetGen.generate(models);
    console.log(`✨ Generated .NET models in ${outputDotnetDir}`);

    const golangGen = new GolangGenerator(outputGolangDir);
    golangGen.generate(models);
    console.log(`✨ Generated Golang models in ${outputGolangDir}`);

    const rustGen = new RustGenerator(outputRustDir);
    rustGen.generate(models);
    console.log(`✨ Generated Rust client in ${outputRustDir}`);

    console.log('✅ ORM generation completed successfully.');
  } catch (error) {
    // Print every bad field type with its provider, instead of the parser's
    // nested error object.
    if (error instanceof FieldTypeError) {
      console.error(`❌ ${error.message}:`);
      console.error(formatIssues(error.issues));
      process.exit(1);
    }
    console.error('❌ ORM generation failed:', error);
    process.exit(1);
  }
}

main();

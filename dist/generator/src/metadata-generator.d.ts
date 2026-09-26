import { Model } from './types';
export declare class MetadataGenerator {
    private outputPath;
    private relationImport;
    constructor(outputPath: string, relationImport?: string);
    generate(models: Model[]): void;
    private getAllPropertyVariations;
    private toSnakeCase;
    private formatFieldMetadata;
    private toCamelCase;
}

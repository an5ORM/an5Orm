import { Model } from './types';
export declare class MetadataGenerator {
    private outputPath;
    constructor(outputPath: string);
    generate(models: Model[]): void;
    private getAllPropertyVariations;
    private toCamelCase;
}

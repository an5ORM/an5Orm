import { Model } from './types';
export declare class PythonGenerator {
    private outputPath;
    constructor(outputPath: string);
    generate(models: Model[]): void;
    private getAllPropertyVariations;
    private toCamelCase;
    private toSnakeCase;
}

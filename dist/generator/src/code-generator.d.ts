import { Model } from './types';
export declare class CodeGenerator {
    private outputDir;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private generateBaseTs;
    private generateModelFile;
    private generateIndexTs;
    private getAllPropertyVariations;
    private getFieldFilterType;
    private normalizeType;
    private toCamelCase;
}

import { Model } from './types';
export declare class PythonGenerator {
    private outputPath;
    constructor(outputPath: string);
    generate(models: Model[]): void;
    private getPyFilterType;
    private generateOrmTypes;
    private generateMetadata;
    private mapPyType;
    private generateModels;
    private generateClient;
    private generateInit;
    private getAllPropertyVariations;
    private formatFields;
    private pyString;
    private toCamelCase;
    private toSnakeCase;
    private capitalize;
}

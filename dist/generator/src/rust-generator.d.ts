import { Model } from './types';
export declare class RustGenerator {
    private outputDir;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private generateCargoToml;
    private generateLibRs;
    private generateFiltersRs;
    private generateModelsRs;
    private buildModelsBody;
    private generateMetadataRs;
    private generateConfigRs;
    private generateClientRs;
    private buildModelClientImpl;
    private mapRustType;
    private getRustFilterType;
    private getAllPropertyVariations;
    private capitalize;
    private toCamelCase;
    private toSnakeCase;
}

import { Model } from './types';
export declare class GolangGenerator {
    private outputDir;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private mapGoType;
    private generateModelFile;
    private generateModelStruct;
    private generateMetadataGo;
    private generateConfigGo;
    private generateClientGo;
    private generateClientHeader;
    private generateBaseOrmTypes;
    private generateDbContext;
    private generateTableClientStruct;
    private generateQueryAndScan;
    private generateWhereBuilder;
    private generateCrudMethods;
    private generateVectorSearch;
    private generateHelpers;
    private generateModelOrmTypes;
    private getGoFilterType;
    private getAllPropertyVariations;
    private capitalize;
    private toCamelCase;
    private toSnakeCase;
}

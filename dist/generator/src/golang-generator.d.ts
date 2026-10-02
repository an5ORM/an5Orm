import { Model } from './types';
export declare class GolangGenerator {
    private outputDir;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    /**
     * The Go type for a field.
     *
     * Driven by the declared type, not the generated TypeScript one: that collapses
     * `INT`, `FLOAT` and `DECIMAL` into `number`, which matched none of the branches
     * below and made every numeric column a `string`.
     */
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

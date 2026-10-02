import { Model } from './types';
export declare class DotnetGenerator {
    private outputDir;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private getCsFilterType;
    private generateOrmTypes;
    private generateConfigClass;
    /**
     * The C# type for a field.
     *
     * Driven by the declared type, so a `DECIMAL` column is a `decimal` and a `FLOAT`
     * one a `double`: both arrived as `number` and took the `int` branch.
     */
    private mapType;
    private generateEntityClass;
    private generateDbContext;
    private capitalize;
}

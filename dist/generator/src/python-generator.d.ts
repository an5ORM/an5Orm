import { Model } from './types';
export declare class PythonGenerator {
    private outputPath;
    constructor(outputPath: string);
    /**
     * The metadata module name, taken from the configured file name itself.
     *
     * The imports used to hardcode `an5_metadata` while `outputPath` was
     * configurable, so setting `python.metadataFile` to another name (say
     * `an5Metadata.py`) still generated `from an5_metadata import ...` and the
     * client broke on import — a failure that only showed up at runtime.
     */
    private metadataModule;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    generate(models: Model[]): void;
    private getPyFilterType;
    private generateOrmTypes;
    private generateMetadata;
    /**
     * The Python type for a field.
     *
     * From the declared type, so `DECIMAL` is a `float` and `BIGINT` stays an `int`:
     * both arrived as `number` before and took the integer branch.
     */
    private mapPyType;
    private generateModelFile;
    private generateModelsIndex;
    private generateClient;
    private generateInit;
    private getAllPropertyVariations;
    private formatFields;
    private pyString;
    private toCamelCase;
    private toSnakeCase;
    private capitalize;
}

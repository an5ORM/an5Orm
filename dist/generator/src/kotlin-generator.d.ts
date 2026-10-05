import { Model } from './types';
export declare class KotlinGenerator {
    private outputDir;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private capitalize;
    /**
     * The property name for a column.
     *
     * Backticked rather than renamed where possible, so `when` stays `when`: renaming would
     * change the name in the generated data class but not in the SQL, and the mismatch is
     * harder to notice than a backtick.
     */
    private property;
    private static toCamelCase;
    private static toLowerCamelCase;
    /** The Kotlin type for a column. */
    private mapType;
    /** The nullable form, which is what every generated property is: a column may be `NULL` until written. */
    private mapNullableType;
    /** The runtime accessor that reads a column into its type. */
    private readAccessor;
    private filterType;
    private generateModels;
    private modelSource;
    private defaultFor;
    private generateOrmTypes;
    private generateMetadata;
    private generateConfig;
    private generateClient;
    private tableName;
}

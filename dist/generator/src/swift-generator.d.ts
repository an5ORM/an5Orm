import { Model } from './types';
export declare class SwiftGenerator {
    private outputDir;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    /**
     * The SwiftPM manifest for the generated client.
     *
     * <p>SwiftPM has no "point a build at this folder" story the way a csproj or a go.mod
     * does: a target's sources have to live under `Sources/<Target>/`. Emitting the manifest
     * and that layout together is what makes the output a package an app can depend on,
     * rather than a directory a consumer has to restructure by hand.
     */
    private generatePackageManifest;
    /** Where SwiftPM expects a target's sources. */
    private get sourceDir();
    private capitalize;
    /**
     * The property name for a column.
     *
     * Backticked rather than renamed where possible: `default` and `class` are valid column
     * names, and renaming them in the model but not in the SQL is a mismatch nobody notices.
     */
    private property;
    private static toCamelCase;
    private static toLowerCamelCase;
    /** The Swift type for a column. */
    private mapType;
    private mapOptionalType;
    /** How a column is read out of a row, as a Swift expression. */
    private readExpression;
    private filterType;
    private generateModels;
    private modelSource;
    private generateOrmTypes;
    private generateMetadata;
    private generateConfig;
    private generateClient;
    private tableName;
}

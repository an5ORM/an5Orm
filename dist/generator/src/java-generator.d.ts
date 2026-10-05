import { Model } from './types';
export declare class JavaGenerator {
    private outputDir;
    /** The database being generated for; decides types like `TIMESTAMP`. */
    private provider;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private capitalize;
    /**
     * The Java field name for a schema column.
     *
     * A field named `class`, `new` or `from` would not compile as an identifier, so those are
     * suffixed rather than left to fail at the call site.
     */
    private fieldName;
    private getterName;
    private static toCamelCase;
    private static toLowerCamelCase;
    /**
     * Every spelling of a model name the client registers it under.
     *
     * The metadata is keyed in camelCase while the model class is PascalCase, and the adapter
     * resolves the difference; these are the names the context exposes so either spelling
     * works at the call site.
     */
    private propertyNames;
    /**
     * The Java type for a column.
     *
     * Driven by the declared type, so a `DECIMAL` column is a `BigDecimal` and not an `int`:
     * both arrive from the parser as `number`, which is how the earlier clients turned
     * decimal money into integers.
     */
    private mapType;
    /**
     * The boxed form used in a model.
     *
     * Every field is boxed, primitives included: `toValues` skips the columns left null, and a
     * column the schema does not mark optional can still read NULL until a row is written. A
     * primitive cannot represent "unset", so the skip would have to give the column a default
     * and quietly write it.
     */
    private mapNullableType;
    private getFilterType;
    private generateModels;
    private modelSource;
    /** The expression that reads one column into its field. */
    private readExpression;
    private generateValues;
    private generateOrmTypes;
    private generateMetadata;
    private generateConfig;
    private modelClientSource;
    private generateDbContext;
    private tableName;
}

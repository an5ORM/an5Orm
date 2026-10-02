import { Model } from './types';
import { Provider } from './field-types';
/**
 * Maps a column type of a provider to its TypeScript type.
 *
 * `provider` defaults to SQL Server so existing callers keep their behaviour;
 * the generator passes the provider derived from the connection string.
 */
export declare function sqlTypeToTs(sqlType: string, provider?: Provider): string;
export declare class SchemaParser {
    private schemaDir;
    private provider;
    private schemaText;
    private issues;
    private modelRefs;
    private models;
    /**
     * @param schemaDir directory holding the `.an5` files
     * @param provider target database; decides which field types are valid
     */
    constructor(schemaDir: string, provider?: Provider);
    parse(): Promise<Model[]>;
    private loadSchema;
    private parseModelLine;
    /**
     * Settles the fields that matched no type: a name matching a model in the
     * schema is a relation, anything else is a bad type — reported with the
     * provider name and a suggestion.
     *
     * The decision has to wait for the whole schema, because a relation may point
     * at a model declared later. Every upper-case token used to count as a
     * relation, so `INTEGER` written for SQL Server became a relation to a model
     * named `INTEGER` and nothing ever complained.
     */
    private resolveModelRefs;
    private postProcessRelations;
}

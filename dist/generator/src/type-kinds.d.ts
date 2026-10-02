/**
 * What a field *is*, for the generators that need a real type.
 *
 * The parser gives every generator the same TypeScript type, and that type loses
 * what a language needs: `INT`, `FLOAT` and `DECIMAL` all arrive as `number`, so
 * the Go client generated every numeric column as a `string`, and the Python, Rust
 * and .NET clients turned a `DECIMAL` into an integer type. The declared type is
 * right there in `Field.sqlType`, so it decides — with the TypeScript type as the
 * fallback for metadata generated before that was recorded.
 */
import { Provider } from './field-types';
/** The categories a generated language type can be built from. */
export type FieldKind = 'int' | 'bigint' | 'float' | 'bool' | 'date' | 'bytes' | 'json' | 'vector' | 'string';
export interface KindInput {
    /** The TypeScript type the parser produced, e.g. `number | bigint`. */
    type: string;
    /** The type as written in the schema, e.g. `DECIMAL(10,2)`. */
    sqlType?: string | undefined;
}
/**
 * The category a field belongs to.
 *
 * `TIMESTAMP` is the reason `provider` is a parameter: it is a rowversion on SQL
 * Server and a point in time everywhere else, and the same word has to produce
 * bytes in one and a date in the other.
 */
export declare function fieldKind(field: KindInput, provider?: Provider | undefined): FieldKind;

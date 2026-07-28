import { Model } from './types';
export declare function sqlTypeToTs(sqlType: string): string;
export declare class SchemaParser {
    private schemaDir;
    private schemaText;
    constructor(schemaDir: string);
    parse(): Promise<Model[]>;
    private loadSchema;
    private parseModelLine;
    private postProcessRelations;
}

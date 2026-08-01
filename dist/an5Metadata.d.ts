import type { RelationDef } from "./metadata";
export declare const modelToTable: Record<string, string>;
export declare const modelDescriptions: Record<string, string | undefined>;
export declare const modelFields: Record<string, Record<string, {
    ts: string;
    sql: string;
    description?: string;
}>>;
export declare const relationMap: Record<string, Record<string, RelationDef>>;
//# sourceMappingURL=an5Metadata.d.ts.map
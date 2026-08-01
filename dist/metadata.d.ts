/**
 * Core metadata types for AN5 ORM.
 * These types are owned by the core package (@an5/orm) so that the ORM never
 * has to import from generated client artifacts. Generated clients import
 * these types from @an5/orm instead.
 */
export interface RelationDef {
    modelName: string;
    relationType: "many" | "one";
    foreignKey: string;
    localKey: string;
}
export interface ModelFieldMeta {
    ts: string;
    sql: string;
    description?: string;
}
export interface An5Metadata {
    modelToTable: Record<string, string>;
    relationMap: Record<string, Record<string, RelationDef>>;
    modelFields: Record<string, Record<string, ModelFieldMeta>>;
}
export declare const DEFAULT_METADATA: An5Metadata;
//# sourceMappingURL=metadata.d.ts.map
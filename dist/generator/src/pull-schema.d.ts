/** One column as `sys.columns`/`sys.types` describe it. */
export interface PulledColumn {
    columnName: string;
    dataType: string;
    maxLength: number;
    precision: number;
    scale: number;
    isNullable: boolean | number;
}
/**
 * The schema type of an introspected SQL Server column.
 *
 * `max_length` is bytes, so the character types divide it by two; `-1` is `MAX`.
 * Tables and views describe their columns the same way, so they share this.
 */
export declare function sqlServerTypeForColumn(col: PulledColumn): string;
/**
 * Where `keyword Name { ... }` starts and ends in a schema file.
 *
 * The closing brace is the one on its own line, not the first `}` anywhere: a
 * view's SQL may contain one (`WHERE name <> '}'`) and a regex that stops there
 * would truncate the block.
 */
export declare function blockRange(text: string, keyword: 'model' | 'view', name: string): {
    start: number;
    end: number;
} | null;
/** The additional key a schema block is known by, e.g. `reporting.active_users`. */
export declare function qualifiedBlockKey(name: string, schemaName: string | undefined): string;
/**
 * A likely block name for an introspected object.
 *
 * `db:pull` names a new block after the table or view, dropping the plural `s`
 * so `users` becomes `User`. A word that already ends in `s` but is singular
 * (`status`, `address`, `analysis`) must keep it: stripping the character turns
 * it into `Statu`, which reads like a typo in every generated client. Existing
 * blocks keep their own name, so this only decides what a newly pulled object is
 * called.
 */
export declare function blockNameForObject(objectName: string): string;
/**
 * A `view` block for a catalog view.
 *
 * `@@sql` gets the body, not the `CREATE VIEW` statement the catalog returns:
 * push and migrate add the `CREATE VIEW` themselves, so storing the header would
 * produce `CREATE OR REPLACE VIEW x AS CREATE VIEW ...`.
 */
export declare function buildViewBlock(input: {
    modelName: string;
    viewName: string;
    schemaName: string;
    columns: readonly PulledColumn[];
    definition: string | null | undefined;
}): string | null;

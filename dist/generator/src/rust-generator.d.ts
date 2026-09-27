import { Model } from './types';
export declare class RustGenerator {
    private outputDir;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private generateCargoToml;
    private generateLibRs;
    private generateFiltersRs;
    private generateModelsRs;
    private buildModelsBody;
    private generateMetadataRs;
    private generateConfigRs;
    private generateClientRs;
    /**
     * Typed, executing accessors for a model.
     *
     * Rust has no dynamic property access, so `db.user` cannot exist the way it
     * does in TypeScript or Python. Following the Go generator (which emits a
     * real `ctx.User` field), each model gets a generated method returning a
     * typed handle whose queries run through the an5-adapters runtime.
     */
    private buildModelRuntimeHandle;
    private isBoolField;
    private mapRustType;
    private getRustFilterType;
    private getAllPropertyVariations;
    private capitalize;
    private toCamelCase;
    private toSnakeCase;
}

import { Model } from './types';
export declare class DotnetGenerator {
    private outputDir;
    constructor(outputDir: string);
    generate(models: Model[]): void;
    private generateConfigClass;
    private mapType;
    private generateEntityClass;
    private generateDbContext;
    private capitalize;
}

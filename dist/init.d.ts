export type StarterTemplate = 'basic' | 'rag-vector' | 'api';
export declare function runInit(args: string[], rootDir?: string): string[];
export declare function runDev(args: string[], rootDir: string, resolveScript: (name: string) => string): void;

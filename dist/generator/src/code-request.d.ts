import type { Provider } from './field-types';
export declare const CODE_LANGUAGES: readonly ['typescript', 'python', 'dotnet', 'golang', 'rust'];
export type CodeLanguage = typeof CODE_LANGUAGES[number];
export interface CodeRequest {
    request: string;
    projectRoot: string;
    schemaPath: string;
    language?: CodeLanguage | 'auto';
    provider?: Provider;
    schemaFiles?: string[];
}
/** Detect only the selected project, never unrelated sibling packages. */
export declare function detectCodeLanguage(root: string): CodeLanguage;
/** Ground the caller's model in real generated APIs; never execute user code. */
export declare function prepareCodeRequest(input: CodeRequest): Promise<{
    status: 'context_ready';
    language: "dotnet" | "golang" | "python" | "rust" | "typescript";
    request: string;
    clientOutput: string;
    models: import("./types").Model[];
    files: {
        path: string;
        content: string;
    }[];
    instructions: string;
}>;

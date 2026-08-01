import { An5Metadata } from "./metadata";
type ExecutorFn = (queryText: string, params?: Record<string, any>) => Promise<any[]>;
export interface MiddlewareParams {
    model?: string;
    action: string;
    args: any;
    runInTransaction?: boolean;
}
export type MiddlewareNext = (params: MiddlewareParams) => Promise<any>;
export type Middleware = (params: MiddlewareParams, next: MiddlewareNext) => Promise<any>;
export declare class An5ORM {
    private customExecutor?;
    [key: string]: any;
    private middlewares;
    readonly metadata: An5Metadata;
    constructor(customExecutor?: ExecutorFn | undefined, metadata?: An5Metadata);
    $use(middleware: Middleware): void;
    parseWhere(modelName: string, where: any, params: Record<string, any>, prefix?: string): string;
    _executeMiddleware(params: MiddlewareParams, finalAction: (params: MiddlewareParams) => Promise<any>): Promise<any>;
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $queryRaw(queryParts: any, ...values: any[]): Promise<any[]>;
    $queryRawUnsafe<R = any>(queryText: string, ...values: any[]): Promise<R>;
    $executeRaw(queryParts: any, ...values: any[]): Promise<number>;
    $executeRawUnsafe(queryText: string, ...values: any[]): Promise<number>;
    $transaction<R>(fn: ((tx: any) => Promise<R>) | Promise<any>[], options?: {
        timeout?: number;
    }): Promise<any>;
}
export declare const an5Orm: An5ORM;
export default an5Orm;
//# sourceMappingURL=an5Orm.d.ts.map
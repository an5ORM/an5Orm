import { An5Adapter } from "@an5/adapters";
import { An5Metadata } from "./metadata";
type ExecutorFn = ((queryText: string, params?: Record<string, any>) => Promise<any[]>) & {
    executeRaw?: (queryText: string, params?: Record<string, any>) => Promise<number>;
    transaction?: <R>(fn: (txExecutor: ExecutorFn) => Promise<R>, options?: {
        timeout?: number;
    }) => Promise<R>;
    beginTransaction?: () => Promise<InteractiveTransactionExecutor>;
};
type InteractiveTransactionExecutor = {
    executor: ExecutorFn;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
};
export declare class TableClient<T = any> {
    private modelName;
    private executor;
    private orm;
    constructor(modelName: string, tableName: string, executor: ExecutorFn, orm: An5ORM);
    private tableName;
    private executeRaw;
    findMany(args?: any): Promise<T[]>;
    findFirst(args?: any): Promise<T | null>;
    findUnique(args?: any): Promise<T | null>;
    count(args?: any): Promise<number>;
    private scopedRelationWhere;
    private handleNestedWrites;
    create(args: any): Promise<T>;
    update(args: any): Promise<T>;
    updateMany(args: any): Promise<{
        count: number;
    }>;
    delete(args: any): Promise<T>;
    deleteMany(args?: any): Promise<{
        count: number;
    }>;
    vectorSearch(args: {
        vector: number[];
        take?: number;
        where?: any;
        include?: any;
        vectorField?: string;
        distanceMetric?: 'cosine' | 'euclidean' | 'dot';
        vectorElementType?: 'float32' | 'float16' | 'uint8';
    }): Promise<(T & {
        distance: number;
    })[]>;
    createMany(args: {
        data: any[];
        skipDuplicates?: boolean;
    }): Promise<{
        count: number;
    }>;
    aggregate(args: any): Promise<any>;
    groupBy(args: any): Promise<any[]>;
    private sequentialUpsert;
    upsert(args: any): Promise<T>;
}
export interface MiddlewareParams {
    model?: string;
    action: string;
    args: any;
    runInTransaction?: boolean;
}
export type MiddlewareNext = (params: MiddlewareParams) => Promise<any>;
export type Middleware = (params: MiddlewareParams, next: MiddlewareNext) => Promise<any>;
export declare class ViewClient<T = any> {
    viewName: string;
    rawTableName: string;
    executor: ExecutorFn;
    orm?: An5ORM | undefined;
    private tableClient;
    constructor(viewName: string, rawTableName: string, executor: ExecutorFn, orm?: An5ORM | undefined);
    findMany(args?: any): Promise<T[]>;
    findFirst(args?: any): Promise<T | null>;
    findUnique(args?: any): Promise<T | null>;
    count(args?: any): Promise<number>;
    aggregate(args?: any): Promise<any>;
    groupBy(args?: any): Promise<any[]>;
    vectorSearch(args: any): Promise<T[]>;
    create(): Promise<never>;
    createMany(): Promise<never>;
    update(): Promise<never>;
    updateMany(): Promise<never>;
    delete(): Promise<never>;
    deleteMany(): Promise<never>;
    upsert(): Promise<never>;
}
export declare class An5ORM {
    private readonly inTransaction;
    private transactionControl?;
    [key: string]: any;
    private middlewares;
    readonly metadata: An5Metadata;
    private customExecutor?;
    constructor(customExecutor?: ExecutorFn | An5Adapter | any, metadata?: An5Metadata, inTransaction?: boolean, transactionControl?: Pick<InteractiveTransactionExecutor, "commit" | "rollback"> | undefined);
    table(name: string): TableClient;
    view(name: string): ViewClient;
    $view(name: string): ViewClient;
    $queryProc<T = any>(procName: string, params?: Record<string, any> | any[]): Promise<T[]>;
    $executeProc(procName: string, params?: Record<string, any> | any[]): Promise<number>;
    $queryFunction<T = any>(fnName: string, params?: Record<string, any> | any[]): Promise<T[]>;
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
    $begin(): Promise<any>;
    $commit(): Promise<void>;
    $rollback(): Promise<void>;
}
export declare const an5Orm: An5ORM;
export default an5Orm;
//# sourceMappingURL=an5Orm.d.ts.map
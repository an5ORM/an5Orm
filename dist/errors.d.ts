/**
 * Core error types for AN5 ORM.
 * Owned by @an5/orm so generated clients can re-export the same class and
 * `instanceof` checks keep working across the ORM and its clients.
 */
export declare class An5ClientKnownRequestError extends Error {
    code: string;
    meta?: any;
    constructor(message: string, { code, clientVersion }: {
        code: string;
        clientVersion: string;
    });
}
//# sourceMappingURL=errors.d.ts.map
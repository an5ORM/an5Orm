"use strict";
/**
 * Core error types for AN5 ORM.
 * Owned by @an5/orm so generated clients can re-export the same class and
 * `instanceof` checks keep working across the ORM and its clients.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.An5ClientKnownRequestError = void 0;
class An5ClientKnownRequestError extends Error {
    constructor(message, { code, clientVersion }) {
        super(message);
        this.code = code;
    }
}
exports.An5ClientKnownRequestError = An5ClientKnownRequestError;
//# sourceMappingURL=errors.js.map
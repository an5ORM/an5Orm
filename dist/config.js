"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
/**
 * Workspace Configuration for an5Orm
 * Reads from an5Orm.config.js and environment variables.
 */
const path_1 = __importDefault(require("path"));
let workspaceConfig = {};
try {
    const configPath = path_1.default.join(__dirname, '..', 'an5Orm.config.js');
    workspaceConfig = require(configPath);
}
catch { /* ignore */ }
exports.config = {
    ...workspaceConfig,
    llm: workspaceConfig.llm || {
        providers: [],
    },
};
//# sourceMappingURL=config.js.map
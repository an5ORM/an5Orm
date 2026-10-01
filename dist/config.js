"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.ConfigError = exports.formatIssues = exports.resolveConnectionString = exports.resolveOutputs = exports.validateConfig = exports.loadConfig = void 0;
/**
 * Workspace Configuration for an5Orm
 *
 * Re-exported from the generator so the CLI commands and the generator agree on
 * one config shape. These files used to load an5Orm.config.js themselves with
 * `any`, which meant the four of them could disagree about what was valid.
 */
var config_1 = require("./generator/src/config");
Object.defineProperty(exports, "loadConfig", { enumerable: true, get: function () { return config_1.loadConfig; } });
Object.defineProperty(exports, "validateConfig", { enumerable: true, get: function () { return config_1.validateConfig; } });
Object.defineProperty(exports, "resolveOutputs", { enumerable: true, get: function () { return config_1.resolveOutputs; } });
Object.defineProperty(exports, "resolveConnectionString", { enumerable: true, get: function () { return config_1.resolveConnectionString; } });
Object.defineProperty(exports, "formatIssues", { enumerable: true, get: function () { return config_1.formatIssues; } });
Object.defineProperty(exports, "ConfigError", { enumerable: true, get: function () { return config_1.ConfigError; } });
Object.defineProperty(exports, "DEFAULT_CONFIG", { enumerable: true, get: function () { return config_1.DEFAULT_CONFIG; } });
//# sourceMappingURL=config.js.map
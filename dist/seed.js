"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function main() {
    const rootDir = process.cwd();
    const candidates = [
        path_1.default.join(rootDir, "seed.ts"),
        path_1.default.join(rootDir, "seed.js"),
        path_1.default.join(rootDir, "an5", "seed.ts"),
        path_1.default.join(rootDir, "an5", "seed.js"),
        path_1.default.join(rootDir, "scripts", "seed.ts"),
        path_1.default.join(rootDir, "scripts", "seed.js"),
    ];
    for (const seedPath of candidates) {
        if (fs_1.default.existsSync(seedPath)) {
            const relPath = path_1.default.relative(rootDir, seedPath);
            console.log(`🌱 Executing project seed script: ${relPath}...`);
            require(seedPath);
            return;
        }
    }
    console.log("⚠️  No project seed script found.");
    console.log("👉 Create a seed.ts or seed.js file in your project root or an5/ directory to seed your database.");
}
main().catch((err) => {
    console.error("❌ Seed execution failed:", err);
    process.exit(1);
});

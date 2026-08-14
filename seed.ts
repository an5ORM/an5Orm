import "dotenv/config";
import fs from "fs";
import path from "path";

async function main() {
  const rootDir = process.cwd();
  const candidates = [
    path.join(rootDir, "seed.ts"),
    path.join(rootDir, "seed.js"),
    path.join(rootDir, "an5", "seed.ts"),
    path.join(rootDir, "an5", "seed.js"),
    path.join(rootDir, "scripts", "seed.ts"),
    path.join(rootDir, "scripts", "seed.js"),
  ];

  for (const seedPath of candidates) {
    if (fs.existsSync(seedPath)) {
      const relPath = path.relative(rootDir, seedPath);
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

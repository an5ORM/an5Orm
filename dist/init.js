"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInit = runInit;
exports.runDev = runDev;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const TEMPLATES = {
    basic: {
        'User.an5': `model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}
`,
        'Post.an5': `model Post {
  id        String   @id @default(uuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
}
`,
    },
    'rag-vector': {
        'Document.an5': `model Document {
  id        String          @id @default(uuid())
  title     String
  source    String?
  chunks    DocumentChunk[]
  createdAt DateTime        @default(now())
}
`,
        'DocumentChunk.an5': `model DocumentChunk {
  id         String   @id @default(uuid())
  documentId String
  document   Document @relation(fields: [documentId], references: [id])
  content    String
  embedding  Vector(1536)
  createdAt  DateTime @default(now())
}
`,
    },
    api: {
        'User.an5': `model User {
  id        String    @id @default(uuid())
  email     String    @unique
  name      String?
  role      String    @default("member")
  sessions  Session[]
  items     Item[]
  createdAt DateTime  @default(now())
}
`,
        'Session.an5': `model Session {
  id        String   @id @default(uuid())
  token     String   @unique
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  createdAt DateTime @default(now())
}
`,
        'Item.an5': `model Item {
  id          String   @id @default(uuid())
  title       String
  description String?
  status      String   @default("draft")
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id])
  createdAt   DateTime @default(now())
}
`,
    },
};
function parseFlags(args) {
    let template = 'basic';
    let force = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg)
            continue;
        if (arg === '--force' || arg === '-f') {
            force = true;
        }
        else if (arg === '--template' || arg === '-t') {
            const next = args[i + 1];
            if (next && next in TEMPLATES) {
                template = next;
                i++;
            }
            else {
                throw new Error(`Unknown template "${next || ''}". Supported templates: ${Object.keys(TEMPLATES).join(', ')}.`);
            }
        }
        else if (arg.startsWith('--template=')) {
            const val = arg.slice('--template='.length);
            if (val in TEMPLATES) {
                template = val;
            }
            else {
                throw new Error(`Unknown template "${val}". Supported templates: ${Object.keys(TEMPLATES).join(', ')}.`);
            }
        }
    }
    return { template, force };
}
function writeIfMissing(filePath, content, force, created, rootDir) {
    if (fs_1.default.existsSync(filePath) && !force)
        return;
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, content, 'utf8');
    created.push(path_1.default.relative(rootDir, filePath));
}
function runInit(args, rootDir = process.cwd()) {
    const { template, force } = parseFlags(args);
    const created = [];
    const configContent = `module.exports = {
  connectionString: process.env.DATABASE_URL || 'sqlite:./dev.sqlite',
  schemaDir: './an5Schema',
  outputs: {
    typescript: './generated/an5-client',
  },
};
`;
    const hasConfig = fs_1.default.existsSync(path_1.default.join(rootDir, 'an5Orm.config.js')) || fs_1.default.existsSync(path_1.default.join(rootDir, 'an5Orm.config.cjs'));
    if (!hasConfig || force) {
        writeIfMissing(path_1.default.join(rootDir, 'an5Orm.config.js'), configContent, true, created, rootDir);
    }
    writeIfMissing(path_1.default.join(rootDir, '.env'), 'DATABASE_URL="sqlite:./dev.sqlite"\n', false, created, rootDir);
    const schemaDir = path_1.default.join(rootDir, 'an5Schema');
    const existingSchemas = fs_1.default.existsSync(schemaDir)
        ? fs_1.default.readdirSync(schemaDir).filter(f => f.endsWith('.an5'))
        : [];
    if (existingSchemas.length === 0 || force) {
        for (const [fileName, content] of Object.entries(TEMPLATES[template])) {
            writeIfMissing(path_1.default.join(schemaDir, fileName), content, force, created, rootDir);
        }
    }
    if (created.length === 0) {
        console.log('ℹ️  AN5 project is already initialized. Use --force to overwrite template files.');
    }
    else {
        console.log(`✅ Initialized AN5 sandbox (${template}) with:`);
        for (const file of created)
            console.log(`   - ${file}`);
    }
    return created;
}
function runSubcommand(scriptPath, args) {
    const isTs = scriptPath.endsWith('.ts');
    const runner = isTs ? (process.platform === 'win32' ? 'npx.cmd' : 'npx') : process.execPath;
    const runnerArgs = isTs ? ['tsx', scriptPath, ...args] : [scriptPath, ...args];
    const result = (0, child_process_1.spawnSync)(runner, runnerArgs, { stdio: 'inherit', env: process.env });
    if (result.error)
        throw result.error;
    if ((result.status ?? 0) !== 0) {
        process.exit(result.status ?? 1);
    }
}
function runDev(args, rootDir, resolveScript) {
    const hasConfig = fs_1.default.existsSync(path_1.default.join(rootDir, 'an5Orm.config.js')) || fs_1.default.existsSync(path_1.default.join(rootDir, 'an5Orm.config.cjs'));
    if (!hasConfig) {
        runInit(args, rootDir);
    }
    console.log('⚡ Syncing local sandbox database and generating client...');
    runSubcommand(resolveScript('push'), []);
    runSubcommand(resolveScript('generator'), []);
    console.log('🎉 AN5 dev sandbox is ready! Import your generated client from ./generated/an5-client.');
}

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export type StarterTemplate = 'basic' | 'rag-vector' | 'api';

const TEMPLATES: Record<StarterTemplate, Record<string, string>> = {
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

function parseFlags(args: string[]): { template: StarterTemplate; force: boolean } {
  let template: StarterTemplate = 'basic';
  let force = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--template' || arg === '-t') {
      const next = args[i + 1];
      if (next && next in TEMPLATES) {
        template = next as StarterTemplate;
        i++;
      } else {
        throw new Error(`Unknown template "${next || ''}". Supported templates: ${Object.keys(TEMPLATES).join(', ')}.`);
      }
    } else if (arg.startsWith('--template=')) {
      const val = arg.slice('--template='.length);
      if (val in TEMPLATES) {
        template = val as StarterTemplate;
      } else {
        throw new Error(`Unknown template "${val}". Supported templates: ${Object.keys(TEMPLATES).join(', ')}.`);
      }
    }
  }
  return { template, force };
}

function writeIfMissing(filePath: string, content: string, force: boolean, created: string[], rootDir: string): void {
  if (fs.existsSync(filePath) && !force) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  created.push(path.relative(rootDir, filePath));
}

export function runInit(args: string[], rootDir = process.cwd()): string[] {
  const { template, force } = parseFlags(args);
  const created: string[] = [];

  const configContent = `module.exports = {
  connectionString: process.env.DATABASE_URL || 'sqlite:./dev.sqlite',
  schemaDir: './an5Schema',
  outputs: {
    typescript: './generated/an5-client',
  },
};
`;
  const hasConfig = fs.existsSync(path.join(rootDir, 'an5Orm.config.js')) || fs.existsSync(path.join(rootDir, 'an5Orm.config.cjs'));
  if (!hasConfig || force) {
    writeIfMissing(path.join(rootDir, 'an5Orm.config.js'), configContent, true, created, rootDir);
  }

  writeIfMissing(
    path.join(rootDir, '.env'),
    'DATABASE_URL="sqlite:./dev.sqlite"\n',
    false,
    created,
    rootDir,
  );

  const schemaDir = path.join(rootDir, 'an5Schema');
  const existingSchemas = fs.existsSync(schemaDir)
    ? fs.readdirSync(schemaDir).filter(f => f.endsWith('.an5'))
    : [];
  if (existingSchemas.length === 0 || force) {
    for (const [fileName, content] of Object.entries(TEMPLATES[template])) {
      writeIfMissing(path.join(schemaDir, fileName), content, force, created, rootDir);
    }
  }

  if (created.length === 0) {
    console.log('ℹ️  AN5 project is already initialized. Use --force to overwrite template files.');
  } else {
    console.log(`✅ Initialized AN5 sandbox (${template}) with:`);
    for (const file of created) console.log(`   - ${file}`);
  }
  return created;
}

function runSubcommand(scriptPath: string, args: string[]): void {
  const isTs = scriptPath.endsWith('.ts');
  const runner = isTs ? (process.platform === 'win32' ? 'npx.cmd' : 'npx') : process.execPath;
  const runnerArgs = isTs ? ['tsx', scriptPath, ...args] : [scriptPath, ...args];
  const result = spawnSync(runner, runnerArgs, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function runDev(args: string[], rootDir: string, resolveScript: (name: string) => string): void {
  const hasConfig = fs.existsSync(path.join(rootDir, 'an5Orm.config.js')) || fs.existsSync(path.join(rootDir, 'an5Orm.config.cjs'));
  if (!hasConfig) {
    runInit(args, rootDir);
  }
  console.log('⚡ Syncing local sandbox database and generating client...');
  runSubcommand(resolveScript('push'), []);
  runSubcommand(resolveScript('generator'), []);
  console.log('🎉 AN5 dev sandbox is ready! Import your generated client from ./generated/an5-client.');
}

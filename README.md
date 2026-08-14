# @an5/orm

The Schema, Code Generator, and Migration Toolkit for the AN5 ecosystem.

## Overview

`@an5/orm` provides core schema parsing, multi-language code generation (TypeScript, Python, .NET C#, Golang), database introspection (`pull`), schema deployment (`push`), and automated database migrations.

Runtime database connections, query building, transactions, and multi-database drivers (MSSQL, PostgreSQL, MySQL, SQLite, Google Sheets) are powered by **[@an5/adapters](https://github.com/an5ORM/an5/tree/main/an5Adapters)**.

## Features

- **Schema Definition:** Define models and relationships using concise `.an5` syntax with native database types.
- **Multi-Language Generator:** Generate typed clients and entity models for TypeScript, Python, .NET (C#), and Golang.
- **Database Introspection (`db:pull`):** Inspect an existing database schema and generate matching `.an5` models.
- **Direct Schema Push (`db:push`):** Synchronize `.an5` schema definitions directly to the database.
- **Automated Migrations (`db:migrate`):** Diff schema against database, generate up/down migration SQL scripts, apply, rollback, and check migration status.
- **Seeding & Cleanup:** Generic runner for project seed scripts (`seed.ts`/`seed.js`) and database cleanup.
- **Seamless Adapter Integration:** Built-in connection support via `@an5/adapters`.

## Quick Start

### Installation

```bash
npm install @an5/orm @an5/adapters
```

### Configuration

Create `an5Orm.config.js` in your project root:

```javascript
module.exports = {
  // Schema directory (default: 'an5Schema')
  schemaDir: 'an5Schema',

  // Generated client outputs
  outputs: {
    typescript: {
      outputDir: 'an5Client/typescript',
      metadataFile: 'an5Client/typescript/an5Metadata.ts',
    },
    python: {
      outputDir: 'an5Client/python',
      metadataFile: 'an5Client/python/an5_metadata.py',
    },
    dotnet: {
      outputDir: 'an5Client/dotnet',
    },
    golang: {
      outputDir: 'an5Client/golang',
    },
  },

  // Database pull options
  pull: {
    exclude: ['^__', '^sys\\.', '^migrations'],
    preserveRelations: true,
  },
};
```

Configure your environment variables in `.env`:

```env
DATABASE_URL=sqlserver://localhost:1433;database=mydb;user=sa;password=Secret123!;encrypt=false
```

### CLI Commands

```bash
# Generate client code from .an5 schemas
npm run generate

# Push schema directly to database
npm run db:push

# Pull database schema into .an5 files
npm run db:pull

# Check schema diff
npm run db:migrate diff

# Generate new migration script
npm run db:migrate:generate

# Apply pending migrations
npm run db:migrate:apply

# Rollback last migration
npm run db:migrate:rollback

# View migration status
npm run db:migrate:status

# Run database seed script
npm run db:seed

# Clean up database tables
npm run db:cleanup
```

## Runtime Database Usage (via `@an5/adapters`)

To connect to your database and perform queries, use `@an5/adapters`:

```typescript
import { createAn5Adapter } from '@an5/adapters';

const db = createAn5Adapter({
  connectionString: process.env.DATABASE_URL!,
});

// Connect to database
await db.$connect();

// Table operations
const users = await db.table('User').findMany({
  where: { email: { contains: '@example.com' } },
  orderBy: { createdAt: 'desc' },
  take: 10,
});

// Create record
const newUser = await db.table('User').create({
  data: {
    email: 'alex@example.com',
    name: 'Alex',
  },
});

// Transactions
await db.$transaction(async (tx) => {
  await tx.exec('UPDATE Users SET active = 1 WHERE id = @p_0', { p_0: 'u1' });
});

// Disconnect
await db.$disconnect();
```

## Schema Definition (`.an5`)

```an5
model User {
  id        NVARCHAR(1000) @id @default(uuid())
  email     NVARCHAR(255)  @unique
  name      NVARCHAR(255)?
  createdAt DATETIME2      @default(now())
  orders    Order[]

  @@map("users")
}

model Order {
  id        NVARCHAR(1000) @id @default(uuid())
  userId    NVARCHAR(1000)
  total     INT            @default(0)
  user      User           @relation(fields: [userId], references: [id])

  @@map("orders")
}
```

## License

MIT

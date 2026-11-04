# @an5/orm

The Schema, Code Generator, and Migration Toolkit for the AN5 ecosystem.

## Overview

`@an5/orm` provides core schema parsing, multi-language code generation (TypeScript, Python, .NET C#, Golang, Rust), database introspection (`pull`), schema deployment (`push`), and automated database migrations.

Runtime database connections, query building, transactions, and multi-database drivers (MSSQL, PostgreSQL, MySQL, SQLite, Google Sheets) are powered by **[@an5/adapters](https://github.com/an5ORM/an5Adapters)**.

## Features

- **Schema Definition:** Define models and relationships using concise `.an5` syntax with native database types.
- **Multi-Language Generator:** Generate typed clients and entity models for TypeScript, Python, .NET (C#), Golang, Rust, Java, Kotlin, and Swift.
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

You can run AN5 commands directly using `npx @an5/orm` (or `npx an5`):

```bash
# Generate client code from .an5 schemas
npx @an5/orm generate
# or: npx an5 generate

# Push schema directly to database
npx @an5/orm db:push

# Pull database schema into .an5 files
npx @an5/orm db:pull

# Check schema diff
npx @an5/orm db:migrate diff

# Generate new migration script
npx @an5/orm db:migrate generate

# Apply pending migrations
npx @an5/orm db:migrate apply

# Rollback last migration
npx @an5/orm db:migrate rollback

# View migration status
npx @an5/orm db:migrate status

# Run database seed script
npx @an5/orm db:seed

# Clean up extra tables and views
npx @an5/orm db:cleanup
```

You can also add these commands to your project's `package.json` scripts:

```json
{
  "scripts": {
    "generate": "an5 generate",
    "db:push": "an5 db:push",
    "db:pull": "an5 db:pull",
    "db:migrate": "an5 db:migrate",
    "db:seed": "an5 db:seed",
    "db:cleanup": "an5 db:cleanup"
  }
}
```

Then run them with `npm run generate`, `npm run db:push`, etc.

## Runtime Database Usage (via `@an5/adapters`)

To connect to your database and perform queries, use `@an5/adapters`:

```typescript
import { createAn5Adapter } from '@an5/adapters';

const db = createAn5Adapter({
  connectionString: process.env.DATABASE_URL!,
});

// Connect to database
await db.$connect();

// Model operations
const users = await db.user.findMany({
  where: { email: { contains: '@example.com' } },
  orderBy: { createdAt: 'desc' },
  take: 10,
});

// Create record
const newUser = await db.user.create({
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

Field types are validated against the database you are generating for. The provider
comes from the connection string (`DATABASE_URL` first, then `connectionString` in
`an5Orm.config.js`): `sqlserver://` (and the fallback) is SQL Server, `postgres://`
PostgreSQL, `mysql://` MySQL, `sqlite://` SQLite, `googlesheets://` Google Sheets.
A type the provider does not have stops generation with every offending field
listed at once — see `PROVIDER_FIELD_TYPES` in `generator/src/field-types.ts`.

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

Views are declared with the same field syntax, so generated clients can type their
rows, plus the `SELECT` that defines them. A view is read-only: writes are not
generated, and `db:push`/`db:migrate` create the view after the tables it reads —
and after any view it reads. `db:pull` writes a database view back as a `view`
block, with its columns and the SQL body from the catalog. `db:cleanup` drops
views that are no longer in the schema, before the tables they might read.

`@@sql` holds the `SELECT` body; a full `CREATE VIEW ... AS ...` statement pasted
from a catalog is reduced to that body, so its header and object name are not
repeated in the generated DDL.

Generated clients expose a view through a read-only client — `ViewClient` in
TypeScript, Python, .NET, Java and Kotlin, `ViewModelClient` in Swift, and
`ViewClient[T]` in Go and Rust. Those types have the read methods only, so a write
to a view is rejected at compile time rather than by the database.

```an5
view ActiveUser {
  id    NVARCHAR(1000)
  email NVARCHAR(255)

  @@map("active_users")
  @@sql("SELECT id, email FROM users WHERE active = 1")
}
```

A longer query can be written over several lines with triple quotes; the indentation
shared by the SQL lines is removed before it reaches the database:

```an5
view ActiveUser {
  id    NVARCHAR(1000)
  email NVARCHAR(255)

  @@map("active_users")
  @@sql("""
    SELECT id, email
    FROM users
    WHERE active = 1
  """)
}
```

## License

MIT

## Schema-grounded code requests

The `@an5/orm/generator` export `prepareCodeRequest({ request, projectRoot, schemaPath, language: 'auto' })` returns `context_ready` with schema models and real generated API references for the caller's AI model. It generates reference files in temporary storage and cleans them afterward. `detectCodeLanguage` reads language manifests in the selected project directory and rejects ambiguous or missing markers. This API does not call an LLM, execute queries, or write application code.

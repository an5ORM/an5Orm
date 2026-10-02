# Changelog

## [Unreleased]

### Added
- **Field types are validated per database provider** — the provider comes from the
  connection string (`DATABASE_URL` first, then `connectionString`), the same way
  `An5Adapter` picks its engine, and each provider has its own table of types in
  `generator/src/field-types.ts`. One shared list used to cover every database, so a
  type from the wrong provider passed validation and only failed at DDL time.
- **`db:push` writes the DDL of the provider it is connected to** — SQL Server,
  PostgreSQL, MySQL and SQLite each get their own quoting, catalog lookups, defaults
  and identity syntax through `generator/src/dialect.ts`. Before, every provider
  received SQL Server T-SQL and `sys.*` queries. Google Sheets reports that there is
  no DDL to send, since a sheet is a range of cells.
- **Every bad field type is reported at once**, with the provider and a "did you
  mean", instead of generating code with an `any` type or turning the token into a
  relation to a model that does not exist.

### Fixed
- **A schema for another database generated `dbo` table names** — the default schema
  was SQL Server's for every provider, so a SQLite or PostgreSQL project generated
  `[dbo].[users]` and every query failed (`no such table: dbo.users`, or invalid SQL on
  PostgreSQL). Those providers now get the bare name and let the adapter quote it per
  dialect, which all five clients already do. SQL Server output is unchanged.
- **`db:migrate` ignored `@@schema`** — the directive was dropped here while `db:push`
  and the generators honoured it, so a migration created the table in the connection's
  default schema and the client then read the one the schema file named.
- **`db:push` dropped columns silently** — SQLite types such as `INTEGER`,
  `BOOLEAN` and `BLOB` were generated into the client but not in the list
  `db:push` checked, so the column was never created and nothing said so.
- **`@default(autoincrement())` produced invalid SQL** — it was emitted as
  `INT DEFAULT IDENTITY(1,1)`; identity is a property of the column type, so it is
  now `INT IDENTITY(1,1)`. SQLite is checked up front, because it only
  auto-increments an `INTEGER PRIMARY KEY`.
- **`db:push` made a required column nullable** — `ALTER TABLE ... ADD` appended
  `NULL` to a column the schema marks required; the branch meant to emit
  `NOT NULL` sat behind an `else` that could not be reached.
- **A defaulted column was created nullable** — the presence of a `DEFAULT` was
  read as "nullability does not matter", so `createdAt DATETIME2 @default(now())`
  could still be left empty.
- **`@@schema("")` was ignored by `db:push`** — the directive exists for databases
  with no schemas, and push dropped it. `@@schema("main")` was ignored too, so the
  table landed in the connection's default schema while the generated client read
  the schema the schema file named.
- **`@@unique([a, b], map: "...")` was dropped by `db:push`** — the reader required
  the closing parenthesis right after the bracket, so a mapped directive was ignored
  while `db:migrate` still honoured it.
- **`db:pull` could write a schema that could not be generated again** — `sysname`
  and `timestamp` were not valid field types, so a column declared that way produced
  a `.an5` file the next `generate` rejected.
- **A relative config path lost the config** — `loadConfig('.')` found the file and
  then required it by bare name, which Node reads as a package, so the config was
  silently dropped.
- **A `.sqlite3` file was treated as SQL Server by the adapter** — the ORM read the
  provider as SQLite and wrote SQLite DDL, which the adapter then sent to SQL Server.
  Both now accept `.sqlite3` and both compare the scheme case-insensitively.
- **Connection strings with capitalised schemes were misread** — `MySQL://` selected
  SQL Server. A URI scheme is case-insensitive.

### Fixed
- **The published types required `@types/node`** — three exported functions took
  `NodeJS.ProcessEnv`, and a parameter type lands verbatim in the emitted `.d.ts`, so
  anything compiling against this package without `@types/node` was told to install
  it. They take a plain `Record<string, string | undefined>` now, and a test fails the
  build if a Node type reaches a declaration again.
- **The Go client generated every numeric column as a `string`** — the generators
  receive the TypeScript type, which is `number` for `INT`, `FLOAT` and `DECIMAL`
  alike, and the Go type table matched none of those. A Go client could only insert
  `"10"` into an `INT` column. The declared type now decides, through one shared
  resolver, in all four statically typed generators: `DECIMAL` is a `float`/`decimal`
  rather than an integer, and a `BIGINT` is 64-bit.
- **MySQL's `BIT` was a number in the TypeScript client and a boolean in the other
  four** — every other dialect's `BIT` is a boolean here, and `BIT` is a flag in
  practice, so it now is one everywhere.
- **`db:push` and `db:migrate` could name the same constraint differently** — `map:`
  on `@@unique([a, b], map: "UQ_x")` was read by `db:migrate` and ignored by `db:push`,
  which invented `UQ_<table>_compound_0`. Push created one constraint, the next
  migration kept trying to add the other. Both now use the mapped name, and the
  unnamed form still derives the same one in each.
- **A mapped table name containing a dot was read as a schema** — `@@map("reports.daily")`
  became `reports.daily` and so `[reports].[daily]`. The schema now comes from
  `@@schema` alone, composed once the model has been read, in either directive order.
- **A tool inventing a type named SQL Server types for any database** — the ORM exposes
  `defaultSqlTypeForTs`, so a project on another provider gets `VARCHAR(255)`,
  `TIMESTAMPTZ` or `TEXT` rather than `NVARCHAR(255)` and `BIT`, which the ORM's own
  validator then rejected.

### Changed
- **Generated numeric types are correct now, which is breaking for Rust consumers** —
  an `INT` column generates `i32` where it generated `i64` before, because the same
  bug put every numeric type in the 64-bit branch. Regenerate and fix the call sites.
- **A type the provider does not have is now an error** — this is the point of the
  change, and it is breaking for schemas that relied on the shared list. Replace
  `BOOLEAN` with `BIT` on SQL Server, `DATETIME2` with `DATETIME` on SQLite or MySQL,
  `INT` with `INTEGER` on PostgreSQL, and so on; the error names each field and the
  provider so the whole schema can be fixed in one pass.
- **`db:pull`, `db:migrate:*` and `db:cleanup` still require SQL Server** and now say
  so instead of failing inside the driver. `db:push` and `db:seed` are unaffected.

## [1.0.13] - 2026-10-02

### Added
- **`connectionString` in an5Orm.config.js** — db:push, db:pull, db:migrate:* and
  db:cleanup can take the connection from the config file. `DATABASE_URL` still
  wins, so a committed config can point at a development database while CI
  supplies its own. `db:pull` and `db:cleanup` previously passed
  `process.env.DATABASE_URL!` straight into the adapter with no check, so a
  missing variable surfaced as a crash inside the adapter rather than a message
  saying what was not set.
- **The config file is typed and validated** — it used to be read as `any`, with
  every field falling back through `config.outputs?.typescript?.outputDir ||
  'default'`. A typo like `outputDirs` was not an error; generation quietly
  wrote to the default directory while the config said otherwise. Every key is
  now known, every value has an expected type, and problems are reported
  together with a "did you mean" for a mistyped key.
- **SQLite for the generated .NET client** — the client works against
  `DbConnection`/`DbCommand` and picks the provider from the connection string,
  so MSSQL, Postgres and SQLite all work from one generated file. It also
  fixes the client for Postgres, which was generated as SQL Server only.
  `SELECT TOP 1` becomes `LIMIT 1` where needed, and the generated `dbo.` table
  prefix is stripped for SQLite, which has no schemas.

### Fixed
- **The PyPI version had drifted from the npm version** — `pyproject.toml`
  carried its own `version`, and nothing compared it to `package.json`. PyPI
  still held 1.0.9 while npm had reached 1.0.12, so the publish job built the
  old version and skipped it as already published: PyPI had not received a new
  release through this pipeline at all. Both are at 1.0.12 now, and
  `test/version-sync.test.js` fails the build if they disagree again.
- **The CLI commands are type-checked** — `tsconfig.json` excludes push, pull,
  migrate and cleanup because they run through tsx, so no compiler ever looked at
  them. A call to a function deleted from another file reached the live-DB job
  and failed there with `requireDatabaseUrl is not defined`, long after the
  change that removed it. `tsconfig.cli.json` checks them, and `test` runs it
  first.
- **`$queryRawUnsafe<any[]>` in db:pull and db:cleanup** — the generic argument
  is the row type, so this typed every row as an array and made `row.tableName`
  an error the compiler never saw. Both files also dereferenced `DATABASE_URL`
  with no check, so an unset variable crashed inside the adapter.
- **`generation.generateMetadata` is now read** — it was documented and defaulted
  but nothing consulted it. `generation.generateComments` is removed instead of
  left in place: no generator emitted comments, so the option promised something
  that did not happen.
- **The four CLI commands share one config loader** — each had its own copy of
  the unvalidated load, so they could disagree about what the file meant.
- **Row materialisation converts values** — `SetValue` was called with whatever
  the provider returned, so a `DateTime` property failed against SQLite's TEXT
  and an `int` property against its Int64. Conversion now matches the adapter's.

## [1.0.11] - 2026-10-01

- fix(ci): let `publish-npm` install without a lockfile, so a v* tag can actually reach `npm publish`
- chore: ignore `.npmrc`

## [1.0.10] - 2026-10-01

- fix(pack): verify the npm tarball before publishing, so a missing generator file can no longer ship again
- fix(build): stop ignoring the committed `dist/`, which silently dropped new build output from commits
- fix(build): normalise emitted files to LF, since TypeScript 7 ignores `newLine`

## [1.0.9] - 2026-08-19

- chore: update misc, build

## [1.0.8] - 2026-07-31

- chore: update build

## [1.0.7] - 2026-07-31

- chore: update misc

## [1.0.6] - 2026-07-31

- chore: update misc, generator

## [1.0.1] - 2026-07-05

- chore(readme): simplify and condense content


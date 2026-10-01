# Changelog

## [1.0.12] - 2026-10-01

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


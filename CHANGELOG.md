# Changelog

## [1.0.12] - 2026-10-01

### Added
- **SQLite for the generated .NET client** — the client works against
  `DbConnection`/`DbCommand` and picks the provider from the connection string,
  so MSSQL, Postgres and SQLite all work from one generated file. It also
  fixes the client for Postgres, which was generated as SQL Server only.
  `SELECT TOP 1` becomes `LIMIT 1` where needed, and the generated `dbo.` table
  prefix is stripped for SQLite, which has no schemas.

### Fixed
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


# Changelog

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


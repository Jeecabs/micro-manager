# Contributing

Bug reports, focused fixes, tests, and documentation improvements are welcome.

## Before you start

For a substantial behavior or interface change, open an issue before writing code. Describe the problem, expected behavior, and proposed scope. This avoids work on changes that do not fit the project.

Do not include credentials, private transcripts, or proprietary source code in issues, fixtures, or logs.

## Development

Requirements:

- Node.js 22.12.0 or later
- pnpm 10.28.2

Install dependencies and run the full verification suite:

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the TypeScript check, tests, and an npm package dry run.

## Pull requests

- Keep each pull request focused on one change.
- Add or update tests for behavior changes.
- Update user-facing documentation when behavior or configuration changes.
- Run `pnpm verify` before requesting review.
- Explain both what changed and why.
- Keep generated files and unrelated formatting changes out of the diff.

By submitting a contribution, you agree that it is licensed under this repository's MIT License.

# Contributing to `@adfinia/sdk-web`

Thanks for considering a contribution. This SDK ships to thousands of
customer sites, so we keep the bar high on tests and bundle size.

## Local setup

```bash
git clone https://github.com/infinia-net/adfinia-web-sdk
cd adfinia-web-sdk
npm install
npm test
npm run build
```

## Workflow

1. Open an issue first for anything larger than a bug fix or doc tweak —
   API additions need to land in iOS, Android, RN, and Flutter at the same
   time.
2. Branch from `main` as `feat/<short-name>` or `fix/<short-name>`.
3. Write a test. PRs that change behaviour without a test will be sent
   back.
4. Run `npm run typecheck && npm test && npm run build` locally.
5. Keep the bundle under 10 KB minified + gzipped. `npm run size` prints
   the dist sizes.
6. Open a PR. The CI workflow runs lint, typecheck, tests, and the build
   on Node 18 + 20.

## Commit messages

We use Conventional Commits:

- `feat: ...` — new feature
- `fix: ...` — bug fix
- `docs: ...` — README / comment changes
- `chore: ...` — build/CI/tooling
- `refactor: ...` — code change with no behaviour change
- `test: ...` — test-only

## Releasing

Maintainers only. See `RELEASING.md` (TODO — gated on npm org account
provisioning).

## Code style

- TypeScript strict mode. No `any` without a `// eslint-disable-next-line`
  with a comment.
- One concept per file. The `src/` layout is intentional — copy the
  pattern.
- Public API stays in `src/index.ts` and `src/types.ts`. Everything else
  is internal.

## Reporting security issues

Please **do not** open a public issue. Email
`security@adfinia.com` with details and we'll respond within one business
day.

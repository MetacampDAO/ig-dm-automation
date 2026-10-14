# Contributing

Small, focused pull requests are easiest to review.

## Run the checks

```bash
npm install
npm test            # vitest, in-memory repository, no network
npm run typecheck   # tsc --noEmit
npm run build       # next build (set the env from .env.example; META_MOCK=1 is fine)
```

All three must pass before you open a PR.

## Ground rules

- **No secrets.** Never commit `.env*` files, tokens, keys, real user IDs or real account handles. Use `example.com` and `yourhandle` in tests, fixtures and docs.
- **Keep the `META_MOCK` fixtures working.** Tests run against `META_MOCK=1` and the JSON in `tests/fixtures/`. If Meta's payload shape changes, update the fixture and the parser together, and say where the real shape was verified.
- **No new dependencies** without a clear reason in the PR description.
- Match the existing style (compact TypeScript, zod at boundaries, server actions) and keep unrelated reformatting out of the diff.
- Behaviour that gates sending (windows, approvals, one active campaign per post, opt-out, signature checks) needs a test.
- Commit messages: `type(scope): description` in the present tense, for example `fix(flow): skip reply when conversation is paused`.

## PR checklist

- [ ] `npm test`, `npm run typecheck` and `npm run build` pass
- [ ] No secrets, personal handles or live URLs added
- [ ] Tests added or updated for changed behaviour
- [ ] Docs and `.env.example` updated if setup steps or env vars changed
- [ ] Security-relevant changes are called out in the description

---
name: Playwright E2E runner
description: runTest callback is permanently blocked. Use bash to run playwright tests directly.
---

# Running Playwright E2E tests

## The rule
The built-in `runTest` callback is permanently blocked (due to a prior failed OIDC test attempt). Always run Playwright tests via bash:

```bash
cd scripts && pnpm exec playwright test --config playwright.config.ts
```

## Key files
- Config: `scripts/playwright.config.ts`
- Specs: `scripts/src/e2e/*.spec.ts`
- Dev login: `GET /api/dev/test-login?user_id=X&return_to=/` (dev only, creates user+household+session)

## Session cookie
The dev test-login sets cookie `sid` (the `SESSION_COOKIE` constant from `lib/auth.ts`). The CORS config must allow `http://localhost` in dev (see cors-e2e-localhost.md).

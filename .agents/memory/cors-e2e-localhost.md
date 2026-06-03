---
name: CORS localhost for E2E tests
description: Playwright browser sends Origin: http://localhost which was blocked by CORS middleware, breaking all cross-origin API mutations in tests.
---

# CORS: localhost blocked in E2E tests

## The rule
In `artifacts/api-server/src/app.ts`, the CORS `origin` callback must explicitly allow `http://localhost` (and any port) in non-production environments.

## Why
Playwright's headless Chromium sends `Origin: http://localhost` for all requests. The CORS config checks an allowlist built from `REPLIT_DOMAINS` + `REPLIT_DEV_DOMAIN`. Localhost is not in either, so all cross-origin requests from Playwright fail with "CORS: origin http://localhost not allowed". GET requests may still reach the server but JS cannot read the response; POST/PATCH/DELETE preflights fail entirely.

## How to apply
The fix is already in `app.ts`:
```typescript
const isLocalhost = !isProduction && /^https?:\/\/localhost(:\d+)?$/.test(origin);
if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || isLocalhost) {
  callback(null, true);
}
```
Never remove or relax the `!isProduction` guard.

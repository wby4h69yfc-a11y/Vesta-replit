---
name: React Query staleTime 30s
description: QueryClient has staleTime=30s. Test data seeded after first page load won't be fetched again within 30s.
---

# React Query staleTime = 30 seconds

## The rule
The global QueryClient (`App.tsx`) has `staleTime: 30_000`. Any data fetched within the last 30 seconds is treated as "fresh" and will NOT be refetched when a component remounts.

## Why
If an E2E test seeds data AFTER the browser has already loaded and fired queries (e.g. patterns → []), React Query will use the cached empty result for 30 more seconds. The component sees count=0 and the UI element never appears.

## How to apply
In E2E tests: seed all required data (household, user, patterns, etc.) BEFORE calling `loginAsTestUser` or any step that causes the browser to load. Use direct DB inserts so the API's first fetch returns the seeded data.

Pattern in tests:
```typescript
// ✅ Seed first, then let browser load
const hh = await insertHousehold(db);
await insertUser(db, uid, hh);
await seedPattern(db, hh, key);
await loginAsTestUser(page, uid);  // browser first fetch sees the data
```

---
name: AppDashboard is the /app route
description: The /app route renders AppDashboard.tsx, not Hoje.tsx. Hoje.tsx exists but is unrouted.
---

# /app → AppDashboard, not Hoje

## The rule
`artifacts/vesta/src/pages/AppDashboard.tsx` is the component rendered at `/app`. `Hoje.tsx` is NOT routed anywhere — it is effectively dead code.

## Why
App.tsx routes `/app` → `AppDashboard`. Any feature that should appear on the "Hoje" dashboard (PatternNudge, activity feed, etc.) must be added to `AppDashboard.tsx`, not `Hoje.tsx`.

## How to apply
When implementing anything for the main dashboard page, open `AppDashboard.tsx`. If you see `PatternNudge` or other components only in `Hoje.tsx`, they are invisible to users.

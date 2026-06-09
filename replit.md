# Vesta — Family Logistics OS for Brazil

A full-stack family logistics assistant that organises household tasks, school messages, health appointments and diarista coordination, primarily via WhatsApp.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 / 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — cookie signing
- WhatsApp BSP env: `WA_BSP` (`"twilio"` default or `"360dialog"`), then per-BSP:
  - Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`
  - 360Dialog: `DIALOG360_API_KEY`, `DIALOG360_WHATSAPP_NUMBER`, `DIALOG360_HUB_SECRET` (HMAC secret, production only)
- LLM env: `LLM_PROVIDER` — active LLM provider (`openai` | `anthropic` | `gemini` | `openrouter`; default `openai`); `LLM_MODEL` — override the model for the chosen provider (defaults: openai→`gpt-4o-mini`, anthropic→`claude-3-5-haiku-20241022`, gemini→`gemini-2.0-flash`, openrouter→`openai/gpt-4o-mini`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`, port 8080, mounted at `/api`)
- Frontend: React + Vite + Tailwind CSS v4 + shadcn/ui (`artifacts/vesta`, mounted at `/`)
- Auth: Replit OIDC/PKCE — `lib/replit-auth-web` (web hook), `artifacts/api-server/src/lib/auth.ts`
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- Router: wouter
- Data fetching: TanStack Query + Orval-generated hooks

## Where things live

- `lib/db/src/schema/` — DB schema source of truth
  - `auth.ts` — users + sessions (Replit OIDC)
  - `memory.ts` — household memory: places, routines, preferences, memory_staging, onboarding_state
  - `contacts.ts` — external contacts + LGPD consent columns
  - `members.ts` — household members (adults + children) with school/medical fields
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all API shapes)
- `lib/api-client-react/src/generated/` — Orval-generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — Orval-generated Zod schemas (do not edit)
- `artifacts/vesta/src/pages/` — all app pages
- `artifacts/vesta/src/components/Layout.tsx` — 4-tab shell (Hoje, Caixa, Agenda, Casa)
- `artifacts/api-server/src/routes/` — all API routes

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed React hooks + Zod schemas. Never hand-write API hooks.
- Auth is Replit OIDC with cookie-based sessions. `authMiddleware` attaches `req.user` when session is valid; routes remain public by default, guard explicitly where needed.
- 4-tab mobile-first navigation: Hoje (`/app`), Caixa (`/inbox`), Agenda (`/calendar`), Casa (`/casa`). Desktop sidebar mirrors the same 4 tabs.
- `Casa` page consolidates household settings, family management, diarista consent flow (LGPD-compliant), and privacy/data controls — no separate settings page.
- LGPD: diarista contacts require explicit WhatsApp consent before any messages are sent. Consent status is tracked on the `contacts` table.
- Freemium gate: free = 3 categories, 2 adults+1 child, 3 rules. Premium R$24.90/mo or R$199/yr.

## Product

- **Hoje**: personalised daily briefing with inbox actions, agenda and upcoming tasks.
- **Caixa de entrada**: review and approve/reject AI-classified messages forwarded via WhatsApp.
- **Agenda**: calendar view for household events.
- **Casa**: household settings, member management, diarista coordination, privacy dashboard.
- **Onboarding**: 8-step welcome flow collecting household composition, WhatsApp channel, Google Calendar.

## User preferences

- Brand colours: `--primary: #0E3B2E` (forest green), bg `#F7F4EA` (ivory), card `#FFFDF6` (cream). Keep green palette — do not switch to terracotta without asking.
- Portuguese (pt-BR) throughout all UI copy.
- Mobile-first — 4 bottom-tab navigation.

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`.
- Always run `pnpm --filter @workspace/db run push` after changing DB schema files.
- Do NOT run `pnpm dev` at the workspace root — it has no dev script. Use `restart_workflow`.
- `lib/replit-auth-web` must NOT use `import.meta.env` — it's compiled with plain `tsc`, not Vite.
- api-server tsconfig has `"noImplicitReturns": false` — Express route handlers legitimately return void from catch blocks.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See the `replit-auth` skill for auth setup details

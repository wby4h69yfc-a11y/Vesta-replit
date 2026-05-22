# Threat Model

## Project Overview

Vesta is a family logistics assistant for Brazilian households. The production system is a React frontend (`artifacts/vesta`) backed by an Express API (`artifacts/api-server`) with PostgreSQL/Drizzle storage and Replit OIDC, OTP, and optional social login. The API also ingests sensitive communications from Twilio WhatsApp webhooks and Google Calendar/Gmail sync.

Production assumptions for this scan:
- Only `artifacts/api-server`, `artifacts/vesta`, shared libraries under `lib/`, and deployed configuration are in scope.
- `artifacts/mockup-sandbox` is dev-only and should be ignored unless production reachability is later demonstrated.
- Replit deployment provides TLS in production.
- `NODE_ENV=production` in production.
- The current deployment is `private`, so Replit blocks direct public-internet access to endpoints. Anonymous internet abuse of nominally public routes is therefore reduced in the current deployment, but vulnerabilities reachable by deployment-authorized users, insider users, or trusted third-party callbacks remain in scope.

## Assets

- **User accounts and sessions** — Replit OIDC identities, OTP-authenticated accounts, social-login accounts, session IDs in the `sessions` table, and bearer-token use for mobile flows. Compromise enables impersonation.
- **Household operational data** — household profile, members, tasks, events, inbox items, suggested actions, rules, patterns, and audit history. This includes schedules, family relationships, school/medical context, and other sensitive household logistics.
- **Third-party communication content** — WhatsApp message bodies, sender phone numbers, media URLs, Gmail snippets, calendar events, and imported WhatsApp chat exports. This is high-sensitivity personal data and often includes third-party PII.
- **Integration credentials** — Google OAuth refresh/access tokens, Twilio credentials, database connection string, and OIDC configuration/secrets.
- **Consent and compliance records** — diarista contact details and LGPD consent fields stored in `contacts`.

## Trust Boundaries

- **Browser/mobile client → API** — all frontend and mobile requests cross this boundary. The client is untrusted; authentication and authorization must be enforced server-side.
- **API → PostgreSQL** — API code has broad database access. Any missing authorization or tenant scoping at the route layer becomes direct data exposure or tampering.
- **API → external identity providers** — OIDC, Google, and Apple callbacks cross a trust boundary and must validate tokens, state, and callback context.
- **API → Twilio / public webhook callers** — `/api/webhook/whatsapp` is designed as a public callback surface and must authenticate the sender before treating inbound data as trusted. In the current private deployment, public reachability is reduced by platform visibility controls, but the endpoint still represents a trust boundary whenever external delivery is enabled.
- **Authenticated user → household data** — household resources must be scoped to the correct authenticated user and household membership. Cross-household reads and writes are high impact.
- **Internal production surface → dev-only artifacts** — `artifacts/mockup-sandbox` is excluded from production threat analysis unless later wired into deployed routes.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*.ts`, `artifacts/vesta/src/App.tsx`.
- **Highest-risk code areas:** `artifacts/api-server/src/routes/` (authz and public routes), `artifacts/api-server/src/routes/webhook.ts`, `artifacts/api-server/src/routes/auth*.ts`, `artifacts/api-server/src/routes/google.ts`, `artifacts/api-server/src/lib/wa-message-processor.ts`, `artifacts/api-server/src/lib/wa-approval-handler.ts`, `artifacts/api-server/src/lib/classifier.ts`, `lib/db/src/schema/*`.
- **Public vs authenticated surfaces:** business routes are currently mounted behind a protected router that applies `requireAuth` and `requireHousehold`; the nominally public surfaces that still need careful review are auth routes, OTP routes, social-login callbacks, and the Twilio webhook, but the current `private` deployment means exploitation should be judged based on deployment-authorized access rather than anonymous public reachability.
- **Dev-only surface usually ignored:** `artifacts/mockup-sandbox/**`.

## Threat Categories

### Spoofing

The application accepts authentication from Replit OIDC, OTP-by-phone, Google sign-in, Apple sign-in, and Twilio webhook traffic. Production routes that rely on these identities must verify that the caller is who they claim to be. Sessions must remain unguessable, OTP flows must resist brute force, and public callbacks/webhooks must verify provider authenticity before creating or modifying household data.

Required guarantees:
- Protected API routes MUST require a valid authenticated session or equivalent bearer token.
- OTP login MUST rate-limit issuance and verification attempts strongly enough to prevent account takeover.
- Public webhook and callback endpoints MUST validate provider signatures or token proofs before trusting inbound data.
- OAuth `state` and similar callback correlation values MUST NOT be live bearer credentials or account selectors, and callback results MUST be bound to the initiating authenticated user.

### Tampering

Household tasks, events, contacts, inbox items, rules, and patterns are all mutable business records. The server must ensure callers can only modify the records belonging to their own household. Any route that writes data without auth or tenant checks allows attackers to alter household state, inject fake communications, or trigger downstream automation.

Required guarantees:
- Every state-changing household route MUST enforce authentication and household membership server-side.
- Business objects MUST be written with the correct household/user scope rather than relying on implicit defaults.
- External inbound data MUST be authenticated before it can create inbox items, tasks, events, or suggested actions.
- Webhook sender identity MUST be matched using exact normalized identifiers rather than lossy partial-phone comparisons that can collide across households.
- WhatsApp approval or undo commands MUST be bound to both an authorized sender and a specific action, not just to the household as a whole.
- External-provider identifiers used for sync or deduplication (for example Google event IDs) MUST be scoped to the owning household or account, not treated as globally tenant-agnostic keys.

### Information Disclosure

Vesta stores sensitive household schedules, children and family member data, school/medical context, contact lists, Gmail snippets, and WhatsApp messages. Because the product is multi-user and family-oriented, exposure of one household’s data to another user is a severe privacy breach.

Required guarantees:
- Every read of household data MUST be scoped to the authenticated user’s authorized household(s).
- Integration tokens and message contents MUST never be exposed through unauthenticated endpoints or overbroad queries.
- API responses and logs MUST avoid leaking secrets or unnecessary personal data.
- Outbound WhatsApp messages to non-household contacts MUST enforce the stored consent state before any message is sent.

### Denial of Service

The app exposes public login, OTP, and webhook endpoints and performs external API work plus classification. Attackers can abuse these to create operational load, spam outbound OTP delivery, or fill the inbox with junk unless requests are bounded and authenticated where possible.

Required guarantees:
- Public authentication and webhook endpoints MUST enforce rate limits and request validation.
- Expensive external sync and classification paths MUST only be triggerable by authorized users or verified providers.
- Request bodies and loops over imported data MUST remain bounded enough to prevent trivial resource exhaustion.
- Re-triggerable outbound messaging and sync endpoints MUST enforce idempotency and/or rate limits so one authenticated user cannot spam household admins or repeatedly import the same third-party data.

### Elevation of Privilege

The most important privilege boundary is household isolation. A valid session for one user must not automatically grant access to another household’s records, and unauthenticated users must not reach household management endpoints at all. Multi-tenant authorization failures here become full privilege escalation into other families’ data and workflows.

Required guarantees:
- Household membership MUST be represented explicitly in storage and enforced in every query.
- Routes MUST not rely on global defaults like a shared household row for authorization decisions.
- Approval flows, action execution, and automation outputs MUST only affect resources the caller is authorized to control.

---
name: WA BSP adapter abstraction
description: Factory pattern for WhatsApp BSP (Twilio vs 360Dialog) with lazy-require to avoid circular deps.
---

The `WaBspAdapter` interface lives in `lib/wa-bsp.ts`. Factory (`getBspAdapter()`) uses `require()` inside the function body — NOT static imports — because adapter files (`wa-bsp-twilio.ts`, `wa-bsp-360dialog.ts`) import types from `wa-bsp.ts`, creating a circular reference at the module level that lazy require avoids.

**Why:** TypeScript's `import type` is erased at runtime, so adapter files can safely `import type { WaBspAdapter }` from `wa-bsp.ts`. But the factory in `wa-bsp.ts` cannot statically import the adapter classes without a circular module load cycle.

**How to apply:** Any new BSP adapter goes in `artifacts/api-server/src/lib/wa-bsp-<name>.ts`. Add it to the factory in `wa-bsp.ts`. No other files need touching — all callers go through `getBspAdapter()`.

**Two webhook routes:**
- Twilio: `POST /webhook/whatsapp` — uses `express.urlencoded` (global), ACKs with TwiML
- 360Dialog: `POST /webhook/whatsapp/360dialog` — uses `express.raw({ type: "*/*" })` inline middleware to capture raw body for HMAC-SHA256 validation, ACKs with plain 200

Both are listed in `PUBLIC_API_EXACT` in `app.ts`.

**360Dialog format:** Simplified Cloud API envelope — `{ contacts[], messages[] }` at top level, no entry/changes wrapper. Media is a media ID (not a URL) fetched via `GET /v1/media/{id}` with `D360-API-KEY` header.

**Active BSP:** controlled by `WA_BSP` env var (default: `"twilio"`). `sendWhatsApp` in `whatsapp.ts` delegates to `getBspAdapter().send()` and records all sends in dev telemetry log regardless of BSP.

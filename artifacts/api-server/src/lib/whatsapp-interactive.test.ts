/**
 * Integration tests for sendWhatsAppInteractive() in whatsapp.ts.
 *
 * Tests the full path from sendWhatsAppInteractive → adapter.sendInteractive → fetch,
 * verifying:
 *   (a) successful interactive send: usedFallback=false, telemetry interactive=true
 *   (b) fallback on InteractiveNotSupportedError: usedFallback=true, telemetry
 *       interactive=false, telemetry body is the plain-text version of the payload
 *
 * Uses the 360Dialog adapter injected directly via _setBspAdapterForTest().
 * This bypasses the require()-based lazy-load in getBspAdapter() which is
 * unavailable in the ESM test runner (node --import tsx/esm).
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

process.env.DIALOG360_API_KEY = "integration-test-key";
process.env.DIALOG360_WHATSAPP_NUMBER = "5500000000000";

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendWhatsAppInteractive, drainWaSendLog } from "./whatsapp.js";
import { toPlainText } from "./wa-reply-composer.js";
import { _setBspAdapterForTest } from "./wa-bsp.js";
import { WaBsp360DialogAdapter } from "./wa-bsp-360dialog.js";
import type { InteractivePayload } from "./wa-bsp.js";

// Inject a 360Dialog adapter before any test runs.
// 360Dialog uses global fetch for both sendInteractive() AND send() (plain-text
// fallback), so a single global.fetch mock covers both call sites.
_setBspAdapterForTest(new WaBsp360DialogAdapter());

// ── Test helpers ───────────────────────────────────────────────────────────────

/** Replace global.fetch for the duration of fn, restore afterwards, drain telemetry. */
async function withFetch(
  impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const saved = global.fetch;
  global.fetch = impl as typeof fetch;
  try {
    await fn();
  } finally {
    global.fetch = saved;
    drainWaSendLog(); // isolate telemetry between tests
  }
}

const PAYLOAD: InteractivePayload = {
  kind: "buttons",
  body: "📋 *Consulta Pediátrica*\n2025-01-15 09:00\nTipo: agendamento",
  footer: "Responda Sim ou Não",
  buttons: [
    { id: "approve", title: "✅ Sim" },
    { id: "reject", title: "❌ Não" },
  ],
};

const TO = "+5511999990000";

// ── sendWhatsAppInteractive — success path ─────────────────────────────────────

test("sendWhatsAppInteractive: success → usedFallback=false, ok=true", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ messages: [{ id: "wamid.interactive_ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    async () => {
      const result = await sendWhatsAppInteractive(TO, PAYLOAD);
      assert.equal(result.ok, true);
      assert.equal(result.usedFallback, false);
    },
  );
});

test("sendWhatsAppInteractive: success → telemetry records interactive=true", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ messages: [{ id: "wamid.telemetry_ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    async () => {
      drainWaSendLog();
      await sendWhatsAppInteractive(TO, PAYLOAD);
      const log = drainWaSendLog();
      assert.equal(log.length, 1);
      assert.equal(log[0]?.interactive, true);
    },
  );
});

test("sendWhatsAppInteractive: success → telemetry body starts with '[interactive]'", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ messages: [{ id: "wamid.body_ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    async () => {
      drainWaSendLog();
      await sendWhatsAppInteractive(TO, PAYLOAD);
      const log = drainWaSendLog();
      assert.ok(log[0]?.body.startsWith("[interactive]"), `Got body: ${log[0]?.body}`);
    },
  );
});

test("sendWhatsAppInteractive: success → telemetry to address has whatsapp: prefix", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify({ messages: [{ id: "wamid.addr_ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    async () => {
      drainWaSendLog();
      await sendWhatsAppInteractive(TO, PAYLOAD);
      const log = drainWaSendLog();
      assert.ok(log[0]?.to.startsWith("whatsapp:"), `Got to: ${log[0]?.to}`);
    },
  );
});

// ── sendWhatsAppInteractive — fallback path (InteractiveNotSupportedError) ─────

test("sendWhatsAppInteractive: InteractiveNotSupportedError → usedFallback=true", async () => {
  let callCount = 0;
  await withFetch(
    async () => {
      callCount++;
      if (callCount === 1) {
        // sendInteractive call — triggers InteractiveNotSupportedError
        return new Response("131047 Interactive not supported", { status: 400 });
      }
      // fallback send() call — succeed
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.fallback_ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      const result = await sendWhatsAppInteractive(TO, PAYLOAD);
      assert.equal(result.usedFallback, true);
    },
  );
});

test("sendWhatsAppInteractive: InteractiveNotSupportedError → telemetry records interactive=false", async () => {
  let callCount = 0;
  await withFetch(
    async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Interactive not supported for this tier", { status: 403 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.fallback_tel" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      drainWaSendLog();
      await sendWhatsAppInteractive(TO, PAYLOAD);
      const log = drainWaSendLog();
      const entry = log.find((e) => e.interactive === false);
      assert.ok(entry, "Expected a telemetry entry with interactive=false");
    },
  );
});

test("sendWhatsAppInteractive: fallback sends plain-text version of the payload", async () => {
  let callCount = 0;
  await withFetch(
    async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("131047 not supported", { status: 400 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.plaintext" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      drainWaSendLog();
      await sendWhatsAppInteractive(TO, PAYLOAD);
      const log = drainWaSendLog();
      const plainEntry = log.find((e) => e.interactive === false);
      assert.ok(plainEntry, "Expected fallback telemetry entry");
      const expectedPlain = toPlainText(PAYLOAD);
      assert.equal(plainEntry.body, expectedPlain);
    },
  );
});

test("sendWhatsAppInteractive: fallback result is ok:true when fallback send succeeds", async () => {
  let callCount = 0;
  await withFetch(
    async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("131047 not supported", { status: 400 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.fallback_sid" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async () => {
      const result = await sendWhatsAppInteractive(TO, PAYLOAD);
      assert.equal(result.ok, true);
      assert.equal(result.usedFallback, true);
    },
  );
});

// ── sendWhatsAppInteractive — non-interactive failure ─────────────────────────

test("sendWhatsAppInteractive: generic non-interactive send failure → usedFallback=false, ok=false", async () => {
  await withFetch(
    // 500 without 'interactive'/'not supported'/'131047' → adapter returns {ok:false}
    async () => new Response("Internal Server Error", { status: 500 }),
    async () => {
      const result = await sendWhatsAppInteractive(TO, PAYLOAD);
      assert.equal(result.ok, false);
      assert.equal(result.usedFallback, false);
    },
  );
});

/**
 * Unit tests for WaBspTwilioAdapter:
 *   - parseInboundPayload: ButtonPayload normalisation, group detection
 *   - sendInteractive: success, 21xxx → InteractiveNotSupportedError, non-21xxx → failure result
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 *
 * Uses Node.js built-in test runner (node:test) — no extra test framework needed.
 * global.fetch is replaced per-test and always restored in the finally block.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { WaBspTwilioAdapter } from "./wa-bsp-twilio.js";
import { InteractiveNotSupportedError } from "./wa-bsp.js";
import type { InteractivePayload } from "./wa-bsp.js";

// ── Test helpers ───────────────────────────────────────────────────────────────

const CREDS = {
  TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "testtoken00000000000000000000000000",
  TWILIO_WHATSAPP_FROM: "+15000000000",
};

/** Save, override, then restore a subset of process.env around a callback. */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Replace global.fetch for the duration of fn, then restore. */
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
  }
}

const APPROVAL_PAYLOAD: InteractivePayload = {
  kind: "buttons",
  body: "Aprovar a ação?",
  footer: "Vesta",
  buttons: [
    { id: "approve", title: "✅ Sim" },
    { id: "reject", title: "❌ Não" },
  ],
};

// ── parseInboundPayload ────────────────────────────────────────────────────────

test("parseInboundPayload: ButtonPayload is used as body (normalises button tap to machine ID)", () => {
  const adapter = new WaBspTwilioAdapter();
  const result = adapter.parseInboundPayload({
    From: "whatsapp:+5511999990000",
    To: "whatsapp:+15000000000",
    Body: "Sim",            // display label — should be ignored
    ButtonPayload: "approve", // machine-readable reply ID — should win
    NumMedia: "0",
  });
  assert.ok(result, "parseInboundPayload returned null unexpectedly");
  assert.equal(result.body, "approve");
  assert.equal(result.from, "whatsapp:+5511999990000");
});

test("parseInboundPayload: body falls back to Body when ButtonPayload is absent", () => {
  const adapter = new WaBspTwilioAdapter();
  const result = adapter.parseInboundPayload({
    From: "whatsapp:+5511999990000",
    To: "whatsapp:+15000000000",
    Body: "Olá, tudo bem?",
    NumMedia: "0",
  });
  assert.ok(result);
  assert.equal(result.body, "Olá, tudo bem?");
});

test("parseInboundPayload: empty ButtonPayload trims to empty string (not undefined)", () => {
  const adapter = new WaBspTwilioAdapter();
  const result = adapter.parseInboundPayload({
    From: "whatsapp:+5511999990000",
    To: "whatsapp:+15000000000",
    Body: "Sim",
    ButtonPayload: "  ", // whitespace only — trims to ""
    NumMedia: "0",
  });
  assert.ok(result);
  assert.equal(result.body, ""); // ButtonPayload.trim() = ""
});

test("parseInboundPayload: group message sets groupId when To contains @g.us", () => {
  const adapter = new WaBspTwilioAdapter();
  const groupTo = "whatsapp:+5511999900000@g.us";
  const result = adapter.parseInboundPayload({
    From: "whatsapp:+5511999990000",
    To: groupTo,
    Body: "/vesta Resumo",
    NumMedia: "0",
  });
  assert.ok(result);
  assert.equal(result.groupId, groupTo);
});

test("parseInboundPayload: DM message has null groupId", () => {
  const adapter = new WaBspTwilioAdapter();
  const result = adapter.parseInboundPayload({
    From: "whatsapp:+5511999990000",
    To: "whatsapp:+15000000000",
    Body: "Texto qualquer",
    NumMedia: "0",
  });
  assert.ok(result);
  assert.equal(result.groupId, null);
});

test("parseInboundPayload: missing From returns null", () => {
  const adapter = new WaBspTwilioAdapter();
  const result = adapter.parseInboundPayload({
    To: "whatsapp:+15000000000",
    Body: "Hello",
    NumMedia: "0",
  });
  assert.equal(result, null);
});

// ── sendInteractive ────────────────────────────────────────────────────────────

test("sendInteractive: returns error result when Twilio credentials are not configured", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(
    {
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      TWILIO_WHATSAPP_FROM: undefined,
    },
    async () => {
      const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /not configured/i);
    },
  );
});

test("sendInteractive: success path returns ok:true with sid from Twilio response", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(JSON.stringify({ sid: "SM_interactive_success" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      async () => {
        const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.sid, "SM_interactive_success");
      },
    );
  });
});

test("sendInteractive: Twilio 21xxx error code throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ code: 21608, message: "Sandbox number does not support interactive" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          (err: unknown) => {
            assert.ok(err instanceof InteractiveNotSupportedError, "Expected InteractiveNotSupportedError");
            return true;
          },
        );
      },
    );
  });
});

test("sendInteractive: Twilio 21000 (lower bound of 21xxx range) throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ code: 21000, message: "Unsupported feature" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          InteractiveNotSupportedError,
        );
      },
    );
  });
});

test("sendInteractive: Twilio 21999 (upper bound of 21xxx range) throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ code: 21999, message: "Upper bound" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          InteractiveNotSupportedError,
        );
      },
    );
  });
});

test("sendInteractive: non-21xxx HTTP error returns failure result (does not throw)", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ code: 50001, message: "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        // Must NOT throw — adapter converts non-interactive errors to result
        const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
        assert.equal(result.ok, false);
      },
    );
  });
});

test("sendInteractive: Twilio 22000 (just above 21xxx range) returns failure result, does not throw InteractiveNotSupportedError", async () => {
  const adapter = new WaBspTwilioAdapter();
  await withEnv(CREDS, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ code: 22000, message: "Out of range" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
        assert.equal(result.ok, false);
      },
    );
  });
});

test("sendInteractive: button titles are truncated to 20 chars in the request payload", async () => {
  const adapter = new WaBspTwilioAdapter();
  let capturedBody = "";
  await withEnv(CREDS, async () => {
    await withFetch(
      async (_url, init) => {
        capturedBody = init?.body?.toString() ?? "";
        return new Response(JSON.stringify({ sid: "SM_trunc" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      async () => {
        const longTitlePayload: InteractivePayload = {
          kind: "buttons",
          body: "Mensagem",
          buttons: [{ id: "go", title: "Este título tem mais de vinte caracteres!" }],
        };
        await adapter.sendInteractive("+5511999990000", longTitlePayload);
        const interactiveParam = new URLSearchParams(capturedBody).get("Interactive");
        assert.ok(interactiveParam, "Interactive param missing from request");
        const parsed = JSON.parse(interactiveParam) as { action: { buttons: Array<{ reply: { title: string } }> } };
        const title = parsed.action.buttons[0]?.reply.title ?? "";
        assert.ok(title.length <= 20, `Button title exceeds 20 chars: "${title}"`);
      },
    );
  });
});

/**
 * Unit tests for WaBsp360DialogAdapter:
 *   - parseInboundPayload: interactive button/list replies, text, audio, missing fields
 *   - sendInteractive: success, 131047/"not supported" → InteractiveNotSupportedError,
 *                      non-interactive 5xx → failure result
 *
 * Run with:  pnpm --filter @workspace/api-server run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { WaBsp360DialogAdapter } from "./wa-bsp-360dialog.js";
import { InteractiveNotSupportedError } from "./wa-bsp.js";
import type { InteractivePayload } from "./wa-bsp.js";

// ── Test helpers ───────────────────────────────────────────────────────────────

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

const D360_ENV = {
  DIALOG360_API_KEY: "test-api-key-360",
  DIALOG360_WHATSAPP_NUMBER: "5500000000000",
};

const APPROVAL_PAYLOAD: InteractivePayload = {
  kind: "buttons",
  body: "Aprovar a ação?",
  footer: "Vesta",
  buttons: [
    { id: "approve", title: "✅ Sim" },
    { id: "reject", title: "❌ Não" },
  ],
};

/** Build a minimal 360Dialog interactive inbound payload fixture. */
function makeInteractiveFixture(interactiveType: string, reply: { id: string; title: string }) {
  return {
    contacts: [{ profile: { name: "Test User" }, wa_id: "5511999990000" }],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.test001",
        type: "interactive",
        interactive: {
          type: interactiveType,
          [interactiveType]: reply,
        },
      },
    ],
  };
}

// ── parseInboundPayload — interactive button_reply ─────────────────────────────

test("parseInboundPayload: button_reply → body is the button reply ID", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeInteractiveFixture("button_reply", { id: "approve", title: "✅ Sim" }),
  );
  assert.ok(result, "Expected non-null result");
  assert.equal(result.body, "approve");
});

test("parseInboundPayload: button_reply from field gets whatsapp:+ prefix normalisation", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeInteractiveFixture("button_reply", { id: "approve", title: "Sim" }),
  );
  assert.ok(result);
  // 360Dialog sends plain digits; adapter adds "whatsapp:+" prefix to match Twilio convention
  assert.equal(result.from, "whatsapp:+5511999990000");
});

test("parseInboundPayload: button_reply body is trimmed", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeInteractiveFixture("button_reply", { id: "  reject  ", title: "Não" }),
  );
  assert.ok(result);
  assert.equal(result.body, "reject"); // trimmed
});

test("parseInboundPayload: list_reply → body is the list reply ID", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeInteractiveFixture("list_reply", { id: "option_a", title: "Opção A" }),
  );
  assert.ok(result);
  assert.equal(result.body, "option_a");
});

test("parseInboundPayload: unknown interactive subtype (e.g. nfm_reply) returns null", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.test002",
        type: "interactive",
        interactive: { type: "nfm_reply" },
      },
    ],
  });
  assert.equal(result, null);
});

test("parseInboundPayload: interactive with missing button_reply.id returns null", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.test003",
        type: "interactive",
        interactive: { type: "button_reply", button_reply: {} }, // no id
      },
    ],
  });
  assert.equal(result, null);
});

// ── parseInboundPayload — text & media ────────────────────────────────────────

test("parseInboundPayload: text message → body is the text content", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [{ profile: { name: "Maria" }, wa_id: "5511888880000" }],
    messages: [
      {
        from: "5511888880000",
        id: "wamid.text001",
        type: "text",
        text: { body: "Comprar leite" },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.body, "Comprar leite");
  assert.equal(result.profileName, "Maria");
  assert.equal(result.numMedia, "0");
});

test("parseInboundPayload: audio message → mediaUrl is the audio id, numMedia='1'", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.audio001",
        type: "audio",
        audio: { id: "audio-media-id-xyz", mime_type: "audio/ogg; codecs=opus" },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.mediaUrl, "audio-media-id-xyz");
  assert.equal(result.numMedia, "1");
  assert.equal(result.mediaContentType, "audio/ogg; codecs=opus");
});

test("parseInboundPayload: image message → mediaUrl is image id, body is caption", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.img001",
        type: "image",
        image: { id: "img-media-id", mime_type: "image/jpeg", caption: "Foto da receita" },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.mediaUrl, "img-media-id");
  assert.equal(result.body, "Foto da receita");
  assert.equal(result.numMedia, "1");
});

test("parseInboundPayload: empty messages array returns null", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({ contacts: [], messages: [] });
  assert.equal(result, null);
});

test("parseInboundPayload: message with no 'from' field returns null", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [{ id: "wamid.nofrom", type: "text", text: { body: "Hi" } }],
  });
  assert.equal(result, null);
});

test("parseInboundPayload: messageSid is the Cloud API message id", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.HBgLNTUxMTk5Mjk5NjcVAgASGBQzQUY2MDQ",
        type: "text",
        text: { body: "Oi" },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.messageSid, "wamid.HBgLNTUxMTk5Mjk5NjcVAgASGBQzQUY2MDQ");
});

// ── sendInteractive ────────────────────────────────────────────────────────────

test("sendInteractive: success path returns ok:true with sid from response", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async () =>
        new Response(
          JSON.stringify({ messages: [{ id: "wamid.interactive_ok" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      async () => {
        const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.sid, "wamid.interactive_ok");
      },
    );
  });
});

test("sendInteractive: 131047 error code in body throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async () =>
        new Response("131047 Interative message not supported for this account", {
          status: 400,
        }),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          (err: unknown) => {
            assert.ok(err instanceof InteractiveNotSupportedError, `Got ${err}`);
            return true;
          },
        );
      },
    );
  });
});

test("sendInteractive: 'not supported' in error body throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async () =>
        new Response("Feature not supported for this tier", { status: 403 }),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          InteractiveNotSupportedError,
        );
      },
    );
  });
});

test("sendInteractive: 'interactive' keyword in error body throws InteractiveNotSupportedError", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async () =>
        new Response("interactive messages unavailable", { status: 400 }),
      async () => {
        await assert.rejects(
          () => adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD),
          InteractiveNotSupportedError,
        );
      },
    );
  });
});

test("sendInteractive: generic 5xx error returns failure result (does not throw)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async () =>
        new Response("Internal Server Error", { status: 500 }),
      async () => {
        // 500 with no 'interactive'/'not supported'/'131047' → plain failure result
        const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
        assert.equal(result.ok, false);
      },
    );
  });
});

test("sendInteractive: not configured returns error result", async () => {
  const adapter = new WaBsp360DialogAdapter();
  await withEnv({ DIALOG360_API_KEY: undefined, DIALOG360_WHATSAPP_NUMBER: undefined }, async () => {
    const result = await adapter.sendInteractive("+5511999990000", APPROVAL_PAYLOAD);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not configured/i);
  });
});

test("sendInteractive: button titles are truncated to 20 chars in the request payload", async () => {
  const adapter = new WaBsp360DialogAdapter();
  let capturedBody: unknown;
  await withEnv(D360_ENV, async () => {
    await withFetch(
      async (_url, init) => {
        capturedBody = JSON.parse(init?.body?.toString() ?? "{}");
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.trunc" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      async () => {
        const longPayload: InteractivePayload = {
          kind: "buttons",
          body: "Escolha",
          buttons: [{ id: "pick", title: "Este título tem mais de vinte caracteres!" }],
        };
        await adapter.sendInteractive("+5511999990000", longPayload);
        const body = capturedBody as {
          interactive: { action: { buttons: Array<{ reply: { title: string } }> } };
        };
        const title = body.interactive.action.buttons[0]?.reply.title ?? "";
        assert.ok(title.length <= 20, `Title exceeds 20 chars: "${title}"`);
      },
    );
  });
});

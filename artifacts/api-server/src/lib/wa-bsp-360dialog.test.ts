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

// ── parseInboundPayload — group message detection ─────────────────────────────

test("parseInboundPayload: group message sets groupId to the group JID", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [{ profile: { name: "João" }, wa_id: "5511999990000" }],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.group001",
        type: "text",
        text: { body: "/vesta reunião quinta 19h" },
        group_id: "120363099999999999@g.us",
      },
    ],
  });
  assert.ok(result, "Expected non-null result");
  assert.equal(result.groupId, "120363099999999999@g.us");
});

test("parseInboundPayload: group message still sets from to the individual sender (whatsapp:+ prefixed)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.group002",
        type: "text",
        text: { body: "/vesta pausar" },
        group_id: "120363099999999999@g.us",
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.from, "whatsapp:+5511999990000");
  assert.equal(result.groupId, "120363099999999999@g.us");
});

test("parseInboundPayload: direct message (no group_id) sets groupId to null", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.dm001",
        type: "text",
        text: { body: "Comprar leite" },
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.groupId, null);
});

// ── parseInboundPayload — silenced message types ───────────────────────────────

/** Helper: build a minimal 360Dialog message fixture for a given type. */
function makeTypeFixture(type: string, extra: Record<string, unknown> = {}) {
  return {
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: `wamid.${type}001`,
        type,
        ...extra,
      },
    ],
  };
}

test("parseInboundPayload: reaction type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeTypeFixture("reaction", { reaction: { emoji: "👍" } }),
  );
  assert.equal(result, null);
});

test("parseInboundPayload: sticker type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeTypeFixture("sticker", { sticker: { id: "sticker-media-id", mime_type: "image/webp" } }),
  );
  assert.equal(result, null);
});

test("parseInboundPayload: location type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeTypeFixture("location", { location: { latitude: -23.5505, longitude: -46.6333 } }),
  );
  assert.equal(result, null);
});

test("parseInboundPayload: contacts (vCard) type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(
    makeTypeFixture("contacts", { contacts: [{ name: { formatted_name: "João" } }] }),
  );
  assert.equal(result, null);
});

test("parseInboundPayload: unsupported type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(makeTypeFixture("unsupported"));
  assert.equal(result, null);
});

test("parseInboundPayload: completely unknown type returns null (silenced)", () => {
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload(makeTypeFixture("ephemeral_note"));
  assert.equal(result, null);
});

test("parseInboundPayload: context field present — text body still returned correctly", () => {
  // When a sender replies to a previous message, 360Dialog adds a `context`
  // field with the original message ID.  We ignore context and use only
  // msg.text.body as the new message content.
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [{ profile: { name: "Ana" }, wa_id: "5511888880001" }],
    messages: [
      {
        from: "5511888880001",
        id: "wamid.reply001",
        type: "text",
        text: { body: "Sim, pode confirmar" },
        context: { from: "5511000000000", id: "wamid.original001" },
      },
    ],
  });
  assert.ok(result, "Expected non-null result for reply message");
  assert.equal(result.body, "Sim, pode confirmar");
});

test("parseInboundPayload: group_id without @g.us suffix is rejected (groupId null)", () => {
  // Defensive: an unexpected group_id format should not be treated as a group JID.
  const adapter = new WaBsp360DialogAdapter();
  const result = adapter.parseInboundPayload({
    contacts: [],
    messages: [
      {
        from: "5511999990000",
        id: "wamid.bogus001",
        type: "text",
        text: { body: "Oi" },
        group_id: "not-a-real-group-id",
      },
    ],
  });
  assert.ok(result);
  assert.equal(result.groupId, null);
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

// ── validateWebhookRequest — HMAC hardening ─────────────────────────────────────

import { createHmac } from "node:crypto";

/** Build a minimal fake Express Request for validateWebhookRequest tests. */
function makeRequest(headers: Record<string, string>): import("express").Request {
  return {
    headers,
    log: {
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
    },
  } as unknown as import("express").Request;
}

const HMAC_ENV = {
  NODE_ENV: "production",
  DIALOG360_HUB_SECRET: "test-hub-secret",
};

function makeValidSig(secret: string, payload: Buffer): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

test("validateWebhookRequest: correct HMAC signature returns true (production)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  const sig = makeValidSig("test-hub-secret", payload);
  await withEnv(HMAC_ENV, async () => {
    const result = await adapter.validateWebhookRequest(makeRequest({ "x-hub-signature-256": sig }), payload);
    assert.equal(result, true);
  });
});

test("validateWebhookRequest: wrong HMAC signature returns false (production)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  await withEnv(HMAC_ENV, async () => {
    const result = await adapter.validateWebhookRequest(
      makeRequest({ "x-hub-signature-256": "sha256=" + "a".repeat(64) }),
      payload,
    );
    assert.equal(result, false);
  });
});

test("validateWebhookRequest: short (mismatched-length) signature returns false without throwing", async () => {
  // Regression test for the padEnd footgun: a truncated hex string must NOT be
  // padded to the correct length and compared — it must be rejected outright.
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  await withEnv(HMAC_ENV, async () => {
    const result = await adapter.validateWebhookRequest(
      makeRequest({ "x-hub-signature-256": "sha256=deadbeef" }),
      payload,
    );
    assert.equal(result, false);
  });
});

test("validateWebhookRequest: missing signature header returns false (production)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  await withEnv(HMAC_ENV, async () => {
    const result = await adapter.validateWebhookRequest(makeRequest({}), payload);
    assert.equal(result, false);
  });
});

test("validateWebhookRequest: missing DIALOG360_HUB_SECRET in production returns false", async () => {
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  await withEnv({ NODE_ENV: "production", DIALOG360_HUB_SECRET: undefined }, async () => {
    const result = await adapter.validateWebhookRequest(
      makeRequest({ "x-hub-signature-256": "sha256=" + "a".repeat(64) }),
      payload,
    );
    assert.equal(result, false);
  });
});

test("validateWebhookRequest: non-production with no secret returns true (dev bypass)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  const payload = Buffer.from('{"test":"payload"}');
  await withEnv({ NODE_ENV: "development", DIALOG360_HUB_SECRET: undefined }, async () => {
    const result = await adapter.validateWebhookRequest(
      makeRequest({ "x-hub-signature-256": "sha256=invalidsignature" }),
      payload,
    );
    assert.equal(result, true);
  });
});

// ── send() — 429 retry ─────────────────────────────────────────────────────────

test("send: 429 response triggers one retry that succeeds — returns ok:true", async () => {
  const adapter = new WaBsp360DialogAdapter();
  let callCount = 0;
  await withEnv(D360_ENV, async () => {
    await withFetch(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", { status: 429 });
      }
      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.retry001" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }, async () => {
      const result = await adapter.send("+5511999990000", "Olá");
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.sid, "wamid.retry001");
      assert.equal(callCount, 2, "Expected exactly 2 fetch calls (original + 1 retry)");
    });
  });
});

test("send: 429 on both attempts returns ok:false with error", async () => {
  const adapter = new WaBsp360DialogAdapter();
  let callCount = 0;
  await withEnv(D360_ENV, async () => {
    await withFetch(async () => {
      callCount++;
      return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
    }, async () => {
      const result = await adapter.send("+5511999990000", "Olá");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /429|retry/i);
      assert.equal(callCount, 2, "Expected exactly 2 fetch calls (original + 1 retry)");
    });
  });
});

test("send: non-429 error on first attempt returns ok:false immediately (no retry)", async () => {
  const adapter = new WaBsp360DialogAdapter();
  let callCount = 0;
  await withEnv(D360_ENV, async () => {
    await withFetch(async () => {
      callCount++;
      return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" });
    }, async () => {
      const result = await adapter.send("+5511999990000", "Olá");
      assert.equal(result.ok, false);
      assert.equal(callCount, 1, "Expected exactly 1 fetch call — no retry for 500");
    });
  });
});

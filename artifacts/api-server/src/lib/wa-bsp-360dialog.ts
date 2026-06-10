import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";
import type { WaBspAdapter, InboundWAMessage, SendResult, InteractivePayload } from "./wa-bsp";
import { InteractiveNotSupportedError } from "./wa-bsp";
import { logger } from "./logger";

const DIALOG360_API_BASE = "https://waba.360dialog.io/v1";
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * 360Dialog BSP adapter.
 *
 * 360Dialog is a WhatsApp Cloud API reseller (Meta-native format).
 * Inbound webhook payloads follow the simplified Cloud API envelope
 * (contacts[] + messages[] at the top level, without the entry/changes wrapper).
 *
 * Required env vars:
 *   DIALOG360_API_KEY           — used for sending and media download
 *   DIALOG360_WHATSAPP_NUMBER   — your 360Dialog-assigned phone number (E.164 digits, no +)
 *   DIALOG360_HUB_SECRET        — HMAC secret for X-Hub-Signature-256 validation (production)
 */
export class WaBsp360DialogAdapter implements WaBspAdapter {
  isConfigured(): boolean {
    return !!(process.env.DIALOG360_API_KEY && process.env.DIALOG360_WHATSAPP_NUMBER);
  }

  async send(to: string, body: string): Promise<SendResult> {
    const apiKey = process.env.DIALOG360_API_KEY;
    if (!apiKey) {
      logger.warn({ to }, "WaBsp360Dialog.send: DIALOG360_API_KEY not set — skipping");
      return { ok: false, error: "360Dialog not configured" };
    }

    // Strip whatsapp: prefix and leading + — 360Dialog expects plain E.164 digits
    const toNorm = to.replace(/^whatsapp:/i, "").replace(/^\+/, "");

    try {
      const res = await fetch(`${DIALOG360_API_BASE}/messages`, {
        method: "POST",
        headers: {
          "D360-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: toNorm,
          type: "text",
          text: { body },
        }),
      });

      // 429 rate-limit: wait 2 s and retry once before giving up.
      if (res.status === 429) {
        logger.warn({ to: toNorm, attempt: 2 }, "360Dialog send rate-limited (429) — retrying in 2 s");
        await new Promise((r) => setTimeout(r, 2000));
        const retry = await fetch(`${DIALOG360_API_BASE}/messages`, {
          method: "POST",
          headers: {
            "D360-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: toNorm,
            type: "text",
            text: { body },
          }),
        });
        if (!retry.ok) {
          const errText = await retry.text().catch(() => "");
          throw new Error(
            `360Dialog send failed after retry: ${retry.status} ${retry.statusText} — ${errText}`,
          );
        }
        const retryData = (await retry.json()) as { messages?: Array<{ id?: string }> };
        const retrySid = retryData.messages?.[0]?.id ?? "360dialog-unknown";
        logger.info({ to: toNorm, sid: retrySid }, "WhatsApp sent via 360Dialog (retry)");
        return { ok: true, sid: retrySid };
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `360Dialog send failed: ${res.status} ${res.statusText} — ${errText}`,
        );
      }

      const data = (await res.json()) as { messages?: Array<{ id?: string }> };
      const sid = data.messages?.[0]?.id ?? "360dialog-unknown";
      logger.info({ to: toNorm, sid }, "WhatsApp sent via 360Dialog");
      return { ok: true, sid };
    } catch (err) {
      logger.error({ err, to }, "WhatsApp 360Dialog send failed");
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  /**
   * Sends a WhatsApp interactive button message via the 360Dialog (Cloud API) endpoint.
   *
   * Uses the Cloud API native `type: "interactive"` format with `action.buttons`.
   * If the API returns a 400/403 with an unsupported-feature error code, we
   * throw InteractiveNotSupportedError so the caller can fall back to plain text.
   */
  async sendInteractive(to: string, payload: InteractivePayload): Promise<SendResult> {
    const apiKey = process.env.DIALOG360_API_KEY;
    if (!apiKey) {
      logger.warn({ to }, "WaBsp360Dialog.sendInteractive: DIALOG360_API_KEY not set — skipping");
      return { ok: false, error: "360Dialog not configured" };
    }

    const toNorm = to.replace(/^whatsapp:/i, "").replace(/^\+/, "");

    const interactiveBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toNorm,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: payload.body },
        ...(payload.footer ? { footer: { text: payload.footer } } : {}),
        action: {
          buttons: payload.buttons.map((btn) => ({
            type: "reply",
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20), // WhatsApp enforces 20-char limit
            },
          })),
        },
      },
    };

    try {
      const res = await fetch(`${DIALOG360_API_BASE}/messages`, {
        method: "POST",
        headers: {
          "D360-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(interactiveBody),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");

        // Cloud API error 131047 = interactive message not supported for this account type/tier.
        // We also catch generic 400 with "interactive" in the error body as a safety net.
        if (
          res.status === 400 ||
          res.status === 403 ||
          errText.includes("131047") ||
          errText.toLowerCase().includes("interactive") ||
          errText.toLowerCase().includes("not supported")
        ) {
          throw new InteractiveNotSupportedError(
            `360Dialog ${res.status}: ${errText} — falling back to plain text`,
          );
        }

        throw new Error(
          `360Dialog sendInteractive failed: ${res.status} ${res.statusText} — ${errText}`,
        );
      }

      const data = (await res.json()) as { messages?: Array<{ id?: string }> };
      const sid = data.messages?.[0]?.id ?? "360dialog-interactive-unknown";
      logger.info({ to: toNorm, sid }, "WhatsApp interactive sent via 360Dialog");
      return { ok: true, sid };
    } catch (err) {
      if (err instanceof InteractiveNotSupportedError) throw err;
      logger.error({ err, to }, "WhatsApp 360Dialog sendInteractive failed");
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async validateWebhookRequest(req: Request, rawBody?: Buffer): Promise<boolean> {
    const hubSecret = process.env.DIALOG360_HUB_SECRET;

    if (process.env.NODE_ENV !== "production") {
      req.log.warn("NODE_ENV !== production — skipping 360Dialog signature check (development mode)");
      return true;
    }

    if (!hubSecret) {
      req.log.error("DIALOG360_HUB_SECRET not set in production — rejecting webhook request");
      return false;
    }

    if (!rawBody || rawBody.length === 0) {
      req.log.warn("360Dialog webhook: empty raw body — cannot validate signature");
      return false;
    }

    const signatureHeader = (req.headers["x-hub-signature-256"] ?? "") as string;
    if (!signatureHeader) {
      req.log.warn("360Dialog webhook: missing X-Hub-Signature-256 header");
      return false;
    }

    // Header format: "sha256=<hex_digest>"
    const sigHex = signatureHeader.startsWith("sha256=")
      ? signatureHeader.slice(7)
      : signatureHeader;

    const expectedHex = createHmac("sha256", hubSecret).update(rawBody).digest("hex");

    // Reject mismatched lengths before timingSafeEqual — avoids the padEnd footgun
    // where a short attacker-supplied hex string gets padded to the right length with
    // zeros, making the comparison undefined rather than safely false.
    if (sigHex.length !== expectedHex.length) {
      return false;
    }

    try {
      return timingSafeEqual(Buffer.from(sigHex, "hex"), Buffer.from(expectedHex, "hex"));
    } catch {
      return false;
    }
  }

  parseInboundPayload(body: unknown): InboundWAMessage | null {
    // 360Dialog uses the simplified WhatsApp Cloud API envelope:
    // { contacts: [{profile: {name}, wa_id}], messages: [{from, id, type, text|audio|image|interactive...}] }
    const b = body as Record<string, unknown>;
    const contacts = b.contacts as
      | Array<{ profile?: { name?: string }; wa_id?: string }>
      | undefined;
    const messages = b.messages as
      | Array<{
          from?: string;
          id?: string;
          type?: string;
          /**
           * WhatsApp Cloud API group JID.
           * Present when the message was sent in a WhatsApp group chat
           * (e.g. "120363XXXXXXXX@g.us").  Absent for direct messages.
           */
          group_id?: string;
          /**
           * Reply-to context set by WhatsApp when the sender replies to an
           * earlier message.  We intentionally ignore this field — the actual
           * new message text is always in the top-level type/text/audio/etc.
           * fields.  Including it here only to document the deliberate choice.
           */
          context?: unknown;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          video?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; filename?: string };
          interactive?: {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          /** Emoji reaction to a previous message — not processable, silenced. */
          reaction?: { emoji?: string };
          /** Sticker — not processable, silenced. */
          sticker?: { id?: string; mime_type?: string };
          /** Location share — not processable, silenced. */
          location?: { latitude?: number; longitude?: number };
          /** vCard contact share — not processable, silenced. */
          contacts?: unknown[];
        }>
      | undefined;

    if (!messages || messages.length === 0) return null;

    const msg = messages[0];
    if (!msg?.from) return null;

    const profileName = contacts?.[0]?.profile?.name ?? null;

    // Normalize phone: 360Dialog sends plain E.164 digits, add whatsapp:+ prefix to
    // match the Twilio format that wa-message-processor.ts expects.
    const from = `whatsapp:+${msg.from.replace(/^\+/, "")}`;

    let textBody = "";
    let mediaId: string | null = null;
    let mimeType: string | null = null;
    let hasMedia = false;

    switch (msg.type) {
      case "text":
        textBody = (msg.text?.body ?? "").trim();
        break;

      case "interactive": {
        // Interactive reply: user tapped a button or selected a list item.
        // Normalise to the button/list reply ID so the existing Sim/Não handler
        // receives the machine-readable token without any changes.
        const interactive = msg.interactive;
        if (interactive?.type === "button_reply" && interactive.button_reply?.id) {
          textBody = interactive.button_reply.id.trim();
        } else if (interactive?.type === "list_reply" && interactive.list_reply?.id) {
          textBody = interactive.list_reply.id.trim();
        } else {
          // Unknown interactive subtype — ignore
          return null;
        }
        break;
      }

      case "audio":
        mediaId = msg.audio?.id ?? null;
        mimeType = msg.audio?.mime_type ?? "audio/ogg";
        hasMedia = true;
        break;
      case "image":
        mediaId = msg.image?.id ?? null;
        mimeType = msg.image?.mime_type ?? "image/jpeg";
        textBody = (msg.image?.caption ?? "").trim();
        hasMedia = true;
        break;
      case "video":
        mediaId = msg.video?.id ?? null;
        mimeType = msg.video?.mime_type ?? "video/mp4";
        textBody = (msg.video?.caption ?? "").trim();
        hasMedia = true;
        break;
      case "document":
        textBody = msg.document?.filename ?? "(documento recebido)";
        break;

      // ── Silenced types — recognised but not actionable ──────────────────────
      // Each returns null so the webhook handler drops the event without error.
      // Logged at debug so engineers can see the traffic volume without noise.
      case "reaction":
        logger.debug({ type: "reaction", from }, "360Dialog reaction message — silenced");
        return null;
      case "sticker":
        logger.debug({ type: "sticker", from }, "360Dialog sticker message — silenced");
        return null;
      case "location":
        logger.debug({ type: "location", from }, "360Dialog location message — silenced");
        return null;
      case "contacts":
        logger.debug({ type: "contacts", from }, "360Dialog contact-card message — silenced");
        return null;
      case "unsupported":
        logger.debug({ type: "unsupported", from }, "360Dialog unsupported message — silenced");
        return null;

      default:
        // Completely unknown type — log at debug (not warn/error) to avoid alert fatigue.
        logger.debug({ type: msg.type, from }, "360Dialog unknown message type — silenced");
        return null;
    }

    // A group JID ends with "@g.us" (e.g. "120363XXXXXXXX@g.us").
    // When present, the message originated from a WhatsApp group chat.
    const groupId =
      msg.group_id && msg.group_id.endsWith("@g.us") ? msg.group_id : null;

    return {
      from,
      body: textBody,
      profileName,
      // mediaUrl holds the 360Dialog media ID (not a URL).
      // WaBsp360DialogAdapter.downloadMedia() fetches it from /v1/media/{id}.
      mediaUrl: mediaId,
      mediaContentType: mimeType,
      numMedia: hasMedia ? "1" : "0",
      messageSid: msg.id ?? null,
      groupId,
    };
  }

  async downloadMedia(
    mediaRef: string,
    _mimeType: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const apiKey = process.env.DIALOG360_API_KEY;
    if (!apiKey) {
      throw new Error("360Dialog media download: DIALOG360_API_KEY not set");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const res = await fetch(`${DIALOG360_API_BASE}/media/${mediaRef}`, {
        headers: { "D360-API-KEY": apiKey },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(
          `360Dialog media download failed: ${res.status} ${res.statusText}`,
        );
      }

      const contentLengthHeader = res.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const declared = parseInt(contentLengthHeader, 10);
        if (!isNaN(declared) && declared > MAX_MEDIA_BYTES) {
          throw new Error(
            `360Dialog media rejected: Content-Length ${declared} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
          );
        }
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await res.arrayBuffer();

      if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
        throw new Error(
          `360Dialog media rejected: actual size ${arrayBuffer.byteLength} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
        );
      }

      return { buffer: Buffer.from(arrayBuffer), contentType };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

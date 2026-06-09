import { createHmac, timingSafeEqual } from "crypto";
import type { Request } from "express";
import type { WaBspAdapter, InboundWAMessage, SendResult } from "./wa-bsp";
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

    try {
      return timingSafeEqual(
        Buffer.from(sigHex.padEnd(expectedHex.length, "0"), "hex"),
        Buffer.from(expectedHex, "hex"),
      );
    } catch {
      return false;
    }
  }

  parseInboundPayload(body: unknown): InboundWAMessage | null {
    // 360Dialog uses the simplified WhatsApp Cloud API envelope:
    // { contacts: [{profile: {name}, wa_id}], messages: [{from, id, type, text|audio|image...}] }
    const b = body as Record<string, unknown>;
    const contacts = b.contacts as
      | Array<{ profile?: { name?: string }; wa_id?: string }>
      | undefined;
    const messages = b.messages as
      | Array<{
          from?: string;
          id?: string;
          type?: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          video?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; filename?: string };
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
      default:
        // Unknown type (e.g. location, contacts, reaction) — ignore
        return null;
    }

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
      // Group message detection for 360Dialog requires confirming the exact
      // payload format for group JIDs — set to null until confirmed.
      groupId: null,
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

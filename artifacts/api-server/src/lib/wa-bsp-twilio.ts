import type { Request } from "express";
import type { WaBspAdapter, InboundWAMessage, SendResult } from "./wa-bsp";
import { logger } from "./logger";

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export class WaBspTwilioAdapter implements WaBspAdapter {
  isConfigured(): boolean {
    return !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
    );
  }

  async send(to: string, body: string): Promise<SendResult> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      logger.warn({ to }, "WaBspTwilio.send: not configured — skipping");
      return { ok: false, error: "Twilio not configured" };
    }

    const toAddr = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const fromAddr = from.startsWith("whatsapp:") ? from : `whatsapp:${from}`;

    try {
      const twilio = await import("twilio");
      const client = twilio.default(accountSid, authToken);
      const msg = await client.messages.create({ from: fromAddr, to: toAddr, body });
      logger.info({ to, sid: msg.sid }, "WhatsApp sent via Twilio");
      return { ok: true, sid: msg.sid };
    } catch (err) {
      logger.error({ err, to }, "WhatsApp Twilio send failed");
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async validateWebhookRequest(req: Request): Promise<boolean> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (process.env.NODE_ENV !== "production") {
      req.log.warn("NODE_ENV !== production — skipping Twilio signature check (development mode)");
      return true;
    }

    if (!authToken) {
      req.log.error("TWILIO_AUTH_TOKEN not set in production — rejecting webhook request");
      return false;
    }

    const signature = (req.headers["x-twilio-signature"] ?? "") as string;
    if (!signature) {
      req.log.warn("Webhook: missing X-Twilio-Signature header");
      return false;
    }

    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() ?? "https";
    const host =
      (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() ??
      (req.headers["host"] as string | undefined) ??
      process.env.REPLIT_DEV_DOMAIN ??
      process.env.REPLIT_DOMAINS?.split(",")[0] ??
      "localhost";
    const webhookUrl = `${proto}://${host}/api/webhook/whatsapp`;

    const { validateRequest } = await import("twilio");
    const params = (req.body ?? {}) as Record<string, string>;
    return validateRequest(authToken, signature, webhookUrl, params);
  }

  parseInboundPayload(body: unknown): InboundWAMessage | null {
    const b = body as Record<string, string | undefined>;
    const from = b.From ?? "";
    if (!from) return null;

    // Group detection: Twilio sets To to the group JID (contains @g.us) for group messages.
    const rawTo = b.To ?? "";
    const groupSourced = rawTo.includes("@g.us");

    return {
      from,
      body: (b.Body ?? "").trim(),
      profileName: b.ProfileName ?? null,
      mediaUrl: b.MediaUrl0 ?? null,
      mediaContentType: b.MediaContentType0 ?? null,
      numMedia: b.NumMedia ?? "0",
      messageSid: b.MessageSid ?? null,
      groupId: groupSourced ? rawTo : null,
    };
  }

  async downloadMedia(
    mediaRef: string,
    _mimeType: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    const headers: Record<string, string> = {};
    if (accountSid && authToken) {
      const creds = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
      headers["Authorization"] = `Basic ${creds}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const res = await fetch(mediaRef, { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(
          `Twilio media download failed: ${res.status} ${res.statusText}`,
        );
      }

      const contentLengthHeader = res.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const declared = parseInt(contentLengthHeader, 10);
        if (!isNaN(declared) && declared > MAX_MEDIA_BYTES) {
          throw new Error(
            `Twilio media rejected: Content-Length ${declared} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
          );
        }
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await res.arrayBuffer();

      if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
        throw new Error(
          `Twilio media rejected: actual size ${arrayBuffer.byteLength} bytes exceeds ${MAX_MEDIA_BYTES} bytes`,
        );
      }

      return { buffer: Buffer.from(arrayBuffer), contentType };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
